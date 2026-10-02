'use client';

import { useState, useMemo } from 'react';
import {
  Layers, Search, ChevronDown, ChevronRight, Eye, EyeOff,
  Sliders, Download, Info, Check, Filter, RefreshCw, Sparkles,
  MapPin, Shield
} from 'lucide-react';

export default function LayerCatalogPanel({
  catalog,
  activeLayerIds,
  onToggleLayer,
  onOpacityChange,
  layerOpacities = {},
  onSelectLayerForAnalytics,
  selectedAnalyticsLayerId,
  onOpenConfig,
  onOpenMetadata,
  onExportLayer,
  isAdmin = false,
  isCollapsed,
  onToggleCollapse,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedCategories, setExpandedCategories] = useState({});

  // Initialize all categories as expanded
  const toggleCategory = (catName) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [catName]: prev[catName] === false ? true : false,
    }));
  };

  const categories = catalog?.categories || [];

  // Filter layers by search term
  const filteredCategories = useMemo(() => {
    if (!searchTerm.trim()) return categories;
    const term = searchTerm.toLowerCase();

    return categories
      .map((cat) => {
        const matchingLayers = cat.layers.filter(
          (l) =>
            l.name.toLowerCase().includes(term) ||
            (l.description && l.description.toLowerCase().includes(term)) ||
            (l.category && l.category.toLowerCase().includes(term))
        );
        return {
          ...cat,
          layers: matchingLayers,
        };
      })
      .filter((cat) => cat.layers.length > 0);
  }, [categories, searchTerm]);

  return (
    <div
      className={`bg-white/95 backdrop-blur-md border border-slate-200 shadow-xl rounded-xl transition-all duration-300 flex flex-col z-30 max-h-[calc(100vh-130px)] ${
        isCollapsed ? 'w-12 overflow-hidden' : 'w-80 sm:w-96'
      }`}
    >
      {/* Panel Header */}
      <div className="p-3 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 rounded-t-xl select-none">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gov-blue-600 flex items-center justify-center text-white shrink-0 shadow-sm">
            <Layers className="w-4 h-4" />
          </div>
          {!isCollapsed && (
            <div className="truncate">
              <h2 className="text-xs font-bold font-nepali text-white flex items-center gap-1.5 truncate">
                तह क्याटलग (Layer Catalog)
              </h2>
              <span className="text-[10px] text-gov-gold-400 font-semibold font-mono">
                {catalog?.total_vector_layers || 0} भेक्टर • {catalog?.total_raster_packages || 0} रास्टर
              </span>
            </div>
          )}
        </div>

        <button
          onClick={onToggleCollapse}
          className="p-1 rounded-md hover:bg-slate-800 text-slate-300 transition-colors"
          title={isCollapsed ? 'क्याटलग खोल्नुहोस्' : 'क्याटलग समेट्नुहोस्'}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* Search Box */}
          <div className="p-2.5 border-b border-slate-200 bg-slate-50/80">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="तह वा विवरण खोज्नुहोस् (Search layers)..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs focus:ring-2 focus:ring-gov-blue-800 transition-all placeholder:text-slate-400"
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

          {/* Categories & Layers List */}
          <div className="overflow-y-auto flex-1 p-2 space-y-2 scrollbar-thin">
            {filteredCategories.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs font-nepali">
                कुनै तह फेला परेन। (No matching layers found)
              </div>
            ) : (
              filteredCategories.map((category) => {
                const isCatExpanded = expandedCategories[category.name] !== false;
                const activeCountInCat = category.layers.filter((l) => activeLayerIds.has(l.id)).length;
                // The default "General" bucket shows no header — its layers render flat,
                // so there is never a "General (N)" label on screen.
                const isGeneralBucket = category.name === 'General';

                return (
                  <div key={category.name} className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-xs">
                    {/* Category Title Header (hidden for the General bucket) */}
                    {!isGeneralBucket && (
                    <button
                      onClick={() => toggleCategory(category.name)}
                      className="w-full px-3 py-2 bg-slate-100/90 hover:bg-slate-200/80 flex items-center justify-between text-left transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isCatExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        )}
                        <span className="text-xs font-bold text-slate-800 font-nepali truncate">
                          {category.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {activeCountInCat > 0 && (
                          <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-gov-blue-100 text-gov-blue-800">
                            {activeCountInCat} सक्रिय
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400 font-mono">
                          ({category.layers.length})
                        </span>
                      </div>
                    </button>
                    )}

                    {/* Layers in Category (General bucket always expanded) */}
                    {(isGeneralBucket || isCatExpanded) && (
                      <div className="divide-y divide-slate-100">
                        {category.layers.map((layer) => {
                          const isActive = activeLayerIds.has(layer.id);
                          const isSelectedAnalytics = selectedAnalyticsLayerId === layer.id;
                          const currentOpacity = layerOpacities[layer.id] !== undefined ? layerOpacities[layer.id] : (layer.opacity ?? 1.0);

                          return (
                            <div
                              key={`${layer.type}-${layer.id}`}
                              className={`p-2.5 transition-colors ${
                                isSelectedAnalytics
                                  ? 'bg-gov-blue-50/70 border-l-2 border-gov-blue-800'
                                  : isActive
                                  ? 'bg-slate-50/80'
                                  : 'hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                {/* Layer Toggle Checkbox & Label */}
                                <label className="flex items-start gap-2.5 cursor-pointer flex-1 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={isActive}
                                    onChange={() => onToggleLayer(layer)}
                                    className="mt-0.5 w-4 h-4 rounded text-gov-blue-800 focus:ring-gov-blue-800 shrink-0 cursor-pointer accent-gov-blue-800"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      {/* Legend swatch */}
                                      <span
                                        className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs"
                                        style={{
                                          backgroundColor: layer.style?.fillColor || (layer.type === 'raster' ? '#10b981' : '#0447AF'),
                                          borderColor: layer.style?.strokeColor || '#000000',
                                          borderWidth: 1,
                                        }}
                                      />
                                      <span className="text-xs font-semibold text-slate-800 truncate leading-snug">
                                        {layer.name}
                                      </span>
                                    </div>

                                    {/* Type badge and feature count */}
                                    <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                                      <span className="uppercase font-mono text-[9px] px-1 py-0.2 rounded bg-slate-200/80 text-slate-600">
                                        {layer.geometry_type || layer.type}
                                      </span>
                                      {layer.feature_count !== undefined && (
                                        <span className="font-mono text-[10px]">
                                          {layer.feature_count.toLocaleString()} विशेषता
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </label>

                                {/* Action Buttons */}
                                <div className="flex items-center gap-1 shrink-0">
                                  {/* Select for Analytics */}
                                  {layer.type === 'vector' && (
                                    <button
                                      onClick={() => onSelectLayerForAnalytics(layer.id)}
                                      className={`p-1 rounded text-[10px] transition-colors ${
                                        isSelectedAnalytics
                                          ? 'bg-gov-blue-800 text-white font-bold'
                                          : 'text-slate-400 hover:text-gov-blue-800 hover:bg-slate-100'
                                      }`}
                                      title="विश्लेषण तथा इन्फोग्राफिक्स हेर्नुहोस् (View Analytics)"
                                    >
                                      📊
                                    </button>
                                  )}

                                  {/* Metadata info */}
                                  <button
                                    onClick={() => onOpenMetadata?.(layer)}
                                    className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                    title="तह विवरण (Metadata Info)"
                                  >
                                    <Info className="w-3.5 h-3.5" />
                                  </button>

                                  {/* Download / Export */}
                                  {layer.can_download && layer.type === 'vector' && (
                                    <button
                                      onClick={() => onExportLayer?.(layer)}
                                      className="p-1 rounded text-slate-400 hover:text-emerald-700 hover:bg-slate-100 transition-colors"
                                      title="तह निर्यात गर्नुहोस् (Export GeoJSON/CSV)"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                    </button>
                                  )}

                                  {/* Admin Configuration */}
                                  {isAdmin && (
                                    <button
                                      onClick={() => onOpenConfig?.(layer)}
                                      className="p-1 rounded text-slate-400 hover:text-gov-gold-600 hover:bg-slate-100 transition-colors"
                                      title="तह विन्यास तथा सुरक्षा सेटिङ (Admin Configure)"
                                    >
                                      <Sliders className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Opacity Slider (visible when layer is active) */}
                              {isActive && (
                                <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center gap-2">
                                  <span className="text-[10px] text-slate-400 font-mono w-14">
                                    पारदर्शिता: {Math.round(currentOpacity * 100)}%
                                  </span>
                                  <input
                                    type="range"
                                    min="0.1"
                                    max="1.0"
                                    step="0.05"
                                    value={currentOpacity}
                                    onChange={(e) => onOpacityChange(layer.id, parseFloat(e.target.value))}
                                    className="w-full accent-gov-blue-800 h-1 cursor-pointer"
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Catalog Footer Info */}
          <div className="p-2 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500 flex items-center justify-between font-nepali">
            <span>काठमाडौँ महानगर एकीकृत भू-पोर्टल</span>
            <span className="text-gov-blue-800 font-bold">ST_AsMVT Vector Tiles</span>
          </div>
        </>
      )}
    </div>
  );
}
