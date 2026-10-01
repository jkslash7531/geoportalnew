'use client';

import { useState, useEffect } from 'react';
import {
  BarChart3, PieChart, RefreshCw, ChevronLeft, ChevronRight,
  Maximize2, Ruler, CheckCircle2, AlertTriangle, Layers,
  Activity, Hash, Eye, Sparkles, Filter
} from 'lucide-react';
import { analyticsAPI } from '../../lib/api';

const COLOR_PALETTE = [
  '#0447AF', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16',
];

export default function AnalyticsPanel({
  layerId,
  layerName,
  mapExtent = null,
  isCollapsed,
  onToggleCollapse,
  onCategoryFilterClick,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filterMode, setFilterMode] = useState('full'); // 'full' | 'extent'
  const [activeCategoryFilter, setActiveCategoryFilter] = useState(null);

  const fetchAnalytics = async () => {
    if (!layerId) return;
    setLoading(true);
    setError(null);
    try {
      const bboxParam = filterMode === 'extent' && mapExtent ? mapExtent.join(',') : null;
      const res = await analyticsAPI.getLayerAnalytics(layerId, bboxParam);
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || 'विश्लेषण लोड गर्न सकिएन');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (layerId) {
      fetchAnalytics();
    }
  }, [layerId, filterMode]);

  // When mapExtent changes and extent mode is on, debounce reload
  useEffect(() => {
    if (filterMode === 'extent' && mapExtent) {
      const timer = setTimeout(() => {
        fetchAnalytics();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [mapExtent]);

  const handleCategoryClick = (field, catName) => {
    if (activeCategoryFilter === catName) {
      setActiveCategoryFilter(null);
      onCategoryFilterClick?.(null);
    } else {
      setActiveCategoryFilter(catName);
      onCategoryFilterClick?.({ field, value: catName });
    }
  };

  return (
    <div
      className={`bg-white/95 backdrop-blur-md border border-slate-200 shadow-xl rounded-xl transition-all duration-300 flex flex-col z-30 max-h-[calc(100vh-130px)] ${
        isCollapsed ? 'w-12 overflow-hidden' : 'w-84 sm:w-96'
      }`}
    >
      {/* Header */}
      <div className="p-3 bg-gradient-to-r from-gov-blue-900 to-slate-900 text-white flex items-center justify-between border-b border-slate-800 rounded-t-xl select-none">
        <button
          onClick={onToggleCollapse}
          className="p-1 rounded-md hover:bg-slate-800 text-slate-300 transition-colors"
          title={isCollapsed ? 'ड्यासबोर्ड खोल्नुहोस्' : 'ड्यासबोर्ड समेट्नुहोस्'}
        >
          {isCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {!isCollapsed && (
          <div className="flex items-center gap-2 min-w-0 flex-1 ml-1">
            <BarChart3 className="w-4 h-4 text-gov-gold-400 shrink-0" />
            <div className="truncate">
              <h2 className="text-xs font-bold font-nepali text-white truncate">
                {layerName || 'विश्लेषणात्मक इन्फोग्राफिक्स'}
              </h2>
              <span className="text-[10px] text-slate-300">
                {data?.geometry_type || 'Vector Analytics'}
              </span>
            </div>
          </div>
        )}

        {!isCollapsed && (
          <button
            onClick={fetchAnalytics}
            disabled={loading}
            className="p-1 rounded-md hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
            title="तथ्याङ्क पुनः लोड गर्नुहोस् (Refresh)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {!isCollapsed && (
        <>
          {/* Extent vs Full Dataset Toggle */}
          <div className="p-2 border-b border-slate-200 bg-slate-50 flex items-center gap-1.5 text-xs font-semibold">
            <button
              onClick={() => setFilterMode('full')}
              className={`flex-1 py-1 px-2 rounded-md font-nepali transition-all text-center ${
                filterMode === 'full'
                  ? 'bg-gov-blue-800 text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              समग्र तह (Entire Layer)
            </button>
            <button
              onClick={() => setFilterMode('extent')}
              className={`flex-1 py-1 px-2 rounded-md font-nepali transition-all text-center ${
                filterMode === 'extent'
                  ? 'bg-gov-blue-800 text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              हालको नक्सा दृश्य (Map Extent)
            </button>
          </div>

          {/* Body Content */}
          <div className="p-3 overflow-y-auto flex-1 space-y-3.5 text-xs scrollbar-thin">
            {!layerId ? (
              <div className="p-8 text-center text-slate-400 font-nepali">
                बायाँ क्याटलगबाट कुनै भेक्टर तह छान्नुहोस्
              </div>
            ) : loading && !data ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2">
                <div className="w-8 h-8 border-3 border-gov-blue-800 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-semibold text-slate-500 font-nepali">
                  तथ्याङ्क गणना गरिँदैछ...
                </span>
              </div>
            ) : error ? (
              <div className="p-3 bg-red-50 text-red-700 rounded-lg border border-red-200 text-xs">
                {error}
              </div>
            ) : data ? (
              <>
                {/* 1. Dynamic KPI Cards Grid */}
                <div className="grid grid-cols-2 gap-2">
                  {(data.kpi_cards || []).map((kpi) => (
                    <div
                      key={kpi.id}
                      className="p-2.5 rounded-lg border border-slate-200 bg-gradient-to-br from-white to-slate-50 shadow-xs"
                    >
                      <div className="text-[10px] text-slate-500 font-medium font-nepali truncate">
                        {kpi.title}
                      </div>
                      <div className="mt-1 flex items-baseline gap-1">
                        <span className="text-base sm:text-lg font-bold text-slate-900 font-mono">
                          {typeof kpi.value === 'number' ? kpi.value.toLocaleString() : kpi.value}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-500">{kpi.unit}</span>
                      </div>
                      {kpi.secondary && (
                        <div className="text-[9px] text-slate-400 font-mono mt-0.5">{kpi.secondary}</div>
                      )}
                    </div>
                  ))}
                </div>

                {/* 2. Categorical Donut/Bar Infographics */}
                {(data.charts?.categories || []).map((chart, cIdx) => {
                  const total = chart.data.reduce((acc, curr) => acc + curr.value, 0);

                  return (
                    <div key={chart.field || cIdx} className="p-3 rounded-lg border border-slate-200 bg-white shadow-xs">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-bold text-slate-800 text-xs font-nepali truncate">
                          {chart.title}
                        </h4>
                        {activeCategoryFilter && (
                          <button
                            onClick={() => handleCategoryClick(chart.field, activeCategoryFilter)}
                            className="text-[10px] text-gov-blue-800 font-semibold hover:underline"
                          >
                            सबै देखाउनुहोस् (Reset)
                          </button>
                        )}
                      </div>

                      {/* Visual Category Distribution Bar */}
                      <div className="w-full h-3 bg-slate-100 rounded-full flex overflow-hidden shadow-inner mb-2.5">
                        {chart.data.map((item, i) => {
                          const pct = total > 0 ? (item.value / total) * 100 : 0;
                          const color = COLOR_PALETTE[i % COLOR_PALETTE.length];
                          return (
                            <div
                              key={item.name}
                              style={{ width: `${pct}%`, backgroundColor: color }}
                              className="h-full transition-all hover:opacity-80 cursor-pointer"
                              title={`${item.name}: ${item.value} (${pct.toFixed(1)}%)`}
                              onClick={() => handleCategoryClick(chart.field, item.name)}
                            />
                          );
                        })}
                      </div>

                      {/* Legend Items */}
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {chart.data.map((item, i) => {
                          const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : 0;
                          const color = COLOR_PALETTE[i % COLOR_PALETTE.length];
                          const isSelected = activeCategoryFilter === item.name;

                          return (
                            <button
                              key={item.name}
                              onClick={() => handleCategoryClick(chart.field, item.name)}
                              className={`w-full flex items-center justify-between p-1.5 rounded transition-all text-left text-xs ${
                                isSelected
                                  ? 'bg-gov-blue-100 border border-gov-blue-300 font-bold'
                                  : 'hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: color }}
                                />
                                <span className="text-slate-700 truncate">{item.name}</span>
                              </div>
                              <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
                                <span className="font-semibold text-slate-800">
                                  {item.value.toLocaleString()}
                                </span>
                                <span className="text-slate-400 text-[10px]">({pct}%)</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* 3. Numeric Attribute Stats */}
                {(data.charts?.numeric_summaries || []).map((numStat, nIdx) => (
                  <div key={numStat.field || nIdx} className="p-3 rounded-lg border border-slate-200 bg-white shadow-xs">
                    <h4 className="font-bold text-slate-800 text-xs font-nepali mb-2">
                      {numStat.title} (Numeric Summary)
                    </h4>
                    <div className="grid grid-cols-4 gap-1.5 text-center font-mono">
                      <div className="bg-slate-50 p-1.5 rounded border border-slate-100">
                        <div className="text-[9px] text-slate-400 uppercase">Avg</div>
                        <div className="font-bold text-slate-800 text-[11px]">{numStat.avg}</div>
                      </div>
                      <div className="bg-slate-50 p-1.5 rounded border border-slate-100">
                        <div className="text-[9px] text-slate-400 uppercase">Min</div>
                        <div className="font-bold text-slate-800 text-[11px]">{numStat.min}</div>
                      </div>
                      <div className="bg-slate-50 p-1.5 rounded border border-slate-100">
                        <div className="text-[9px] text-slate-400 uppercase">Max</div>
                        <div className="font-bold text-slate-800 text-[11px]">{numStat.max}</div>
                      </div>
                      <div className="bg-slate-50 p-1.5 rounded border border-slate-100">
                        <div className="text-[9px] text-slate-400 uppercase">Sum</div>
                        <div className="font-bold text-slate-800 text-[11px]">
                          {numStat.sum > 1000 ? Math.round(numStat.sum).toLocaleString() : numStat.sum}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* 4. Data Quality Audit Card */}
                {data.data_quality && (
                  <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/80 text-[11px] text-slate-600 space-y-1">
                    <div className="font-bold text-slate-800 font-nepali flex items-center justify-between">
                      <span>तथ्याङ्क गुणस्तर (Data Quality Audit)</span>
                      <span className="text-emerald-700 font-mono font-bold">
                        {data.data_quality.completeness_pct}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                      <span>मान्य ज्यामिति (Valid Geom):</span>
                      <span>{data.data_quality.valid_geometry_pct}%</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                      <span>विशेषता विवरण भरिएको (Populated):</span>
                      <span>
                        {data.data_quality.populated_props_count} / {data.data_quality.total_count}
                      </span>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
