# Optional local MaxMind GeoLite2 databases

The Nepal-only access gate works out of the box using the free ip-api.com
service (with 24h Redis caching per IP). For fully offline operation, or
higher lookup reliability, drop the free MaxMind GeoLite2 databases here:

- `GeoLite2-Country.mmdb`
- `GeoLite2-ASN.mmdb`

Get them free at https://www.maxmind.com/en/geolite2/signup — then:

```bash
cp ~/Downloads/GeoLite2-Country.mmdb backend/geoip/
cp ~/Downloads/GeoLite2-ASN.mmdb backend/geoip/
docker compose up --build
```

When these files exist they take priority over the online lookup.
