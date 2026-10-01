/**
 * Shared client-side helpers for the Geo World of KMC entry gate.
 *
 * The server-side IP evaluation is authoritative. These browser signals are
 * advisory cross-checks sent along with the access-check request:
 *  - WebRTC-discovered public IPs (a VPN tunnel usually leaks a foreign IP)
 *  - Intl timezone (expected: Asia/Kathmandu)
 *  - navigator.language
 */

import { geoAPI } from './api';

/** Best-effort WebRTC public-IP discovery via STUN. Never rejects. */
export function discoverWebRtcIps(timeoutMs = 3500) {
  return new Promise((resolve) => {
    const found = new Set();
    let pc = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { pc && pc.close(); } catch (_) {}
      resolve([...found]);
    };
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    } catch (_) {
      resolve([]);
      return;
    }
    const timer = setTimeout(finish, timeoutMs);
    try {
      pc.createDataChannel('kmc-geo');
      pc.onicecandidate = (e) => {
        if (!e || !e.candidate) {
          clearTimeout(timer);
          finish();
          return;
        }
        const m = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(e.candidate.candidate || '');
        if (m && !m[1].startsWith('0.')) found.add(m[1]);
      };
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => { clearTimeout(timer); finish(); });
    } catch (_) {
      clearTimeout(timer);
      finish();
    }
  });
}

/** Collect the advisory browser signals for an access-check request. */
export async function collectGeoSignals() {
  const [webrtcIps] = await Promise.all([
    discoverWebRtcIps(),
    new Promise((r) => setTimeout(r, 400)),
  ]);
  return {
    webrtc_ips: webrtcIps,
    timezone: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
    language: typeof navigator !== 'undefined' ? navigator.language : null,
  };
}

/**
 * Ensure the HttpOnly geo-pass cookie exists.
 * - verify() succeeds -> done.
 * - verify() 401 and a staff JWT is in localStorage -> re-mint via accessCheck.
 * - otherwise -> false (caller redirects to the landing gate).
 */
export async function ensureGeoPass() {
  try {
    await geoAPI.verify();
    return true;
  } catch (err) {
    if (err?.response?.status !== 401) return true; // network/other error: don't strand the user
  }
  const token = typeof window !== 'undefined' ? localStorage.getItem('kmc_access_token') : null;
  if (!token) return false;
  try {
    await geoAPI.accessCheck(await collectGeoSignals());
    return true;
  } catch (_) {
    return false;
  }
}
