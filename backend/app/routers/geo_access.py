"""
KMC-GIS-SERVER — Nepal-only Geo Access Gate
============================================
Restricts entry to the "Geo World of KMC" (public GeoPortal map, its data
APIs and raster tiles) to viewers physically located in Nepal.

Defense layers (server-side is authoritative):
  1. Client IP extraction from headers set by our own nginx (X-Real-IP).
     Client-controlled X-Forwarded-For first entries are NEVER trusted.
     NOTE: nginx must face clients directly. If you place another proxy,
     tunnel or CDN in front of nginx, configure it to overwrite X-Real-IP
     with the true client IP — otherwise the gate sees the proxy's IP.
  2. Transparent-proxy header detection (Via, Proxy-Connection, ...).
  3. IP geolocation: local GeoLite2 .mmdb when present, otherwise ip-api.com
     with 24h Redis caching per IP.
  4. VPN / datacenter / proxy ASN denylist + organisation keyword matching
     + ip-api `proxy` / `hosting` flags. This defeats casual VPN/proxy use
     because commercial VPN exits live in datacenter ASNs.
  5. WebRTC leak cross-check: the browser reports locally discovered public
     IPs; any that geolocate outside Nepal fail the check.
  6. On success a short-lived, IP-bound, HttpOnly geo-pass cookie
     (`kmc_geo_pass`) is issued. nginx `auth_request` and the data APIs
     validate it on every request.

Honest limitation: no IP-based control can distinguish a determined
adversary using a *residential* Nepal proxy from a genuine visitor. What
this gate reliably stops is simple/commercial VPN and proxy use.
"""

import ipaddress
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_optional_current_user, get_redis
from app.config import get_settings
from app.database import get_db
from app.models import User

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/geo", tags=["GeoAccess"])

GEO_PASS_COOKIE = "kmc_geo_pass"

# ---------------------------------------------------------------------------
# Configuration helpers
# ---------------------------------------------------------------------------

def _geo_setting(name: str, default: Any) -> Any:
    return getattr(settings, name, default)


# ---------------------------------------------------------------------------
# Client IP handling — only trust headers written by our own nginx
# ---------------------------------------------------------------------------

def _looks_like_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def get_client_ip(request: Request) -> str:
    """
    Our nginx sets `X-Real-IP $remote_addr` unconditionally, overwriting any
    client-sent value, so it is the only header we trust. The left-most
    X-Forwarded-For entry is client-controlled and must never be trusted.
    """
    real_ip = (request.headers.get("x-real-ip") or "").strip().split(",")[0].strip()
    if real_ip and _looks_like_ip(real_ip):
        return real_ip
    if request.client and request.client.host and _looks_like_ip(request.client.host):
        return request.client.host
    return "unknown"


def is_private_or_special(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
        return (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        )
    except ValueError:
        return True


# Transparent-proxy fingerprints: a "direct" visitor never sends these.
PROXY_HEADERS = (
    "via",
    "x-forwarded-by",
    "proxy-connection",
    "x-proxy-id",
    "x-bluecoat-via",
    "proxy-agent",
    "x-proxyuser-ip",
)


def has_proxy_headers(request: Request) -> Optional[str]:
    for h in PROXY_HEADERS:
        if request.headers.get(h):
            return h
    return None


# ---------------------------------------------------------------------------
# VPN / datacenter / hosting ASN denylist
# ---------------------------------------------------------------------------

# Well-known ASNs used by commercial VPN exits, proxy networks and IaaS
# clouds. A residential visitor inside Nepal never arrives from these.
VPN_HOSTING_ASNS = {
    9009,    # M247 Europe (hosts NordVPN, Surfshark, many others)
    39351,   # M247 Europe
    60068,   # Mullvad
    20473,   # Vultr / Constant Company
    14061,   # DigitalOcean
    63949,   # Linode / Akamai Connected Cloud
    16509,   # Amazon Web Services
    14618,   # Amazon Web Services
    8987,    # Amazon (legacy, kept for safety)
    8075,    # Microsoft Azure
    15169,   # Google LLC (incl. Google Cloud exits)
    396982,  # Google Cloud
    13335,   # Cloudflare (WARP exits appear as Cloudflare)
    16276,   # OVHcloud
    12876,   # Scaleway / Online S.A.S.
    212238,  # Datacamp Limited (CDN77 / proxy infra)
    60011,   # Datacamp Limited
    49981,   # WorldStream
    42864,   # G-Core Labs
    200019,  # Alexhost (Moldova, heavy VPN use)
    62240,   # Clouvider
    174,     # Cogent (transit — never an eyeball network)
    1299,    # Arelion / Telia (transit)
    2914,    # NTT (transit)
    3356,    # Lumen / Level3 (transit)
    6461,    # Zayo (transit)
    3257,    # GTT (transit)
    9002,    # RETN (transit/hosting)
    204957,  # GreenCloud (VPS)
    215540,  # netcup (VPS)
    48693,   # Neterra / hosting
    51167,   # Contabo (VPS)
    197540,  # netcup / hosting
    57976,   # Bl networks / VPN infra
}

SUSPICIOUS_ORG_KEYWORDS = (
    "vpn",
    "proxy",
    "datacenter",
    "data center",
    "hosting",
    "vps",
    "dedicated server",
    "colocation",
    "virtual private",
)


def _parse_asn(as_field: str) -> Optional[int]:
    m = re.match(r"\s*AS(\d+)", as_field or "", re.IGNORECASE)
    return int(m.group(1)) if m else None


def is_suspicious_network(asn: Optional[int], org: str) -> Optional[str]:
    if asn and asn in VPN_HOSTING_ASNS:
        return f"asn:{asn}"
    org_l = (org or "").lower()
    for kw in SUSPICIOUS_ORG_KEYWORDS:
        if kw in org_l:
            return f"org:{kw}"
    return None


# ---------------------------------------------------------------------------
# IP geolocation — local MaxMind DB first, ip-api.com fallback (Redis cached)
# ---------------------------------------------------------------------------

_MMDB_COUNTRY = "/app/geoip/GeoLite2-Country.mmdb"
_MMDB_ASN = "/app/geoip/GeoLite2-ASN.mmdb"

try:  # optional dependency — code works without it
    import geoip2.database  # type: ignore

    _HAS_GEOIP2 = True
except Exception:  # pragma: no cover
    _HAS_GEOIP2 = False


def _lookup_mmdb(ip: str) -> Optional[Dict[str, Any]]:
    if not _HAS_GEOIP2:
        return None
    try:
        import os

        if not (os.path.exists(_MMDB_COUNTRY) and os.path.exists(_MMDB_ASN)):
            return None
        with geoip2.database.Reader(_MMDB_COUNTRY) as rdr:
            country = (rdr.country(ip).country.iso_code or "").upper()
        with geoip2.database.Reader(_MMDB_ASN) as rdr:
            asn_rec = rdr.asn(ip)
            asn = asn_rec.autonomous_system_number
            org = asn_rec.autonomous_system_organization or ""
        return {
            "country_code": country,
            "asn": asn,
            "org": org,
            "proxy": False,
            "hosting": False,
            "source": "mmdb",
        }
    except Exception as exc:  # corrupt DB / unknown IP
        logger.warning(f"[geo] mmdb lookup failed for {ip}: {exc}")
        return None


async def _lookup_ipapi(ip: str) -> Optional[Dict[str, Any]]:
    url = f"http://ip-api.com/json/{ip}?fields=status,message,countryCode,as,org,proxy,hosting,query"
    try:
        async with httpx.AsyncClient(timeout=float(_geo_setting("GEO_IPAPI_TIMEOUT", 8.0))) as client:
            resp = await client.get(url)
            data = resp.json()
    except Exception as exc:
        logger.warning(f"[geo] ip-api request failed for {ip}: {exc}")
        return None
    if data.get("status") != "success":
        logger.warning(f"[geo] ip-api error for {ip}: {data.get('message')}")
        return None
    return {
        "country_code": (data.get("countryCode") or "").upper(),
        "asn": _parse_asn(data.get("as") or ""),
        "org": data.get("org") or "",
        "proxy": bool(data.get("proxy")),
        "hosting": bool(data.get("hosting")),
        "source": "ip-api",
    }


async def lookup_ip(ip: str) -> Optional[Dict[str, Any]]:
    """Cached GeoIP lookup for a single IP address."""
    cache_key = f"geoip:{ip}"
    try:
        redis = await get_redis()
        cached = await redis.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass

    result = _lookup_mmdb(ip)
    if result is None:
        result = await _lookup_ipapi(ip)

    if result:
        try:
            redis = await get_redis()
            await redis.setex(cache_key, 86400, json.dumps(result))
        except Exception:
            pass
    return result


# ---------------------------------------------------------------------------
# Core verdict
# ---------------------------------------------------------------------------

class GeoVerdict(BaseModel):
    allowed: bool
    reason: str
    country_code: str = ""
    detail: str = ""


async def evaluate_ip(ip: str, webrtc_ips: Optional[List[str]] = None) -> GeoVerdict:
    if not _looks_like_ip(ip):
        return GeoVerdict(allowed=False, reason="invalid_ip", detail="Could not determine client IP.")

    if is_private_or_special(ip):
        if _geo_setting("GEO_ALLOW_PRIVATE_IPS", True):
            return GeoVerdict(allowed=True, reason="private_network",
                              detail="Private/loopback network (local testing or office LAN).")
        return GeoVerdict(allowed=False, reason="private_ip", detail="Private IP addresses are not permitted.")

    info = await lookup_ip(ip)
    if not info or not info.get("country_code"):
        # Fail closed: without geolocation we cannot prove Nepal origin.
        return GeoVerdict(allowed=False, reason="geoip_unavailable",
                          detail="Location could not be verified. Please try again.")

    country = info["country_code"]
    if country != "NP":
        return GeoVerdict(allowed=False, reason="outside_nepal", country_code=country,
                          detail=f"Access is limited to viewers inside Nepal (detected: {country}).")

    if _geo_setting("GEO_STRICT_VPN_BLOCK", True):
        if info.get("proxy") or info.get("hosting"):
            return GeoVerdict(allowed=False, reason="vpn_or_datacenter", country_code=country,
                              detail="VPN, proxy or datacenter connections are not permitted.")
        hit = is_suspicious_network(info.get("asn"), info.get("org") or "")
        if hit:
            logger.warning(f"[geo] blocked VPN/datacenter network for {ip}: {hit} org={info.get('org')}")
            return GeoVerdict(allowed=False, reason="vpn_or_datacenter", country_code=country,
                              detail="VPN, proxy or datacenter connections are not permitted.")

    # WebRTC leak cross-check: a leaked public IP outside Nepal means the
    # visitor is tunnelling.
    for rip in webrtc_ips or []:
        rip = (rip or "").strip()
        if not rip or not _looks_like_ip(rip) or is_private_or_special(rip) or rip == ip:
            continue
        rinfo = await lookup_ip(rip)
        rcountry = (rinfo or {}).get("country_code", "")
        if rcountry and rcountry != "NP":
            logger.warning(f"[geo] WebRTC leak {rip} ({rcountry}) for client {ip}")
            return GeoVerdict(allowed=False, reason="webrtc_country_mismatch", country_code=country,
                              detail="Network identity check failed (WebRTC).")

    return GeoVerdict(allowed=True, reason="nepal", country_code=country,
                      detail="Verified inside Nepal.")


# ---------------------------------------------------------------------------
# Geo-pass JWT (HttpOnly cookie)
# ---------------------------------------------------------------------------

def create_geo_pass(ip: str) -> str:
    now = datetime.now(timezone.utc)
    minutes = int(_geo_setting("GEO_PASS_EXPIRE_MINUTES", 720))
    payload = {
        "sub": "geo-pass",
        "type": "geo_pass",
        "ip": ip,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def verify_geo_pass(token: str, client_ip: str) -> bool:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return False
    return (
        payload.get("type") == "geo_pass"
        and payload.get("sub") == "geo-pass"
        and payload.get("ip") == client_ip
    )


def set_geo_pass_cookie(response: Response, request: Request, token: str) -> None:
    minutes = int(_geo_setting("GEO_PASS_EXPIRE_MINUTES", 720))
    forwarded_proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    scheme = forwarded_proto or request.url.scheme
    response.set_cookie(
        key=GEO_PASS_COOKIE,
        value=token,
        max_age=minutes * 60,
        httponly=True,
        secure=(scheme == "https"),
        samesite="lax",
        path="/",
    )


async def try_issue_geo_pass_cookie(request: Request, response: Response) -> bool:
    """Best-effort geo-pass issuance (used by login). Never raises."""
    try:
        if has_proxy_headers(request):
            return False
        verdict = await evaluate_ip(get_client_ip(request))
        if verdict.allowed:
            set_geo_pass_cookie(response, request, create_geo_pass(get_client_ip(request)))
            return True
    except Exception as exc:  # never break the calling flow
        logger.warning(f"[geo] pass issuance failed: {exc}")
    return False


# ---------------------------------------------------------------------------
# FastAPI dependency: staff JWT or valid geo-pass
# ---------------------------------------------------------------------------

async def require_geo_entry(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_optional_current_user),
) -> bool:
    if user is not None:
        return True
    token = request.cookies.get(GEO_PASS_COOKIE)
    if token and verify_geo_pass(token, get_client_ip(request)):
        return True
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Geo World of KMC is available to viewers inside Nepal only. "
               "काठमाडौं महानगरपालिकाको जियो वर्ल्ड नेपालभित्रका दर्शकहरूका लागि मात्र उपलब्ध छ।",
    )


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class AccessCheckRequest(BaseModel):
    webrtc_ips: List[str] = Field(default_factory=list, description="Public IPs discovered via WebRTC")
    timezone: Optional[str] = Field(default=None, description="Intl timezone, e.g. Asia/Kathmandu")
    language: Optional[str] = Field(default=None, description="navigator.language")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

async def _check_access_rate_limit(request: Request) -> None:
    try:
        redis = await get_redis()
        ip = get_client_ip(request)
        key = f"geo_check_rl:{ip}"
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, 60)
        if count > 30:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                                detail="Too many access checks. Please wait a minute.")
    except HTTPException:
        raise
    except Exception:
        pass


@router.post("/access-check")
async def access_check(body: AccessCheckRequest, request: Request, response: Response):
    """
    Public entry gate for the Geo World of KMC. Runs the full server-side
    Nepal/VPN evaluation and, on success, issues the HttpOnly geo-pass cookie.
    """
    await _check_access_rate_limit(request)

    proxy_header = has_proxy_headers(request)
    if proxy_header:
        logger.warning(f"[geo] denied proxy header {proxy_header} from {get_client_ip(request)}")
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"ok": False, "reason": "proxy_headers",
                     "message": "Proxy connections are not permitted. / प्रोक्सी जडान अनुमति छैन।"},
        )

    verdict = await evaluate_ip(get_client_ip(request), body.webrtc_ips)

    # Advisory client signals (logged; server-side IP verdict is authoritative)
    tz_ok = (body.timezone or "") == "Asia/Kathmandu"
    if not verdict.allowed:
        logger.warning(f"[geo] denied {get_client_ip(request)}: {verdict.reason} tz={body.timezone}")
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"ok": False, "reason": verdict.reason, "message": verdict.detail},
        )

    token = create_geo_pass(get_client_ip(request))
    set_geo_pass_cookie(response, request, token)
    return {
        "ok": True,
        "country": verdict.country_code,
        "timezone_match": tz_ok,
        "expires_minutes": int(_geo_setting("GEO_PASS_EXPIRE_MINUTES", 720)),
        "message": "Welcome to the Geo World of KMC. / केएमसीको जियो वर्ल्डमा स्वागत छ।",
    }


@router.get("/verify")
async def verify_entry(request: Request):
    """Lightweight check used by the map page on load."""
    token = request.cookies.get(GEO_PASS_COOKIE)
    if token and verify_geo_pass(token, get_client_ip(request)):
        return {"ok": True}
    return JSONResponse(status_code=status.HTTP_401_UNAUTHORIZED, content={"ok": False})


@router.get("/tile-auth")
async def tile_auth(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_optional_current_user),
):
    """
    nginx `auth_request` target for /tiles/ and /geoportal/map.
    Returns 200 with an empty body on success, 403 otherwise.
    Accepts staff JWT (header/query) or the geo-pass cookie.
    """
    if user is not None:
        return Response(status_code=status.HTTP_200_OK)
    token = request.cookies.get(GEO_PASS_COOKIE)
    if token and verify_geo_pass(token, get_client_ip(request)):
        return Response(status_code=status.HTTP_200_OK)
    return Response(status_code=status.HTTP_403_FORBIDDEN)
