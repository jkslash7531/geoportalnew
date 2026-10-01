'use client';

import { useState, useMemo } from 'react';
import {
  Layers, Database, Image, ChevronDown, ChevronUp, Eye, EyeOff,
  Sliders, Info, Check, Sparkles, X, Maximize2, Shield,
  Search, Lock, Globe, Map, Satellite, Compass, Moon, Ban, Square
} from 'lucide-react';

/**
 * LayerControl / LayerCatalogPanel Component — Matching Field Data Collection Design
 * Kathmandu Metropolitan City (काठमाडौँ महानगरपालिका)
 */
export default function LayerCatalogPanel({
  catalog,
  activeLayerIds,
  onToggleLayer,
  onOpacityChange,
  layerOpacities = {},
  layerOutlines = {},
  onToggleOutline,
  onSelectLayerForAnalytics,
  selectedAnalyticsLayerId,
  onZoomToLayer,
  onOpenMetadata,
  onConfigureLayer, // GIS Admin config modal trigger
  isCollapsed,
  onToggleCollapse,
  user,
  activeBasemap = 'osm',
  onBasemapChange,
  basemapOpacity = 100,
  onBasemapOpacityChange,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showBasemaps, setShowBasemaps] = useState(false);
  const [showRasters, setShowRasters] = useState(true);
  const [showVectors, setShowVectors] = useState(true);

  const basemaps = [
    { id: 'osm', label: 'OSM खुला सडक', icon: Map, color: 'text-gov-blue-800' },
    { id: 'esri', label: 'Esri स्याटेलाइट', icon: Satellite, color: 'text-emerald-700' },
    { id: 'google', label: 'गुगल अर्थ (Satellite)', icon: Globe, color: 'text-amber-600' },
    { id: 'road', label: 'गुगल सडक (Roads)', icon: Compass, color: 'text-blue-600' },
    { id: 'dark', label: 'रात्रिकालीन नक्सा (Dark)', icon: Moon, color: 'text-purple-600' },
    { id: 'none', label: 'कुनै पनि होइन (None)', icon: Ban, color: 'text-gov-red-700' },
  ];

  const isGisAdmin = user?.role === 'GisAdmin' || user?.role === 'SuperAdmin';

  // Extract all vector and raster layers from catalog
  const { allVectors, allRasters } = useMemo(() => {
    const vectors = [];
    const rasters = [];
    const seenVec = new Set();
    const seenRast = new Set();

    (catalog?.categories || []).forEach((cat) => {
      (cat.layers || []).forEach((lyr) => {
        if (lyr.type === 'vector' && !seenVec.has(lyr.id)) {
          seenVec.add(lyr.id);
          vectors.push(lyr);
        } else if (lyr.type === 'raster' && !seenRast.has(lyr.id)) {
          seenRast.add(lyr.id);
          rasters.push(lyr);
        }
      });
    });

    return { allVectors: vectors, allRasters: rasters };
  }, [catalog]);

  // Filter by search
  const filteredVectors = useMemo(() => {
    if (!searchTerm.trim()) return allVectors;
    const term = searchTerm.toLowerCase();
    return allVectors.filter(
      (l) =>
        l.name.toLowerCase().includes(term) ||
        (l.description && l.description.toLowerCase().includes(term)) ||
        (l.category && l.category.toLowerCase().includes(term))
    );
  }, [allVectors, searchTerm]);

  const filteredRasters = useMemo(() => {
    if (!searchTerm.trim()) return allRasters;
    const term = searchTerm.toLowerCase();
    return allRasters.filter(
      (l) =>
        l.name.toLowerCase().includes(term) ||
        (l.description && l.description.toLowerCase().includes(term)) ||
        (l.category && l.category.toLowerCase().includes(term))
    );
  }, [allRasters, searchTerm]);

  const totalCount = allVectors.length + allRasters.length;

  return (
    <div className="flex flex-col items-end" id="layer-control-panel">
      {/* 1. Field Data Style Toggle Button */}
      <button
        onClick={onToggleCollapse}
        className="bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-lg p-2 sm:px-3 sm:py-2 flex items-center gap-2 shadow-md transition-all mb-1.5 shrink-0"
        title="तह व्यवस्थापन (GIS Layers)"
      >
        <div className="w-5 h-5 rounded bg-gov-blue-800 text-white flex items-center justify-center shrink-0">
          <Layers className="w-3.5 h-3.5" />
        </div>
        <div className="text-left hidden sm:block">
          <span className="text-xs font-bold text-gov-blue-900 block leading-tight font-nepali">
            तह व्यवस्थापन (GIS Layers)
          </span>
          <span className="text-[10px] text-slate-500 block leading-tight">
            {totalCount} तहहरू उपलब्ध
          </span>
        </div>
        {!isCollapsed ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>

      {/* 2. Field Data Style Expanded Panel Card */}
      {!isCollapsed && (
        <div className="w-[360px] max-w-[calc(100vw-24px)] max-h-[calc(100dvh-130px)] sm:max-h-[calc(100dvh-140px)] flex flex-col min-h-0 bg-white border border-slate-300 rounded-xl shadow-2xl text-slate-800 animate-slide-up overflow-hidden pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]">
          {/* Pinned Header Banner with Close Button */}
          <div className="bg-gov-blue-800 text-white px-3 py-2 flex items-center justify-between text-xs font-bold font-nepali shrink-0 shadow-sm">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-gov-gold-400" />
              भू-स्थानिक तह नियन्त्रण (Spatial Layers)
            </span>
            <button
              onClick={onToggleCollapse}
              className="text-white/80 hover:text-white hover:bg-gov-blue-700 p-0.5 rounded transition-colors"
              title="बन्द गर्नुहोस् (Close)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Search Box */}
          <div className="p-2 border-b border-slate-200 bg-slate-50/90 shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="तह खोज्नुहोस् (Search layers)..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 focus:ring-2 focus:ring-gov-blue-800 transition-all placeholder:text-slate-400"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Scrollable Content Body */}
          <div className="overflow-y-auto p-2.5 space-y-2 flex-1 min-h-0 overscroll-contain scrollbar-thin">
            {/* ========================================================= */}
            {/* 1. BASEMAPS SECTION (आधारभूत नक्सा) — Matching Field Data */}
            {/* ========================================================= */}
            <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200">
              <button
                type="button"
                onClick={() => setShowBasemaps(!showBasemaps)}
                className="flex items-center justify-between w-full pb-1 text-xs font-bold text-slate-700 uppercase tracking-wider font-nepali"
              >
                <span className="flex items-center gap-1.5">
                  <Map className="w-3.5 h-3.5 text-gov-blue-800" />
                  आधारभूत नक्सा (Basemaps)
                </span>
                {showBasemaps ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              {showBasemaps && (
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-1.5">
                    {basemaps.map((bm) => {
                      const Icon = bm.icon;
                      const isSelected = activeBasemap === bm.id;
                      return (
                        <button
                          key={bm.id}
                          type="button"
                          onClick={() => onBasemapChange?.(bm.id)}
                          className={`flex items-center gap-2 p-2 rounded-md text-xs transition-all border text-left ${
                            isSelected
                              ? 'bg-gov-blue-50 text-gov-blue-900 border-gov-blue-800 font-bold shadow-sm ring-1 ring-gov-blue-800'
                              : 'bg-white text-slate-700 hover:bg-slate-100 border-slate-200 font-medium'
                          }`}
                        >
                          <Icon className={`w-4 h-4 shrink-0 ${isSelected ? bm.color : 'text-slate-400'}`} />
                          <span className="text-[11px] truncate w-full">{bm.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Basemap Opacity */}
                  {activeBasemap !== 'none' && (
                    <div className="pt-2 border-t border-slate-200">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 mb-1">
                        <span>नक्सा पारदर्शिता (Opacity)</span>
                        <span className="text-gov-blue-800 font-mono font-bold">{basemapOpacity}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={basemapOpacity}
                        onChange={(e) => onBasemapOpacityChange?.(parseInt(e.target.value, 10))}
                        className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-gov-blue-800"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ========================================================= */}
            {/* 2. SERVER RASTER (DRONE & MBTILES IMAGERY) */}
            {/* ========================================================= */}
            <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200">
              <button
                type="button"
                onClick={() => setShowRasters(!showRasters)}
                className="flex items-center justify-between w-full pb-1 text-xs font-bold text-slate-700 uppercase tracking-wider font-nepali"
              >
                <span className="flex items-center gap-1.5">
                  <Image className="w-3.5 h-3.5 text-gov-blue-800" />
                  ड्रोन तथा रास्टर इमेज्री ({allRasters.length})
                </span>
                {showRasters ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              {showRasters && (
                <div className="mt-2 space-y-1.5">
                  {filteredRasters.length === 0 ? (
                    <p className="text-[11px] text-slate-500 py-1 text-center italic font-nepali">
                      कुनै रास्टर इमेज्री फेला परेन
                    </p>
                  ) : (
                    filteredRasters.map((raster) => {
                      const rasterKey = `raster_${raster.id}`;
                      const isVisible = activeLayerIds.has(rasterKey);
                      const opacity = layerOpacities[rasterKey] !== undefined
                        ? Math.round(layerOpacities[rasterKey] * 100)
                        : 100;
                      const access = raster.access_level || 'public';

                      return (
                        <div
                          key={`raster-${raster.id}`}
                          className={`p-2 rounded-md border transition-all ${
                            isVisible
                              ? 'bg-white border-gov-blue-200 shadow-sm'
                              : 'bg-slate-100 border-slate-200 opacity-70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <button
                              type="button"
                              onClick={() => onToggleLayer(raster)}
                              className="flex items-center gap-2 flex-1 text-left min-w-0"
                            >
                              {isVisible ? (
                                <Eye className="w-4 h-4 text-gov-blue-800 shrink-0" />
                              ) : (
                                <EyeOff className="w-4 h-4 text-slate-400 shrink-0" />
                              )}
                              <div className="truncate">
                                <span className="text-xs font-bold text-slate-800 truncate block font-nepali">
                                  {raster.name}
                                </span>
                                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                  <span className="px-1 py-0 rounded text-[9px] font-bold bg-purple-100 text-purple-800">
                                    {raster.category || 'Base Maps'}
                                  </span>
                                  {access === 'validator' && (
                                    <span className="px-1 py-0 rounded text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                      🛡️ Validator
                                    </span>
                                  )}
                                  {access === 'admin_only' && (
                                    <span className="px-1 py-0 rounded text-[9px] font-bold bg-red-50 text-red-700 border border-red-200">
                                      🔒 Admin
                                    </span>
                                  )}
                                </span>
                              </div>
                            </button>

                            <div className="flex items-center gap-0.5 shrink-0">
                              {/* Zoom to Layer Extent Button */}
                              {raster.bounds && onZoomToLayer && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onZoomToLayer(raster);
                                  }}
                                  className="p-1 text-slate-400 hover:text-purple-800 hover:bg-purple-50 rounded transition-colors"
                                  title="तहमा जुम गर्नुहोस् (Zoom to Layer Extent)"
                                >
                                  <Maximize2 className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* GIS Admin Access Setting Button */}
                              {isGisAdmin && onConfigureLayer && (
                                <button
                                  type="button"
                                  onClick={() => onConfigureLayer(raster)}
                                  className="p-1 text-slate-400 hover:text-gov-blue-800 hover:bg-gov-blue-50 rounded transition-colors"
                                  title="तह पहुँच व्यवस्थापन (Configure Access)"
                                >
                                  <Sliders className="w-3.5 h-3.5 text-gov-blue-800" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Opacity Slider */}
                          {isVisible && (
                            <div className="mt-1.5 pt-1.5 border-t border-slate-100">
                              <div className="flex items-center justify-between text-[10px] text-slate-600 mb-0.5">
                                <span>पारदर्शिता (Opacity)</span>
                                <span className="font-mono font-bold text-gov-blue-800">{opacity}%</span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={opacity}
                                onChange={(e) => onOpacityChange(rasterKey, parseInt(e.target.value, 10) / 100)}
                                className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-gov-blue-800"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* ========================================================= */}
            {/* 2. SERVER VECTOR (POSTGIS / GEOJSON) */}
            {/* ========================================================= */}
            <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200">
              <button
                type="button"
                onClick={() => setShowVectors(!showVectors)}
                className="flex items-center justify-between w-full pb-1 text-xs font-bold text-slate-700 uppercase tracking-wider font-nepali"
              >
                <span className="flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-gov-blue-800" />
                  भेक्टर तहहरू ({allVectors.length})
                </span>
                {showVectors ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              {showVectors && (
                <div className="mt-2 space-y-1.5">
                  {filteredVectors.length === 0 ? (
                    <p className="text-[11px] text-slate-500 py-1 text-center italic font-nepali">
                      कुनै भेक्टर तह उपलब्ध छैन
                    </p>
                  ) : (
                    filteredVectors.map((layer) => {
                      const vectorKey = `vector_${layer.id}`;
                      const isVisible = activeLayerIds.has(vectorKey);
                      const isSelectedAnalytics = selectedAnalyticsLayerId === layer.id;
                      const opacity = layerOpacities[vectorKey] !== undefined
                        ? Math.round(layerOpacities[vectorKey] * 100)
                        : Math.round((layer.opacity ?? 1.0) * 100);
                      const access = layer.access_level || 'public';
                      const isPolygon = (layer.geometry_type || '').toUpperCase().includes('POLYGON') || (layer.geometry_type || '').toUpperCase() === 'GEOMETRY';
                      const isOutlined = layerOutlines[layer.id] !== undefined ? layerOutlines[layer.id] : true;

                      return (
                        <div
                          key={`vector-${layer.id}`}
                          className={`p-2 rounded-md border transition-all ${
                            !isVisible
                              ? 'bg-slate-100/70 border-slate-200 opacity-60 hover:opacity-100'
                              : isSelectedAnalytics
                              ? 'bg-gov-blue-50/80 border-gov-blue-800 ring-1 ring-gov-blue-800 shadow-sm'
                              : 'bg-white border-gov-blue-200 shadow-xs'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <button
                              type="button"
                              onClick={() => onToggleLayer(layer)}
                              className="flex items-center gap-2 flex-1 text-left min-w-0"
                            >
                              {isVisible ? (
                                <Eye className="w-4 h-4 text-gov-blue-800 shrink-0" />
                              ) : (
                                <EyeOff className="w-4 h-4 text-slate-400 shrink-0" />
                              )}
                              <div className="truncate">
                                <div className="flex items-center gap-1.5 truncate">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0 border border-slate-300"
                                    style={{
                                      backgroundColor: layer.style?.fillColor || '#0447AF',
                                    }}
                                  />
                                  <span className="text-xs font-bold text-slate-800 truncate font-nepali">
                                    {layer.name}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                                  <span className="px-1 py-0 rounded text-[9px] bg-slate-200 text-slate-700 font-mono">
                                    {layer.geometry_type || 'Geom'}
                                  </span>
                                  {layer.feature_count !== undefined && (
                                    <span>&middot; {layer.feature_count.toLocaleString()} विशेषता</span>
                                  )}
                                  {access === 'validator' && (
                                    <span className="px-1 py-0 rounded text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                      🛡️ Validator
                                    </span>
                                  )}
                                  {access === 'admin_only' && (
                                    <span className="px-1 py-0 rounded text-[9px] font-bold bg-red-50 text-red-700 border border-red-200">
                                      🔒 Admin
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>

                            <div className="flex items-center gap-0.5 shrink-0">
                              {/* Zoom to Layer Extent Button */}
                              {layer.bounds && onZoomToLayer && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onZoomToLayer(layer);
                                  }}
                                  className="p-1 text-slate-400 hover:text-gov-blue-800 hover:bg-gov-blue-50 rounded transition-colors"
                                  title="तहमा जुम गर्नुहोस् (Zoom to Layer Extent)"
                                >
                                  <Maximize2 className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Infographics Button */}
                              <button
                                type="button"
                                onClick={() => onSelectLayerForAnalytics?.(layer.id)}
                                className={`p-1 rounded transition-colors ${
                                  isVisible && isSelectedAnalytics
                                    ? 'bg-gov-blue-800 text-white shadow-2xs'
                                    : 'text-slate-400 hover:text-gov-blue-800 hover:bg-gov-blue-50'
                                }`}
                                title="इन्फोग्राफिक्स विश्लेषण (Infographics)"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                              </button>

                              {/* Outline Only Toggle for Polygon Layers (Default ON) */}
                              {isPolygon && onToggleOutline && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleOutline(layer.id);
                                  }}
                                  className={`p-1 rounded transition-colors ${
                                    isOutlined
                                      ? 'bg-amber-600 text-white font-bold shadow-2xs ring-1 ring-amber-400'
                                      : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                                  }`}
                                  title={
                                    isOutlined
                                      ? 'आउटलाइन मोड सक्रिय (सिमाना मात्र) — रंग भर्न क्लिक गर्नुहोस् / Outline Mode Active (Border only)'
                                      : 'आउटलाइन मात्र मोड खोल्नुहोस् (सिमाना मात्र) / Switch to Outline Mode'
                                  }
                                >
                                  <Square className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* GIS Admin Access Setting Button */}
                              {isGisAdmin && onConfigureLayer && (
                                <button
                                  type="button"
                                  onClick={() => onConfigureLayer(layer)}
                                  className="p-1 text-slate-400 hover:text-gov-blue-800 hover:bg-gov-blue-50 rounded transition-colors"
                                  title="तह पहुँच तथा विशेषता व्यवस्थापन (Configure Access & Attributes)"
                                >
                                  <Sliders className="w-3.5 h-3.5 text-gov-blue-800" />
                                </button>
                              )}

                              {/* Metadata Button */}
                              {onOpenMetadata && (
                                <button
                                  type="button"
                                  onClick={() => onOpenMetadata(layer)}
                                  className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                                  title="विवरण (Metadata)"
                                >
                                  <Info className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Opacity Slider & Outline Control */}
                          {isVisible && (
                            <div className="mt-1.5 pt-1.5 border-t border-slate-100 space-y-1.5">
                              <div className="flex items-center justify-between text-[10px] text-slate-600 mb-0.5">
                                <span>पारदर्शिता (Opacity)</span>
                                <span className="font-mono font-bold text-gov-blue-800">{opacity}%</span>
                              </div>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={opacity}
                                onChange={(e) => onOpacityChange(vectorKey, parseInt(e.target.value, 10) / 100)}
                                className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-gov-blue-800"
                              />

                              {isPolygon && onToggleOutline && (
                                <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[10px]">
                                  <span className="text-slate-600 flex items-center gap-1 font-nepali">
                                    <Square className="w-3 h-3 text-amber-600" />
                                    <span>सिमाना मात्र (Outline)</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => onToggleOutline(layer.id)}
                                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${
                                      isOutlined
                                        ? 'bg-amber-600 text-white shadow-2xs ring-1 ring-amber-400'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                  >
                                    {isOutlined ? 'आउटलाइन ON' : 'भरिएको (Fill) ON'}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Clean Footer */}
          <div className="p-2.5 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-600 flex items-center justify-between font-nepali shrink-0">
            <span>काठमाडौँ महानगरपालिका</span>
            <span className="text-gov-blue-800 font-semibold">खुला भू-स्थानिक तथ्याङ्क</span>
          </div>
        </div>
      )}
    </div>
  );
}
