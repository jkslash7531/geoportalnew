'use client';

import { X, Info, Database, MapPin, Calendar, FileText } from 'lucide-react';

export default function MetadataModal({ layer, isOpen, onClose }) {
  if (!isOpen || !layer) return null;

  const metadata = layer.metadata_info || {};

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-gov-blue-800 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Info className="w-5 h-5 text-gov-gold-400" />
            <h2 className="text-sm font-bold font-nepali">तह मेटाडाटा तथा विवरण (Layer Metadata)</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs text-slate-700 max-h-[75vh] overflow-y-auto">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <div>
              <div className="text-[10px] text-slate-400 font-semibold uppercase">तहको नाम (Layer Name)</div>
              <div className="text-sm font-bold text-slate-900">{layer.name}</div>
            </div>
            {layer.description && (
              <div>
                <div className="text-[10px] text-slate-400 font-semibold uppercase">विवरण (Description)</div>
                <div className="text-slate-600 mt-0.5">{layer.description}</div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 font-mono">
            <div className="p-2.5 bg-white border border-slate-200 rounded-lg">
              <span className="text-[10px] text-slate-400 block uppercase">ज्यामिति (Geometry)</span>
              <span className="font-bold text-slate-800 text-xs">{layer.geometry_type || layer.type}</span>
            </div>
            <div className="p-2.5 bg-white border border-slate-200 rounded-lg">
              <span className="text-[10px] text-slate-400 block uppercase">विशेषता संख्या (Features)</span>
              <span className="font-bold text-slate-800 text-xs">
                {layer.feature_count ? layer.feature_count.toLocaleString() : 'N/A'}
              </span>
            </div>
            <div className="p-2.5 bg-white border border-slate-200 rounded-lg">
              <span className="text-[10px] text-slate-400 block uppercase">श्रेणी (Category)</span>
              <span className="font-bold text-slate-800 text-xs">{layer.category || 'General'}</span>
            </div>
            <div className="p-2.5 bg-white border border-slate-200 rounded-lg">
              <span className="text-[10px] text-slate-400 block uppercase">प्रणाली (CRS)</span>
              <span className="font-bold text-slate-800 text-xs">EPSG:4326 / EPSG:3857</span>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between py-1">
              <span className="text-slate-500 font-nepali">स्रोत (Data Source):</span>
              <span className="font-semibold text-slate-800">{metadata.source || 'काठमाडौँ महानगरपालिका (KMC)'}</span>
            </div>
          </div>

          {layer.fields_config && layer.fields_config.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-slate-800 mb-1.5 font-nepali">
                सार्वजनिक फिल्डहरू (Attributes):
              </div>
              <div className="flex flex-wrap gap-1">
                {layer.fields_config.map((f) => (
                  <span
                    key={f.name}
                    className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-mono text-[10px]"
                  >
                    {f.name} ({f.type || 'text'})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-gov-blue-800 hover:bg-gov-blue-900 text-white font-bold text-xs font-nepali transition-colors"
          >
            बन्द गर्नुहोस् (Close)
          </button>
        </div>
      </div>
    </div>
  );
}
