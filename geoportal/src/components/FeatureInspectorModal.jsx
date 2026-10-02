'use client';

import { useMemo } from 'react';
import { X, MapPin, Layers, Shield } from 'lucide-react';

export default function FeatureInspectorModal({ inspectedFeature, catalog, onClose }) {
  if (!inspectedFeature) return null;

  const layerId = inspectedFeature.layerId;
  const layerName = inspectedFeature.layerName;

  // Find layer in catalog to get field configs & role permissions
  const layer = useMemo(() => {
    if (!catalog?.categories) return null;
    for (const cat of catalog.categories) {
      for (const lyr of cat.layers || []) {
        if (layerId && lyr.id === layerId) return lyr;
        if (layerName && lyr.name === layerName) return lyr;
      }
    }
    return null;
  }, [catalog, layerId, layerName]);

  const props = inspectedFeature.properties || {};

  // Build filtered entries based on layer fields_config
  const entries = useMemo(() => {
    const rawEntries = Object.entries(props).filter(
      ([k]) => !k.startsWith('_') && k !== 'geometry' && k !== 'geom' && k !== 'layer'
    );

    if (!layer?.fields_config || layer.fields_config.length === 0) {
      return rawEntries.map(([k, v]) => ({ key: k, label: k.replace(/_/g, ' '), value: v }));
    }

    // Map allowed fields from fields_config (which is already role-filtered by backend)
    const allowedMap = new Map();
    layer.fields_config.forEach((f) => {
      if (f.name) {
        allowedMap.set(f.name.toLowerCase(), f.label || f.name.replace(/_/g, ' '));
      }
    });

    // If user is admin (catalog.is_admin is true), show all fields
    if (catalog?.is_admin) {
      return rawEntries.map(([k, v]) => ({
        key: k,
        label: allowedMap.get(k.toLowerCase()) || k.replace(/_/g, ' '),
        value: v,
      }));
    }

    // For public viewer / validator: strictly only show permitted fields
    const filtered = [];
    rawEntries.forEach(([k, v]) => {
      const lowerK = k.toLowerCase();
      if (allowedMap.has(lowerK)) {
        filtered.push({
          key: k,
          label: allowedMap.get(lowerK),
          value: v,
        });
      }
    });

    // If filtered is empty but raw entries existed and fields_config didn't match case, fall back safely
    if (filtered.length === 0 && rawEntries.length > 0 && allowedMap.size === 0) {
      return rawEntries.map(([k, v]) => ({ key: k, label: k.replace(/_/g, ' '), value: v }));
    }

    return filtered;
  }, [props, layer, catalog]);

  return (
    <div className="absolute bottom-24 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-slate-200 w-[calc(100%-2rem)] sm:w-11/12 max-w-md max-h-[52dvh] sm:max-h-[70dvh] overflow-hidden flex flex-col animate-scale-up">
      {/* Header */}
      <div className="px-3.5 py-2.5 bg-gov-blue-900 text-white flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded bg-gov-blue-950 flex items-center justify-center shrink-0 border border-gov-gold-400/30">
            <MapPin className="w-3.5 h-3.5 text-gov-gold-400" />
          </div>
          <div className="truncate">
            <h3 className="text-xs font-bold font-nepali truncate">
              {layerName || layer?.name || 'फिचर विवरण (Feature Properties)'}
            </h3>
            {layer?.category && (
              <span className="text-[10px] text-gov-gold-300 block truncate">
                {layer.category}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gov-blue-800 text-white/80 hover:text-white transition-colors"
          title="बन्द गर्नुहोस्"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Attributes Table */}
      <div className="p-3 max-h-60 overflow-y-auto divide-y divide-slate-100 text-xs scrollbar-thin">
        {entries.length === 0 ? (
          <div className="text-center py-4 text-slate-400 font-nepali text-xs">
            यो प्रयोगकर्ता भूमिकाका लागि कुनै विशेषता उपलब्ध छैन वा अनुमति छैन।
          </div>
        ) : (
          entries.map(({ key, label, value }) => (
            <div key={key} className="py-1.5 flex items-start justify-between gap-2 hover:bg-slate-50/80 px-1 rounded transition-colors">
              <span className="text-slate-600 font-medium font-nepali truncate w-5/12 capitalize" title={label}>
                {label}:
              </span>
              <span className="text-slate-900 font-bold text-right truncate w-7/12 font-mono">
                {value !== null && value !== undefined && value !== '' ? String(value) : '—'}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Footer info badge */}
      <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500 font-nepali">
        <span>काठमाडौँ महानगरपालिका खुला तथ्याङ्क</span>
        <span className="text-gov-blue-800 font-semibold">{entries.length} विशेषताहरू</span>
      </div>
    </div>
  );
}
