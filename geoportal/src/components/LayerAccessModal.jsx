'use client';

import { useState, useEffect } from 'react';
import {
  X, Shield, Lock, Globe, Check, AlertCircle, Loader2,
  Sliders, Database, Image, BarChart3, Eye, EyeOff, Save
} from 'lucide-react';
import { geoportalAPI } from '../lib/api';

export default function LayerAccessModal({ layer, isOpen, onClose, onSaved }) {
  if (!isOpen || !layer) return null;

  const isVector = layer.type === 'vector';
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // 1. Accessibility Level: 'public' | 'validator' | 'admin_only'
  const initialAccess = layer.access_level || (
    layer.role_permissions?.access_level ||
    (layer.role_permissions?.BasicViewer?.can_view === false ? 'validator' : 'public')
  );
  const [accessLevel, setAccessLevel] = useState(initialAccess);

  // 2. Publication & Default Visibility
  const [published, setPublished] = useState(layer.published ?? true);
  const [defaultVisible, setDefaultVisible] = useState(
    isVector ? (layer.default_visible ?? false) : (layer.default_visible ?? false)
  );
  const [opacity, setOpacity] = useState(layer.opacity ?? 1.0);

  // 3. Vector Fields Configuration
  const allFields = layer.all_fields_config || layer.fields_config || [];
  const existingFieldPerms = layer.field_permissions || {};
  const existingChartFields = layer.dashboard_config?.chart_fields || [];

  // fieldVisibilityMap: { [fieldName]: 'public' | 'validator' | 'admin' }
  const [fieldVisibilityMap, setFieldVisibilityMap] = useState({});
  // selectedChartFields: Set of field names to use in infographics
  const [selectedChartFields, setSelectedChartFields] = useState(new Set());

  useEffect(() => {
    if (layer) {
      const initAccess = layer.access_level || (
        layer.role_permissions?.access_level ||
        (layer.role_permissions?.BasicViewer?.can_view === false ? 'validator' : 'public')
      );
      setAccessLevel(initAccess);
      setPublished(layer.published ?? true);
      setDefaultVisible(layer.default_visible ?? false);
      setOpacity(layer.opacity ?? 1.0);

      // Initialize field visibility
      const fMap = {};
      const fSet = new Set(layer.dashboard_config?.chart_fields || []);
      const fPerms = layer.field_permissions || {};

      allFields.forEach((f) => {
        const fname = f.name;
        if (!fname) return;
        const allowedRoles = fPerms[fname];
        if (!allowedRoles || allowedRoles.includes('BasicViewer')) {
          fMap[fname] = 'public';
        } else if (allowedRoles.includes('Validator')) {
          fMap[fname] = 'validator';
        } else {
          fMap[fname] = 'admin';
        }
      });

      setFieldVisibilityMap(fMap);
      setSelectedChartFields(fSet);
    }
  }, [layer]);

  const handleFieldVisibilityChange = (fieldName, level) => {
    setFieldVisibilityMap((prev) => ({
      ...prev,
      [fieldName]: level,
    }));
  };

  const handleToggleChartField = (fieldName) => {
    setSelectedChartFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldName)) {
        next.delete(fieldName);
      } else {
        next.add(fieldName);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      // Build role_permissions
      const role_permissions = {
        access_level: accessLevel,
        BasicViewer: { can_view: accessLevel === 'public', can_download: accessLevel === 'public', can_stats: accessLevel === 'public' },
        Validator: { can_view: accessLevel !== 'admin_only', can_download: true, can_stats: true },
        MunicipalUser: { can_view: accessLevel !== 'admin_only', can_download: true, can_stats: true },
        GisAdmin: { can_view: true, can_download: true, can_stats: true },
        SuperAdmin: { can_view: true, can_download: true, can_stats: true },
      };

      if (isVector) {
        // Build field_permissions
        const field_permissions = {};
        Object.entries(fieldVisibilityMap).forEach(([fname, level]) => {
          if (level === 'public') {
            field_permissions[fname] = ['BasicViewer', 'Validator', 'MunicipalUser', 'GisAdmin', 'SuperAdmin'];
          } else if (level === 'validator') {
            field_permissions[fname] = ['Validator', 'MunicipalUser', 'GisAdmin', 'SuperAdmin'];
          } else {
            field_permissions[fname] = ['GisAdmin', 'SuperAdmin'];
          }
        });

        const dashboard_config = {
          ...(layer.dashboard_config || {}),
          chart_fields: Array.from(selectedChartFields),
        };

        await geoportalAPI.updateLayerConfig(layer.id, {
          published_in_geoportal: published,
          default_visible_in_geoportal: defaultVisible,
          opacity: parseFloat(opacity),
          role_permissions,
          field_permissions,
          dashboard_config,
        });
      } else {
        // Raster
        await geoportalAPI.updateMBTilesConfig(layer.id, {
          published_in_geoportal: published,
          default_visible: defaultVisible,
          role_permissions,
        });
      }

      setSuccess(true);
      setTimeout(() => {
        onSaved?.();
        onClose();
      }, 700);
    } catch (err) {
      setError(err.response?.data?.detail || 'तह पहुँच विवरण सुरक्षित गर्न सकिएन।');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Top Tricolor Bar */}
        <div className="gov-tricolor-bar" />

        {/* Modal Header */}
        <div className="p-4 bg-gov-blue-800 text-white flex items-center justify-between shrink-0 shadow-sm">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-gov-blue-950 flex items-center justify-center border border-gov-gold-400/40 shrink-0">
              <Shield className="w-4 h-4 text-gov-gold-400" />
            </div>
            <div className="truncate">
              <h2 className="text-xs sm:text-sm font-bold font-nepali truncate">
                तह पहुँच तथा विशेषता व्यवस्थापन (Layer Access & Attributes)
              </h2>
              <span className="text-[10px] text-gov-gold-300 font-semibold block truncate">
                {layer.name} ({isVector ? 'भेक्टर तह' : 'रास्टर इमेज्री'})
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-gov-blue-900 text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4 text-xs font-sans scrollbar-thin">
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-gov-red-50 border border-gov-red-200 text-gov-red-800 text-xs">
              <AlertCircle className="w-4 h-4 text-gov-red-700 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold font-nepali">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>पहुँच स्तर तथा विशेषताहरू सफलतापूर्वक अद्यावधिक गरियो!</span>
            </div>
          )}

          {/* 1. LAYER ACCESSIBILITY LEVEL */}
          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200">
            <label className="block text-xs font-bold text-gov-blue-950 font-nepali mb-1.5 flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-gov-blue-800" />
              जियोपोर्टलमा तहको पहुँच स्तर (GeoPortal Accessibility):
            </label>
            <p className="text-[11px] text-slate-500 font-nepali mb-3">
              यो तह जियोपोर्टलमा कुन प्रयोगकर्तालाई देखाउने भन्ने छनौट गर्नुहोस्:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* Option 1: Any Viewer / Public */}
              <button
                type="button"
                onClick={() => setAccessLevel('public')}
                className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  accessLevel === 'public'
                    ? 'bg-gov-blue-50/80 border-gov-blue-800 ring-2 ring-gov-blue-800/20'
                    : 'bg-white border-slate-200 hover:bg-slate-100'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Globe className="w-4 h-4 text-gov-blue-800" />
                    {accessLevel === 'public' && <Check className="w-3.5 h-3.5 text-gov-blue-800" />}
                  </div>
                  <span className="font-bold text-xs text-slate-800 font-nepali block">
                    सबै दर्शक (Any Viewer)
                  </span>
                  <span className="text-[10px] text-slate-500 font-nepali block mt-0.5">
                    लगइन विना जो कोही नागरिकले हेर्न मिल्ने (Public Open Data)
                  </span>
                </div>
              </button>

              {/* Option 2: Validators Only */}
              <button
                type="button"
                onClick={() => setAccessLevel('validator')}
                className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  accessLevel === 'validator'
                    ? 'bg-purple-50/80 border-purple-700 ring-2 ring-purple-700/20'
                    : 'bg-white border-slate-200 hover:bg-slate-100'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Shield className="w-4 h-4 text-purple-700" />
                    {accessLevel === 'validator' && <Check className="w-3.5 h-3.5 text-purple-700" />}
                  </div>
                  <span className="font-bold text-xs text-slate-800 font-nepali block">
                    प्रमाणीकरणकर्ता मात्र
                  </span>
                  <span className="text-[10px] text-slate-500 font-nepali block mt-0.5">
                    लगइन गरेका प्रमाणीकरणकर्ता (Validators) र प्रशासकले मात्र हेर्न मिल्ने
                  </span>
                </div>
              </button>

              {/* Option 3: GIS Admin Only */}
              <button
                type="button"
                onClick={() => setAccessLevel('admin_only')}
                className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  accessLevel === 'admin_only'
                    ? 'bg-gov-red-50/80 border-gov-red-700 ring-2 ring-gov-red-700/20'
                    : 'bg-white border-slate-200 hover:bg-slate-100'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Lock className="w-4 h-4 text-gov-red-700" />
                    {accessLevel === 'admin_only' && <Check className="w-3.5 h-3.5 text-gov-red-700" />}
                  </div>
                  <span className="font-bold text-xs text-slate-800 font-nepali block">
                    GIS प्रशासक मात्र
                  </span>
                  <span className="text-[10px] text-slate-500 font-nepali block mt-0.5">
                    गोप्य तह, GIS Admin ले मात्र हेर्न र सम्पादन गर्न मिल्ने
                  </span>
                </div>
              </button>
            </div>
          </div>

          {/* 2. GENERAL PUBLISHING TOGGLES */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div>
                <span className="font-bold text-xs text-slate-800 font-nepali block">
                  जियोपोर्टलमा प्रकाशित (Published)
                </span>
                <span className="text-[10px] text-slate-500 font-nepali">
                  सक्रिय भएमा क्याटलगमा देखिनेछ
                </span>
              </div>
              <input
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
                className="w-4 h-4 accent-gov-blue-800 cursor-pointer"
              />
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div>
                <span className="font-bold text-xs text-slate-800 font-nepali block">
                  पूर्वनिर्धारित अन (Default Visible)
                </span>
                <span className="text-[10px] text-slate-500 font-nepali">
                  नक्सा लोड हुँदा स्वतः नक्सामा खुल्नेछ
                </span>
              </div>
              <input
                type="checkbox"
                checked={defaultVisible}
                onChange={(e) => setDefaultVisible(e.target.checked)}
                className="w-4 h-4 accent-gov-blue-800 cursor-pointer"
              />
            </div>
          </div>

          {/* 3. VECTOR ATTRIBUTE SECURITY & INFOGRAPHICS (Only for Vector Layers) */}
          {isVector && (
            <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-gov-blue-950 font-nepali flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-gov-blue-800" />
                  विशेषता फिल्डहरू तथा इन्फोग्राफिक्स (Attributes & Infographics):
                </label>
                <span className="text-[10px] text-gov-gold-700 font-bold bg-gov-gold-50 px-2 py-0.5 rounded border border-gov-gold-200">
                  {allFields.length} विशेषता फिल्डहरू
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-nepali mb-3">
                प्रत्येक फिल्डको लागि दर्शक वा प्रमाणीकरणकर्तालाई देखाउने अनुमति र इन्फोग्राफिक्स चार्ट बनाउने फिल्ड छनौट गर्नुहोस्:
              </p>

              {allFields.length === 0 ? (
                <div className="p-4 text-center text-slate-400 font-nepali italic bg-white rounded-lg border border-slate-200">
                  कुनै पनि विशेषता फिल्ड उपलब्ध छैन
                </div>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin">
                  {allFields.map((f) => {
                    const fname = f.name;
                    if (!fname) return null;
                    const vis = fieldVisibilityMap[fname] || 'public';
                    const isChart = selectedChartFields.has(fname);

                    return (
                      <div
                        key={fname}
                        className="p-2.5 rounded-lg bg-white border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-xs"
                      >
                        {/* Field Name & Type */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-800 font-mono text-xs">
                              {fname}
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[9px] bg-slate-100 text-slate-600 font-mono border border-slate-200">
                              {f.type || 'text'}
                            </span>
                          </div>
                          {f.label && f.label !== fname && (
                            <span className="text-[10px] text-slate-400 block font-nepali truncate">
                              {f.label}
                            </span>
                          )}
                        </div>

                        {/* Controls */}
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Visibility Dropdown */}
                          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[10px] font-nepali">
                            <button
                              type="button"
                              onClick={() => handleFieldVisibilityChange(fname, 'public')}
                              className={`px-2 py-1 rounded-md transition-colors ${
                                vis === 'public'
                                  ? 'bg-gov-blue-800 text-white font-bold shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                              title="सबै दर्शकले हेर्न मिल्ने"
                            >
                              सबै दर्शक
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFieldVisibilityChange(fname, 'validator')}
                              className={`px-2 py-1 rounded-md transition-colors ${
                                vis === 'validator'
                                  ? 'bg-purple-700 text-white font-bold shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                              title="प्रमाणीकरणकर्ताले मात्र हेर्न मिल्ने"
                            >
                              प्रमाणीकरणकर्ता
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFieldVisibilityChange(fname, 'admin')}
                              className={`px-2 py-1 rounded-md transition-colors ${
                                vis === 'admin'
                                  ? 'bg-gov-red-700 text-white font-bold shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                              title="लुकाउनुहोस् (प्रशासकले मात्र)"
                            >
                              लुकाउने
                            </button>
                          </div>

                          {/* Infographics Toggle */}
                          <button
                            type="button"
                            onClick={() => handleToggleChartField(fname)}
                            className={`p-1.5 rounded-lg border flex items-center gap-1 transition-colors text-[10px] font-nepali ${
                              isChart
                                ? 'bg-gov-gold-50 border-gov-gold-400 text-gov-gold-800 font-bold'
                                : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'
                            }`}
                            title="इन्फोग्राफिक्समा समावेश गर्ने"
                          >
                            <BarChart3 className={`w-3.5 h-3.5 ${isChart ? 'text-gov-gold-600' : 'text-slate-400'}`} />
                            <span className="hidden sm:inline">चार्ट</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold transition-colors"
          >
            रद्द गर्नुहोस् (Cancel)
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="px-5 py-2 bg-gov-blue-800 hover:bg-gov-blue-900 active:scale-98 text-white rounded-lg text-xs font-bold font-nepali shadow-md transition-all flex items-center gap-2 disabled:opacity-60 cursor-pointer"
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-gov-gold-400" />
                <span>सुरक्षित गरिँदैछ...</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5 text-gov-gold-400" />
                <span>पहुँच स्तर सुरक्षित गर्नुहोस् (Save Changes)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
