'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ZoomIn, ZoomOut, Maximize, Compass, Layers, Check, Navigation, Loader2, Eye, EyeOff, PenTool, MapPin
} from 'lucide-react';

// Attractive categorical palette for the 32 municipal wards
const WARD_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#84cc16',
];

function wardBaseColor(wardNo) {
  const n = Number(wardNo) || 0;
  return WARD_PALETTE[(n - 1 + WARD_PALETTE.length) % WARD_PALETTE.length];
}

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

  // Municipal ward boundaries (always-on layer)
  const [wardOutlineOnly, setWardOutlineOnly] = useState(false);
  const [wardVisible, setWardVisible] = useState(true);
  const [wardList, setWardList] = useState([]); // [ward_no, ...] sorted
  const [hoveredWard, setHoveredWard] = useState(null);
  const [wardZoomSel, setWardZoomSel] = useState('');
  const wardLayerRef = useRef(null);
  const wardSourceRef = useRef(null);
  const wardOutlineOnlyRef = useRef(false);
  const hoveredWardRef = useRef(null);

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
          { default: VectorLayer },
          { default: OSM },
          { default: XYZ },
          { default: VectorTileSource },
          { default: VectorSource },
          { default: MVT },
          { default: GeoJSON },
          { default: Style },
          { default: Fill },
          { default: Stroke },
          { default: CircleStyle },
          { default: Text },
          { fromLonLat, toLonLat, transformExtent },
        ] = await Promise.all([
          import('ol/Map'),
          import('ol/View'),
          import('ol/layer/Tile'),
          import('ol/layer/VectorTile'),
          import('ol/layer/Vector'),
          import('ol/source/OSM'),
          import('ol/source/XYZ'),
          import('ol/source/VectorTile'),
          import('ol/source/Vector'),
          import('ol/format/MVT'),
          import('ol/format/GeoJSON'),
          import('ol/style/Style'),
          import('ol/style/Fill'),
          import('ol/style/Stroke'),
          import('ol/style/Circle'),
          import('ol/style/Text'),
          import('ol/proj'),
        ]);

        if (isMounted) {
          setOlModules({
            Map, View, TileLayer, VectorTileLayer, VectorLayer,
            OSM, XYZ, VectorTileSource, VectorSource, MVT, GeoJSON,
            Style, Fill, Stroke, CircleStyle, Text,
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

  // Ward boundary style (attractive municipal look: soft categorical fill,
  // crisp darker edge, ward-number label, hover emphasis)
  const wardStyleFn = useCallback((feature) => {
    if (!olModules) return [];
    const { Style, Fill, Stroke, Text } = olModules;
    const wn = feature.get('ward_no');
    const base = wardBaseColor(wn);
    const isHover = hoveredWardRef.current != null && String(hoveredWardRef.current) === String(wn);
    const outlineOnly = wardOutlineOnlyRef.current;
    const styles = [
      new Style({
        fill: new Fill({ color: outlineOnly ? 'rgba(0,0,0,0)' : `${base}2e` }),
        stroke: new Stroke({ color: isHover ? '#0f172a' : base, width: isHover ? 3.5 : 1.8 }),
      }),
    ];
    // Ward number label on the polygon interior point (only when zoomed in a bit)
    try {
      const zoom = mapInstance.current ? mapInstance.current.getView().getZoom() : 13;
      if (zoom >= 11) {
        const geom = feature.getGeometry();
        const labelGeom = geom && typeof geom.getInteriorPoint === 'function' ? geom.getInteriorPoint() : null;
        styles.push(
          new Style({
            geometry: labelGeom || undefined,
            text: new Text({
              text: `वडा ${wn}`,
              font: `700 ${isHover ? 13 : 11}px sans-serif`,
              fill: new Fill({ color: isHover ? '#0f172a' : '#1e293b' }),
              stroke: new Stroke({ color: 'rgba(255,255,255,0.95)', width: 3 }),
              overflow: true,
            }),
          })
        );
      }
    } catch (e) {}
    return styles;
  }, [olModules]);

  // Keep refs in sync for the style function
  useEffect(() => {
    wardOutlineOnlyRef.current = wardOutlineOnly;
    if (wardLayerRef.current) wardLayerRef.current.changed();
  }, [wardOutlineOnly]);
  useEffect(() => {
    hoveredWardRef.current = hoveredWard;
    if (wardLayerRef.current) wardLayerRef.current.changed();
  }, [hoveredWard]);
  useEffect(() => {
    if (wardLayerRef.current) wardLayerRef.current.setVisible(wardVisible);
  }, [wardVisible]);

  // Load municipal ward boundaries (default ON, no catalog toggle needed)
  useEffect(() => {
    if (!olLoaded || !olModules || !mapInstance.current || wardLayerRef.current) return;
    let cancelled = false;
    const { VectorLayer, VectorSource, GeoJSON } = olModules;

    fetch('/geoportal/wards.geojson')
      .then((res) => {
        if (!res.ok) throw new Error(`wards.geojson HTTP ${res.status}`);
        return res.json();
      })
      .then((fc) => {
        if (cancelled || !mapInstance.current) return;
        const format = new GeoJSON();
        const features = format.readFeatures(fc, {
          dataProjection: 'EPSG:4326',
          featureProjection: 'EPSG:3857',
        });
        features.forEach((f) => {
          const wn = f.get('ward_no');
          f.setProperties({
            ward_no: wn,
            name: `वडा नं. ${wn}`,
            municipality: 'काठमाडौँ महानगरपालिका',
          });
          try {
            const areaKm2 = f.getGeometry().getArea() / 1e6;
            f.set('area_km2', Math.round(areaKm2 * 100) / 100);
          } catch (e) {}
        });
        const source = new VectorSource({ features });
        const layer = new VectorLayer({
          source,
          zIndex: 9,
          style: (feature) => wardStyleFn(feature),
          visible: true,
        });
        layer.set('layerName', 'वडा सीमा (Ward Boundary)');
        layer.set('layerId', 'wards');
        mapInstance.current.addLayer(layer);
        wardLayerRef.current = layer;
        wardSourceRef.current = source;
        const list = features
          .map((f) => Number(f.get('ward_no')))
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b);
        setWardList(list);
      })
      .catch((err) => console.warn('[GeoPortal] Ward boundaries failed to load:', err));

    return () => {
      cancelled = true;
    };
  }, [olLoaded, olModules, wardStyleFn]);

  // Ward hover highlight + pointer cursor
  useEffect(() => {
    if (!olLoaded || !olModules || !mapInstance.current) return;
    const map = mapInstance.current;
    const onMove = (evt) => {
      if (evt.dragging) return;
      const wardLayer = wardLayerRef.current;
      if (!wardLayer || !wardLayer.getVisible()) {
        setHoveredWard(null);
        return;
      }
      const feat = map.forEachFeatureAtPixel(
        evt.pixel,
        (f) => f,
        { layerFilter: (l) => l === wardLayer, hitTolerance: 2 }
      );
      const wn = feat ? feat.get('ward_no') : null;
      setHoveredWard((prev) => (String(prev) !== String(wn) ? wn : prev));
      try {
        map.getTargetElement().style.cursor = feat ? 'pointer' : '';
      } catch (e) {}
    };
    map.on('pointermove', onMove);
    return () => {
      try {
        map.un('pointermove', onMove);
      } catch (e) {}
    };
  }, [olLoaded, olModules]);

  // Zoom to a chosen ward
  const zoomToWard = useCallback((wardNo) => {
    if (!wardNo || !wardSourceRef.current || !mapInstance.current) return;
    const match = wardSourceRef.current.getFeatures().find(
      (f) => String(f.get('ward_no')) === String(wardNo)
    );
    if (!match) return;
    try {
      const extent = match.getGeometry().getExtent();
      mapInstance.current.getView().fit(extent, {
        padding: [70, 70, 70, 70],
        duration: 700,
        maxZoom: 16,
      });
    } catch (e) {}
  }, []);

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
      {/* Municipal Ward Boundaries control — bottom right */}
      <div className="absolute bottom-6 right-4 z-20 w-52 shadow-xl rounded-xl overflow-hidden bg-white/95 backdrop-blur-md border border-slate-200">
        <div className="flex items-center justify-between px-3 py-2 bg-gov-blue-900 text-white">
          <span className="flex items-center gap-1.5 text-[11px] font-bold font-nepali">
            <MapPin className="w-3.5 h-3.5 text-gov-gold-400" />
            वडा सीमाना
          </span>
          <button
            onClick={() => setWardVisible((v) => !v)}
            className="p-1 hover:bg-white/15 rounded transition-colors"
            title={wardVisible ? 'वडा सीमा लुकाउनुहोस् (Hide)' : 'वडा सीमा देखाउनुहोस् (Show)'}
          >
            {wardVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
        </div>
        {wardVisible && (
          <div className="p-2.5 flex flex-col gap-2">
            <button
              onClick={() => setWardOutlineOnly((v) => !v)}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[11px] font-bold font-nepali border transition-colors ${
                wardOutlineOnly
                  ? 'bg-gov-blue-800 text-white border-gov-blue-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
              title="वडा सीमाको बाहिरी रेखा मात्र देखाउनुहोस् (Outline only)"
            >
              <PenTool className="w-3.5 h-3.5" />
              {wardOutlineOnly ? 'रंग भर्नुहोस् (Fill)' : 'रेखा मात्र (Outline)'}
            </button>
            <label className="text-[10px] font-bold text-slate-500 font-nepali">
              वडामा जुम गर्नुहोस्
              <select
                value={wardZoomSel}
                onChange={(e) => {
                  setWardZoomSel(e.target.value);
                  if (e.target.value) zoomToWard(e.target.value);
                }}
                className="mt-1 w-full text-[11px] font-sans border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-gov-blue-500"
              >
                <option value="">वडा छान्नुहोस्…</option>
                {wardList.map((wn) => (
                  <option key={wn} value={wn}>
                    वडा नं. {wn} (Ward {wn})
                  </option>
                ))}
              </select>
            </label>
            {hoveredWard != null && (
              <div className="text-[11px] font-bold text-gov-blue-900 font-nepali bg-gov-blue-50 border border-gov-blue-200 rounded-lg px-2 py-1 text-center">
                वडा नं. {hoveredWard}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
