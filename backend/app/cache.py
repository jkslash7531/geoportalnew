"""
KMC-GIS-SERVER — Centralized Cache and Invalidation Helpers (Redis)
Provides high-speed caching for Vector Tiles (MVT) and GeoJSON FeatureCollections,
with instant cache invalidation upon any feature edit, creation, or deletion.
"""
import logging
from typing import Optional
from app.auth import get_redis

logger = logging.getLogger(__name__)


async def invalidate_layer_cache(layer_id: int):
    """
    Purge all cached MVT vector tiles and GeoJSON feature collections for a specific layer.
    Called immediately whenever a feature is created, updated, or deleted,
    guaranteeing that both Field Data Collection and GeoPortal serve fresh data in real-time.
    """
    try:
        redis_client = await get_redis()
        # 1. Invalidate full GeoJSON cache
        await redis_client.delete(f"layer_geojson:{layer_id}")

        # 2. Invalidate analytics cache related to this layer
        try:
            analytics_cursor = b"0"
            analytics_keys = []
            while analytics_cursor:
                analytics_cursor, keys = await redis_client.scan(cursor=analytics_cursor, match=f"gis_analytics:*", count=250)
                if keys:
                    analytics_keys.extend(keys)
                if analytics_cursor == 0 or analytics_cursor == b"0":
                    break
            if analytics_keys:
                await redis_client.delete(*analytics_keys)
        except Exception:
            pass

        # 3. Scan and delete all cached MVT tiles for this layer
        pattern = f"mvt_tile:{layer_id}:*"
        cursor = b"0"
        keys_to_delete = []
        while cursor:
            cursor, keys = await redis_client.scan(cursor=cursor, match=pattern, count=250)
            if keys:
                keys_to_delete.extend(keys)
            if cursor == 0 or cursor == b"0":
                break

        if keys_to_delete:
            await redis_client.delete(*keys_to_delete)

        logger.info(f"[Cache] Successfully invalidated cache for layer {layer_id} ({len(keys_to_delete)} MVT tiles purged)")
    except Exception as e:
        logger.warning(f"[Cache] Failed to invalidate cache for layer {layer_id}: {e}")
