'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ZoomIn, ZoomOut, Maximize, Compass, Layers, Check, Navigation, Loader2
} from 'lucide-react';

export default function GeoPortalMap({
  catalog,
  activeLayerIds,
  layerOpacities = {},
  layerOutlines = {},
  onExtentChange,
  onFeatureClick,
  activeBasemap = 'osm',
  basemapOpacity = 100,
  zoomToLayerTrigger = null,
}) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layersRef = useRef({
    basemaps: {},
    vectorTileLayers: {},
    rasterLayers: {},
  });

  const [olLoaded, setOlLoaded] = useState(false);
  const [olModules, setOlModules] = useState(null);
  const [mapRotation, setMapRotation] = useState(0);
  const [locating, setLocating] = useState(false);

  // Dynamic OpenLayers load (SSR-Safe)
  useEffect(() => {
    let isMounted = true;
    const loadOpenLayers = async () => {
      try {
        const [
          { default: Map },
          { default: View },
          { default: TileLayer },
          { default: VectorTileLayer },
          { default: OSM },
          { default: XYZ },
          { default: VectorTileSource },
          { default: MVT },
          { default: Style },
          { default: Fill },
          { default: Stroke },
          { default: CircleStyle },
          { fromLonLat, toLonLat, transformExtent },
        ] = await Promise.all([
          import('ol/Map'),
          import('ol/View'),
          import('ol/layer/Tile'),
          import('ol/layer/VectorTile'),
          import('ol/source/OSM'),
          import('ol/source/XYZ'),
          import('ol/source/VectorTile'),
          import('ol/format/MVT'),
          import('ol/style/Style'),
          import('ol/style/Fill'),
          import('ol/style/Stroke'),
          import('ol/style/Circle'),
          import('ol/proj'),
        ]);

        if (isMounted) {
          setOlModules({
            Map, View, TileLayer, VectorTileLayer,
            OSM, XYZ, VectorTileSource, MVT,
            Style, Fill, Stroke, CircleStyle,
            fromLonLat, toLonLat, transformExtent,
          });
          setOlLoaded(true);
        }
      } catch (err) {
        console.error('OpenLayers dynamic load error in GeoPortalMap:', err);
      }
    };
    loadOpenLayers();
    return () => { isMounted = false; };
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!olLoaded || !olModules || !mapRef.current || mapInstance.current) return;

    const {
      Map, View, TileLayer, OSM, XYZ, fromLonLat, toLonLat
    } = olModules;

    const ktmCenter = fromLonLat([85.3240, 27.7172]);

    // 1. OpenStreetMap (OSM — Official Public Default)
    const osmLayer = new TileLayer({
      source: new OSM(),
      visible: true,
    });

    // 2. ESRI World Imagery — Crystal Clear Satellite (No watermark)
    const esriLayer = new TileLayer({
      source: new XYZ({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maxZoom: 19,
      }),
      visible: false,
    });

    // 3. Google Satellite (clean stream, no apikey overlay)
    const googleSatellite = new TileLayer({
      source: new XYZ({
        url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        maxZoom: 20,
      }),
      visible: false,
    });

    // 4. Google Roads
    const googleRoads = new TileLayer({
      source: new XYZ({
        url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        maxZoom: 20,
      }),
      visible: false,
    });

    // 5. Carto Dark
    const cartoDark = new TileLayer({
      source: new XYZ({
        url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        maxZoom: 20,
      }),
      visible: false,
    });

    layersRef.current.basemaps = {
      esri: esriLayer,
      google: googleSatellite,
      osm: osmLayer,
      road: googleRoads,
      dark: cartoDark,
    };

    const map = new Map({
      target: mapRef.current,
      layers: [esriLayer, googleSatellite, osmLayer, googleRoads, cartoDark],
      view: new View({
        center: ktmCenter,
        zoom: 13,
        minZoom: 9,
        maxZoom: 22,
      }),
      controls: [],
    });

    mapInstance.current = map;

    // View Rotation Listener
    map.getView().on('change:rotation', () => {
      setMapRotation(map.getView().getRotation());
    });

    // Extent Change Listener
    let extentTimer;
    map.on('moveend', () => {
      clearTimeout(extentTimer);
      extentTimer = setTimeout(() => {
        try {
          const extent = map.getView().calculateExtent(map.getSize());
          const [w, s] = toLonLat([extent[0], extent[1]]);
          const [e, n] = toLonLat([extent[2], extent[3]]);
          onExtentChange?.([
            parseFloat(w.toFixed(6)),
            parseFloat(s.toFixed(6)),
            parseFloat(e.toFixed(6)),
            parseFloat(n.toFixed(6)),
          ]);
        } catch (e) {}
      }, 300);
    });

    // Feature Click Listener
    map.on('singleclick', (evt) => {
      const feature = map.forEachFeatureAtPixel(evt.pixel, (f, layer) => {
        return { feature: f, layer };
      });

      if (feature && feature.feature) {
        onFeatureClick?.({
          properties: feature.feature.getProperties(),
          layerName: feature.layer?.get('layerName') || 'Vector Feature',
          layerId: feature.layer?.get('layerId'),
        });
      } else {
        onFeatureClick?.(null);
      }
    });

    return () => {
      map.setTarget(null);
      mapInstance.current = null;
    };
  }, [olLoaded, olModules]);

  // Sync Basemap selection and opacity from props
  useEffect(() => {
    if (!mapInstance.current || !layersRef.current.basemaps) return;
    const bms = layersRef.current.basemaps;
    const opacityVal = Math.max(0, Math.min(1, (basemapOpacity ?? 100) / 100));

    Object.keys(bms).forEach((k) => {
      const isCurrent = k === activeBasemap && activeBasemap !== 'none';
      bms[k].setVisible(isCurrent);
      if (isCurrent) {
        bms[k].setOpacity(opacityVal);
      }
    });
  }, [activeBasemap, basemapOpacity]);

  // Handle Zoom to Layer Trigger
  useEffect(() => {
    if (!mapInstance.current || !olModules || !zoomToLayerTrigger?.bounds) return;
    const { transformExtent } = olModules;
    const [w, s, e, n] = zoomToLayerTrigger.bounds;
    try {
      const olExtent = transformExtent([w, s, e, n], 'EPSG:4326', 'EPSG:3857');
      const view = mapInstance.current.getView();
      view.fit(olExtent, {
        padding: [80, 80, 80, 80],
        duration: 800,
        maxZoom: 19,
      });
    } catch (err) {
      console.warn('Could not fit layer extent:', err);
    }
  }, [zoomToLayerTrigger, olModules]);

  // Sync Layers
  useEffect(() => {
    if (!mapInstance.current || !olModules || !catalog) return;
    const {
      VectorTileLayer, VectorTileSource, TileLayer, XYZ, MVT,
      Style, Fill, Stroke, CircleStyle
    } = olModules;
    const map = mapInstance.current;

    const allLayers = catalog.categories?.flatMap((c) => c.layers) || [];

    allLayers.forEach((layer) => {
      const layerKey = `${layer.type}_${layer.id}`;
      const isLayerActive = activeLayerIds.has(layerKey);
      const layerOpacity = layerOpacities[layerKey] !== undefined ? layerOpacities[layerKey] : 1.0;

      if (layer.type === 'vector') {
        let vtLayer = layersRef.current.vectorTileLayers[layer.id];

        if (isLayerActive) {
          const isPolygon = (layer.geometry_type || '').toUpperCase().includes('POLYGON') || (layer.geometry_type || '').toUpperCase() === 'GEOMETRY';
          const isOutlined = layerOutlines[layer.id] !== undefined ? layerOutlines[layer.id] : true;
          const strokeColor = layer.style?.strokeColor || '#0447AF';
          const fillColor = layer.style?.fillColor || '#0447AF';
          const strokeWidth = layer.style?.strokeWidth || 2;
          const pointRadius = layer.style?.pointRadius || 6;

          // If polygon and isOutlined: transparent fill so satellite/orthophoto base and polygon boundary are crisp
          // If outline is turned off: standard semi-transparent fill
          const vtStyle = new Style({
            fill: (isPolygon && isOutlined)
              ? new Fill({ color: 'rgba(0, 0, 0, 0)' })
              : new Fill({ color: `${fillColor}66` }),
            stroke: new Stroke({
              color: strokeColor,
              width: (isPolygon && isOutlined) ? Math.max(strokeWidth, 2.5) : strokeWidth,
            }),
            image: new CircleStyle({
              radius: pointRadius,
              fill: new Fill({ color: fillColor }),
              stroke: new Stroke({ color: strokeColor, width: 1.5 }),
            }),
          });

          if (!vtLayer) {
            vtLayer = new VectorTileLayer({
              source: new VectorTileSource({
                format: new MVT(),
                url: layer.tile_url,
                maxZoom: 22,
                cacheSize: 512,
              }),
              style: vtStyle,
              opacity: layerOpacity,
              zIndex: 10 + (layer.display_order || 0),
              renderBuffer: 128,
              declutter: false,
            });

            vtLayer.set('layerId', layer.id);
            vtLayer.set('layerName', layer.name);

            map.addLayer(vtLayer);
            layersRef.current.vectorTileLayers[layer.id] = vtLayer;
          } else {
            vtLayer.setVisible(true);
            vtLayer.setOpacity(layerOpacity);
            vtLayer.setStyle(vtStyle);
            vtLayer.changed();
          }
        } else if (vtLayer) {
          vtLayer.setVisible(false);
        }
      } else if (layer.type === 'raster') {
        let rLayer = layersRef.current.rasterLayers[layer.id];

        if (isLayerActive) {
          if (!rLayer) {
            rLayer = new TileLayer({
              source: new XYZ({
                url: layer.tile_url,
                maxZoom: layer.max_zoom || 22,
                minZoom: layer.min_zoom || 0,
              }),
              opacity: layerOpacity,
              zIndex: 5 + (layer.display_order || 0),
            });
            rLayer.set('layerId', layer.id);
            rLayer.set('layerName', layer.name);

            map.addLayer(rLayer);
            layersRef.current.rasterLayers[layer.id] = rLayer;
          } else {
            rLayer.setVisible(true);
            rLayer.setOpacity(layerOpacity);
          }
        } else if (rLayer) {
          rLayer.setVisible(false);
        }
      }
    });
  }, [activeLayerIds, layerOpacities, layerOutlines, catalog, olModules]);

  // Controls
  const handleZoomIn = () => {
    if (!mapInstance.current) return;
    const view = mapInstance.current.getView();
    view.animate({ zoom: view.getZoom() + 1, duration: 250 });
  };

  const handleZoomOut = () => {
    if (!mapInstance.current) return;
    const view = mapInstance.current.getView();
    view.animate({ zoom: view.getZoom() - 1, duration: 250 });
  };

  // Zoom to user's GPS Location
  const handleZoomToMyLocation = () => {
    if (!mapInstance.current || !olModules) return;
    if (typeof window === 'undefined' || !navigator.geolocation) {
      alert('यस ब्राउजरमा जीपीएस सुविधा उपलब्ध छैन (Geolocation is not supported by your browser)');
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { longitude, latitude } = pos.coords;
        const { fromLonLat } = olModules;
        const view = mapInstance.current.getView();
        view.animate({
          center: fromLonLat([longitude, latitude]),
          zoom: 17,
          duration: 600,
        });
      },
      (err) => {
        setLocating(false);
        console.warn('Geolocation error:', err);
        alert('जीपीएस स्थान पत्ता लगाउन सकिएन। कृपया ब्राउजरमा Location अनुमति दिनुहोस्। (Unable to retrieve your GPS location. Please check browser permissions.)');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  // Reset to North & Center Kathmandu
  const handleResetToNorth = () => {
    if (!mapInstance.current || !olModules) return;
    const { fromLonLat } = olModules;
    const view = mapInstance.current.getView();
    const currentRot = view.getRotation();

    if (Math.abs(currentRot) > 0.01) {
      view.animate({
        rotation: 0,
        duration: 400,
      });
    } else {
      // If already facing North, recenter to Kathmandu City Center
      view.animate({
        center: fromLonLat([85.3240, 27.7172]),
        zoom: 13,
        duration: 500,
      });
    }
  };

  return (
    <div className="w-full h-full relative overflow-hidden">
      <div ref={mapRef} className="w-full h-full" />

      {/* Floating Map Navigation Controls — Top Left */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-1.5 shadow-lg rounded-xl overflow-hidden bg-white/95 backdrop-blur-md border border-slate-200 p-1">
        <button
          onClick={handleZoomIn}
          className="p-2 hover:bg-slate-100 text-slate-700 rounded-lg transition-colors"
          title="जुम इन (Zoom In)"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={handleZoomOut}
          className="p-2 hover:bg-slate-100 text-slate-700 rounded-lg transition-colors"
          title="जुम आउट (Zoom Out)"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={handleZoomToMyLocation}
          disabled={locating}
          className="p-2 hover:bg-gov-blue-50 text-gov-blue-800 rounded-lg transition-colors group"
          title="मेरो हालको स्थानमा जुम गर्नुहोस् (Zoom to My Location)"
        >
          {locating ? (
            <Loader2 className="w-4 h-4 animate-spin text-gov-blue-800" />
          ) : (
            <Navigation className="w-4 h-4 group-hover:scale-110 transition-transform" />
          )}
        </button>
        <button
          onClick={handleResetToNorth}
          className="p-2 hover:bg-gov-blue-50 text-gov-blue-800 rounded-lg transition-colors group"
          title="उत्तर दिशा रिसेट / काठमाडौँ केन्द्र (Reset to North & Center Kathmandu)"
        >
          <Compass
            className="w-4 h-4 group-hover:scale-110 transition-transform"
            style={{ transform: `rotate(${-mapRotation}rad)` }}
          />
        </button>
      </div>
    </div>
  );
}
