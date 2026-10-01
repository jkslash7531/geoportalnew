'use client';

import React from 'react';
import {
  X, Edit3, Layers, Key, CheckCircle2,
  MapPin, Shield, Tag, ArrowRight,
} from 'lucide-react';

/**
 * ReadOnlyAttributePopup Component
 * Official Nepal Government WebGIS Standard — Kathmandu Metropolitan City
 * 
 * Requirements:
 * - Read-only attribute popup displayed when selecting / tapping an existing map feature.
 * - Admin controls which fields and corresponding values are displayed (visible_in_popup !== false).
 * - Field order follows the Admin-configured sequence.
 * - Ultra-compact, scrollable mobile-first banner/card that does NOT obscure the map screen.
 * - Top-level Edit button immediately takes the user to active Edit Mode in a single click (no double click!).
 */
export default function ReadOnlyAttributePopup({
  feature,
  vectorLayers = [],
  onClose,
  onOpenExistingDialog,
}) {
  if (!feature) return null;

  // Locate layer metadata
  const targetLayer = (vectorLayers || []).find(
    (l) => String(l.id) === String(feature.layerId)
  );

  const layerName = feature.layerName || targetLayer?.name || 'तह (Vector Layer)';
  const geomType = feature.geometryType || feature.geometry?.type || targetLayer?.geometry_type || 'Feature';
  const properties = feature.properties || {};

  // Check admin configured schema: geometry-specific or default
  const geomConfig = targetLayer?.geometry_fields_config?.[geomType];
  const fieldsConfig = Array.isArray(geomConfig) && geomConfig.length > 0
    ? geomConfig
    : (Array.isArray(targetLayer?.fields_config) ? targetLayer.fields_config : []);

  // Filter fields based on Admin visibility control and order
  let displayFields = [];
  if (fieldsConfig.length > 0) {
    displayFields = fieldsConfig
      .filter((f) => f.visible_in_popup !== false)
      .map((f) => ({
        key: f.name,
        label: f.label || f.name,
        type: f.type || 'text',
        required: Boolean(f.required),
        is_unique: Boolean(f.is_unique),
        id_mode: f.id_mode,
        value: properties[f.name],
      }));
  } else {
    // Fallback: display non-internal properties
    const ignoredKeys = new Set([
      'geom', 'the_geom', 'geometry_type', '_version', '_layer_id',
      'target_id', '_target_feature_id',
    ]);
    displayFields = Object.entries(properties)
      .filter(([k]) => !ignoredKeys.has(k) && !k.startsWith('__'))
      .map(([k, v]) => ({
        key: k,
        label: k.replace(/_/g, ' '),
        type: typeof v === 'number' ? 'number' : 'text',
        required: false,
        is_unique: k === 'id' || k === '_id',
        value: v,
      }));
  }

  // Find unique identifier field if any
  const uniqueFieldItem = displayFields.find((f) => f.is_unique) ||
    fieldsConfig.find((f) => f.is_unique);
  const uniqueVal = uniqueFieldItem
    ? (properties[uniqueFieldItem.name || uniqueFieldItem.key] ?? feature.id)
    : (feature.id ?? properties._id ?? properties.id);

  // Format value for display
  const formatValue = (val, type) => {
    if (val === null || val === undefined || val === '') {
      return <span className="text-slate-400 italic font-mono">-</span>;
    }
    if (typeof val === 'boolean') {
      return val ? 'हो (Yes)' : 'होइन (No)';
    }
    if (type === 'date') {
      try {
        const d = new Date(val);
        if (!isNaN(d.getTime())) return d.toLocaleDateString();
      } catch (e) {
        // ignore
      }
    }
    const str = String(val);
    if (str.startsWith('http://') || str.startsWith('https://')) {
      return (
        <a
          href={str}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gov-blue-800 underline truncate max-w-full block hover:text-gov-blue-900"
        >
          {str}
        </a>
      );
    }
    return str;
  };

  return (
    <div
      className="fixed bottom-3 right-3 sm:bottom-4 sm:right-4 z-40
                 w-64 max-w-[260px] bg-white/95 backdrop-blur-md
                 rounded-xl shadow-2xl border border-slate-300 overflow-hidden font-sans
                 animate-slide-up flex flex-col max-h-[30dvh] sm:max-h-[240px]"
      id="read-only-attribute-popup"
    >
      {/* 1. Ultra-compact Header */}
      <div className="bg-gov-blue-900 text-white px-2.5 py-1.5 flex items-center justify-between shrink-0 shadow-xs">
        <div className="flex items-center gap-1.5 min-w-0">
          <Layers className="w-3.5 h-3.5 text-gov-gold-400 shrink-0" />
          <div className="min-w-0 flex items-center gap-1.5">
            <h3 className="text-[11px] font-bold font-nepali truncate leading-none">
              {layerName}
            </h3>
            {uniqueVal !== null && uniqueVal !== undefined && (
              <span className="text-[10px] font-bold text-gov-gold-300 font-mono bg-gov-blue-800 px-1 py-0.2 rounded border border-gov-blue-700 truncate">
                #{uniqueVal}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="text-white/80 hover:text-white p-0.5 rounded hover:bg-gov-blue-800 transition-colors shrink-0"
          title="बन्द गर्नुहोस् (Close)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 2. Direct 1-Click Edit Action Button */}
      <div className="px-2.5 py-1.5 bg-gradient-to-r from-gov-blue-50 to-blue-50/40 border-b border-slate-200 shrink-0">
        <button
          type="button"
          onClick={onOpenExistingDialog}
          className="w-full btn-gov-primary py-1.5 px-2.5 text-xs font-bold font-nepali flex items-center justify-center gap-1.5 shadow-sm active:scale-98 transition-transform"
          id="btn-edit-view-details"
          title="सिधै सम्पादन मोड खोल्नुहोस् (Open Edit Mode Directly)"
        >
          <Edit3 className="w-3.5 h-3.5 text-gov-gold-400" />
          <span>सम्पादन गर्नुहोस् (Edit Mode)</span>
          <ArrowRight className="w-3.5 h-3.5 text-white/80 ml-auto" />
        </button>
      </div>

      {/* 3. Small Scrollable Read-Only Attributes List */}
      <div className="px-2 py-1.5 flex-1 overflow-y-auto space-y-1 scrollbar-thin">
        {displayFields.length === 0 ? (
          <div className="py-2 text-center text-[10px] text-slate-400 font-nepali italic">
            कुनै विशेषता उपलब्ध छैनन्
          </div>
        ) : (
          displayFields.map((f, idx) => (
            <div
              key={f.key || idx}
              className="px-2 py-1 rounded bg-slate-50 border border-slate-100 flex items-center justify-between gap-2 text-[11px] hover:bg-slate-100/70 transition-colors"
            >
              <div className="min-w-0 flex items-center gap-1">
                <span className="font-semibold text-slate-600 font-nepali truncate max-w-[120px]">
                  {f.label}
                </span>
                {f.required && (
                  <span className="text-gov-red-600 font-bold" title="अनिवार्य">*</span>
                )}
                {f.is_unique && (
                  <Key className="w-2.5 h-2.5 text-amber-600 shrink-0" title="अद्वितीय" />
                )}
              </div>

              <div className="font-bold text-slate-800 text-right truncate max-w-[55%] font-mono text-[10.5px]">
                {formatValue(f.value, f.type)}
              </div>
            </div>
          ))
        )}

        {/* Audit Meta row if present */}
        {(properties._created_by_username || properties.Kmc_Editor) && (
          <div className="px-2 py-0.5 text-[9.5px] text-slate-400 flex justify-between font-nepali">
            <span>संकलक:</span>
            <span className="font-mono text-slate-600 font-semibold">
              @{properties._created_by_username || properties.Kmc_Editor}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
