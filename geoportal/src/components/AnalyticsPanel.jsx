'use client';

import { useState, useEffect } from 'react';
import {
  BarChart3, RefreshCw, X,
  Maximize2, Ruler, CheckCircle2, AlertTriangle, Layers,
  Activity, Hash, Sparkles
} from 'lucide-react';
import { analyticsAPI } from '../lib/api';

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

  // Collapsed Mode: Clean Government Floating Button (No awkward cramped arrows or ugly emojis)
  if (isCollapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        className="flex items-center gap-2.5 px-3.5 py-2.5 bg-gov-blue-800 hover:bg-gov-blue-900 active:scale-98 text-white rounded-xl shadow-xl border border-gov-blue-900 transition-all font-nepali text-xs font-bold"
        title="इन्फोग्राफिक्स तथा तथ्याङ्कीय विश्लेषण खोल्नुहोस् (Open Infographics)"
      >
        <div className="w-6 h-6 rounded-md bg-gov-blue-950 flex items-center justify-center shrink-0 border border-gov-gold-400/40">
          <BarChart3 className="w-3.5 h-3.5 text-gov-gold-400" />
        </div>
        <span>इन्फोग्राफिक्स</span>
        {layerName && (
          <span className="hidden sm:inline-block max-w-[130px] truncate text-[10px] text-gov-gold-300 font-normal">
            ({layerName})
          </span>
        )}
      </button>
    );
  }

  // Expanded Mode: Full Infographics Panel
  return (
    <div className="bg-white/95 backdrop-blur-md border border-slate-200 shadow-xl rounded-xl transition-all duration-300 flex flex-col z-30 max-h-[calc(100vh-140px)] w-84 sm:w-96">
      {/* Header */}
      <div className="p-3 bg-gov-blue-800 text-white flex items-center justify-between border-b border-gov-blue-900 rounded-t-xl select-none shadow-sm">
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
          <div className="w-6 h-6 rounded-md bg-gov-blue-950 flex items-center justify-center shrink-0 border border-gov-gold-400/40">
            <BarChart3 className="w-3.5 h-3.5 text-gov-gold-400" />
          </div>
          <div className="truncate">
            <h2 className="text-xs font-bold font-nepali text-white truncate">
              {data?.layer_name || layerName || 'विश्लेषणात्मक इन्फोग्राफिक्स'}
            </h2>
            <span className="text-[10px] text-gov-gold-300 font-medium">
              {data?.geometry_type || 'Vector Infographics'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={fetchAnalytics}
            disabled={loading}
            className="p-1 rounded-md hover:bg-gov-blue-900 text-gov-blue-100 hover:text-white transition-colors"
            title="पुनः लोड (Refresh)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded-md hover:bg-gov-blue-900 text-white transition-colors"
            title="इन्फोग्राफिक्स बन्द गर्नुहोस् (Close)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          {/* Extent vs Entire Layer Toggle */}
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

          {/* Content */}
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
                            सबै (Reset)
                          </button>
                        )}
                      </div>

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

                      <div className="space-y-1.5 max-h-40 overflow-y-auto scrollbar-thin">
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
                              <div className="flex items-center gap-1.5 font-mono text-slate-500 shrink-0">
                                <span className="font-semibold text-slate-800">{item.value.toLocaleString()}</span>
                                <span className="text-[10px]">({pct}%)</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* 3. Numeric Attribute Summaries */}
                {(data.charts?.numeric_summaries || []).map((num) => (
                  <div key={num.field} className="p-3 rounded-lg border border-slate-200 bg-white shadow-xs">
                    <h4 className="font-bold text-slate-800 text-xs font-nepali mb-2 truncate">
                      {num.title} (सांख्यिकीय सारांश)
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-center font-mono">
                      <div className="p-1.5 bg-slate-50 rounded border border-slate-100">
                        <span className="text-[9px] text-slate-400 block font-sans">औसत (Average)</span>
                        <span className="font-bold text-slate-800">{num.avg.toLocaleString()}</span>
                      </div>
                      <div className="p-1.5 bg-slate-50 rounded border border-slate-100">
                        <span className="text-[9px] text-slate-400 block font-sans">जम्मा (Total Sum)</span>
                        <span className="font-bold text-slate-800">{num.sum.toLocaleString()}</span>
                      </div>
                      <div className="p-1.5 bg-slate-50 rounded border border-slate-100">
                        <span className="text-[9px] text-slate-400 block font-sans">न्यूनतम (Min)</span>
                        <span className="font-bold text-slate-800">{num.min.toLocaleString()}</span>
                      </div>
                      <div className="p-1.5 bg-slate-50 rounded border border-slate-100">
                        <span className="text-[9px] text-slate-400 block font-sans">अधिकतम (Max)</span>
                        <span className="font-bold text-slate-800">{num.max.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
