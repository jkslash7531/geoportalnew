'use client';

import { useState, useEffect } from 'react';
import { X, Save, Shield, Eye, Lock, Sliders, Palette, Check, AlertCircle } from 'lucide-react';
import { geoportalAPI } from '../../lib/api';

const AVAILABLE_ROLES = [
  { key: 'BasicViewer', label: 'सर्वसाधारण नागरिक (Basic Viewer)' },
  { key: 'MunicipalUser', label: 'नगरपालिका कर्मचारी (Municipal User)' },
  { key: 'DataCollector', label: 'तथ्याङ्क संकलक (Data Collector)' },
  { key: 'Validator', label: 'प्रमाणीकरणकर्ता (Validator)' },
];

const PREDEFINED_CATEGORIES = [
  'Boundaries & Administrative',
  'Roads & Transport',
  'Buildings & Infrastructure',
  'Utilities & Drainage',
  'Public Facilities & Schools',
  'Environment & Greenery',
  'Base Maps',
  'General',
];

export default function LayerConfigModal({ layer, isOpen, onClose, onSaved }) {
  if (!isOpen || !layer) return null;

  const [activeTab, setActiveTab] = useState('general'); // general | security | styling
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Form State
  const [category, setCategory] = useState(layer.category || 'General');
  const [customCategory, setCustomCategory] = useState('');
  const [published, setPublished] = useState(layer.published ?? true);
  const [defaultVisible, setDefaultVisible] = useState(layer.default_visible ?? false);
  const [opacity, setOpacity] = useState(layer.opacity ?? 1.0);
  const [displayOrder, setDisplayOrder] = useState(layer.display_order ?? 0);

  // Styling state
  const [strokeColor, setStrokeColor] = useState(layer.style?.strokeColor || '#0447AF');
  const [fillColor, setFillColor] = useState(layer.style?.fillColor || '#0447AF');
  const [strokeWidth, setStrokeWidth] = useState(layer.style?.strokeWidth || 2);
  const [pointRadius, setPointRadius] = useState(layer.style?.pointRadius || 6);

  // Role permissions
  const [rolePermissions, setRolePermissions] = useState(layer.role_permissions || {});

  // Field level security: { [fieldName]: [allowedRoles] }
  const [fieldPermissions, setFieldPermissions] = useState(layer.field_permissions || {});

  useEffect(() => {
    if (layer) {
      setCategory(layer.category || 'General');
      setPublished(layer.published ?? true);
      setDefaultVisible(layer.default_visible ?? false);
      setOpacity(layer.opacity ?? 1.0);
      setDisplayOrder(layer.display_order ?? 0);
      setRolePermissions(layer.role_permissions || {});
      setFieldPermissions(layer.field_permissions || {});
      setStrokeColor(layer.style?.strokeColor || '#0447AF');
      setFillColor(layer.style?.fillColor || '#0447AF');
      setStrokeWidth(layer.style?.strokeWidth || 2);
      setPointRadius(layer.style?.pointRadius || 6);
    }
  }, [layer]);

  const handleRolePermChange = (roleKey, permKey, value) => {
    setRolePermissions((prev) => {
      const current = prev[roleKey] || {};
      return {
        ...prev,
        [roleKey]: {
          ...current,
          [permKey]: value,
        },
      };
    });
  };

  const handleFieldRoleToggle = (fieldName, roleKey) => {
    setFieldPermissions((prev) => {
      // If field not present in perms, by default all roles can see it
      const currentAllowed = prev[fieldName] !== undefined
        ? prev[fieldName]
        : AVAILABLE_ROLES.map((r) => r.key);

      let nextAllowed;
      if (currentAllowed.includes(roleKey)) {
        nextAllowed = currentAllowed.filter((r) => r !== roleKey);
      } else {
        nextAllowed = [...currentAllowed, roleKey];
      }

      return {
        ...prev,
        [fieldName]: nextAllowed,
      };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const finalCategory = customCategory.trim() || category;
      const payload = {
        category: finalCategory,
        published_in_geoportal: published,
        default_visible_in_geoportal: defaultVisible,
        opacity: parseFloat(opacity),
        display_order: parseInt(displayOrder, 10) || 0,
        style: {
          strokeColor,
          fillColor,
          strokeWidth: parseFloat(strokeWidth),
          pointRadius: parseFloat(pointRadius),
        },
        role_permissions: rolePermissions,
        field_permissions: fieldPermissions,
      };

      await geoportalAPI.updateLayerConfig(layer.id, payload);
      setSuccess(true);
      setTimeout(() => {
        onSaved?.();
        onClose();
      }, 800);
    } catch (err) {
      setError(err.response?.data?.detail || 'तह सेटिङ सुरक्षित गर्न सकिएन');
    } finally {
      setSaving(false);
    }
  };

  const fieldsList = layer.fields_config || [];

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-gov-blue-800 to-gov-blue-900 text-white flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sliders className="w-5 h-5 text-gov-gold-400" />
              <h2 className="text-base font-bold font-nepali">तह विन्यास तथा सुरक्षा (Layer Configuration)</h2>
            </div>
            <p className="text-xs text-slate-200 mt-0.5 font-medium truncate max-w-md">
              {layer.name} ({layer.geometry_type})
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-5 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('general')}
            className={`py-3 px-4 flex items-center gap-2 border-b-2 font-nepali transition-colors ${
              activeTab === 'general'
                ? 'border-gov-blue-800 text-gov-blue-800 font-bold bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sliders className="w-4 h-4" />
            सामान्य विन्यास (General)
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`py-3 px-4 flex items-center gap-2 border-b-2 font-nepali transition-colors ${
              activeTab === 'security'
                ? 'border-gov-blue-800 text-gov-blue-800 font-bold bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield className="w-4 h-4 text-emerald-600" />
            भूमिका तथा फिल्ड सुरक्षा (Field-Level Security)
          </button>
          <button
            onClick={() => setActiveTab('styling')}
            className={`py-3 px-4 flex items-center gap-2 border-b-2 font-nepali transition-colors ${
              activeTab === 'styling'
                ? 'border-gov-blue-800 text-gov-blue-800 font-bold bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Palette className="w-4 h-4 text-indigo-600" />
            नक्सा शैली (Styling)
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4 text-xs text-slate-700">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>तहको विन्यास सफलतापूर्वक सुरक्षित गरियो!</span>
            </div>
          )}

          {/* TAB 1: GENERAL */}
          {activeTab === 'general' && (
            <div className="space-y-4">
              <div>
                <label className="block font-semibold mb-1 text-slate-800 font-nepali">
                  तहको वर्ग/श्रेणी (Layer Category):
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="p-2 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-gov-blue-800"
                  >
                    {PREDEFINED_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="नयाँ वर्ग थप्नुहोस् (Custom Category)"
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    className="p-2 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={published}
                    onChange={(e) => setPublished(e.target.checked)}
                    className="w-4 h-4 rounded text-gov-blue-800 focus:ring-gov-blue-800"
                  />
                  <div>
                    <div className="font-bold text-slate-800 font-nepali">जियोपोर्टलमा प्रकाशित (Published)</div>
                    <div className="text-[11px] text-slate-500">प्रयोगकर्ताहरूलाई क्याटलगमा देखाइनेछ</div>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={defaultVisible}
                    onChange={(e) => setDefaultVisible(e.target.checked)}
                    className="w-4 h-4 rounded text-gov-blue-800 focus:ring-gov-blue-800"
                  />
                  <div>
                    <div className="font-bold text-slate-800 font-nepali">सुरुमा सक्रिय (Default Visible)</div>
                    <div className="text-[11px] text-slate-500">पोर्टल खुल्दा स्वतः नक्सामा देखिनेछ</div>
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold mb-1 text-slate-800 font-nepali">
                    पारदर्शिता (Opacity): {Math.round(opacity * 100)}%
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={opacity}
                    onChange={(e) => setOpacity(e.target.value)}
                    className="w-full accent-gov-blue-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-slate-800 font-nepali">
                    प्रस्तुति क्रम (Display Order):
                  </label>
                  <input
                    type="number"
                    value={displayOrder}
                    onChange={(e) => setDisplayOrder(e.target.value)}
                    className="p-2 border border-slate-300 rounded-lg text-xs w-full"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SECURITY & FIELD-LEVEL PERMISSIONS */}
          {activeTab === 'security' && (
            <div className="space-y-5">
              <div>
                <h3 className="font-bold text-slate-900 mb-2 flex items-center gap-1.5 font-nepali">
                  <Shield className="w-4 h-4 text-gov-blue-800" />
                  भूमिका-आधारित अनुमतिहरू (Role-Based Permissions)
                </h3>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold font-nepali">
                      <tr>
                        <th className="p-2.5">भूमिका (Role)</th>
                        <th className="p-2.5 text-center">हेर्न मिल्ने (View)</th>
                        <th className="p-2.5 text-center">डाउनलोड (Export)</th>
                        <th className="p-2.5 text-center">तथ्याङ्क (Stats)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {AVAILABLE_ROLES.map((r) => {
                        const cfg = rolePermissions[r.key] || {};
                        const canView = cfg.can_view ?? true;
                        const canDl = cfg.can_download ?? true;
                        const canSt = cfg.can_stats ?? true;
                        return (
                          <tr key={r.key} className="hover:bg-slate-50">
                            <td className="p-2.5 font-medium text-slate-800">{r.label}</td>
                            <td className="p-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={canView}
                                onChange={(e) => handleRolePermChange(r.key, 'can_view', e.target.checked)}
                                className="w-4 h-4 accent-gov-blue-800"
                              />
                            </td>
                            <td className="p-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={canDl}
                                onChange={(e) => handleRolePermChange(r.key, 'can_download', e.target.checked)}
                                className="w-4 h-4 accent-gov-blue-800"
                              />
                            </td>
                            <td className="p-2.5 text-center">
                              <input
                                type="checkbox"
                                checked={canSt}
                                onChange={(e) => handleRolePermChange(r.key, 'can_stats', e.target.checked)}
                                className="w-4 h-4 accent-gov-blue-800"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Field-Level Security Matrix */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-slate-900 flex items-center gap-1.5 font-nepali">
                    <Lock className="w-4 h-4 text-amber-600" />
                    फिल्ड-तह सुरक्षा म्याट्रिक्स (Field-Level Attribute Security)
                  </h3>
                  <span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                    Admin / SuperAdmin ले सधैँ सबै फिल्ड देख्न पाउनेछन्
                  </span>
                </div>

                {fieldsList.length === 0 ? (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 text-center">
                    यस तहमा कुनै विशेषता फिल्डहरू (Attributes) परिभाषित गरिएको छैन।
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-60 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold font-nepali sticky top-0">
                        <tr>
                          <th className="p-2.5">फिल्ड नाम (Attribute Field)</th>
                          <th className="p-2.5">प्रकार</th>
                          {AVAILABLE_ROLES.map((r) => (
                            <th key={r.key} className="p-2.5 text-center whitespace-nowrap">
                              {r.key}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {fieldsList.map((f) => {
                          const fName = f.name;
                          const allowedRoles = fieldPermissions[fName] !== undefined
                            ? fieldPermissions[fName]
                            : AVAILABLE_ROLES.map((r) => r.key);

                          return (
                            <tr key={fName} className="hover:bg-slate-50">
                              <td className="p-2.5 font-semibold text-slate-800">
                                <div>{f.label || fName}</div>
                                <div className="text-[10px] text-slate-400 font-mono">{fName}</div>
                              </td>
                              <td className="p-2.5 text-slate-500 uppercase text-[10px] font-mono">
                                {f.type || 'text'}
                              </td>
                              {AVAILABLE_ROLES.map((r) => {
                                const isChecked = allowedRoles.includes(r.key);
                                return (
                                  <td key={r.key} className="p-2.5 text-center">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => handleFieldRoleToggle(fName, r.key)}
                                      className="w-4 h-4 accent-gov-blue-800"
                                      title={`${r.key} लाई ${fName} देखाउनुहोस्`}
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: STYLING */}
          {activeTab === 'styling' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold mb-1 text-slate-800 font-nepali">
                    रेखाको रङ्ग (Stroke Color):
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={strokeColor}
                      onChange={(e) => setStrokeColor(e.target.value)}
                      className="w-10 h-8 rounded border border-slate-300 p-0.5 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={strokeColor}
                      onChange={(e) => setStrokeColor(e.target.value)}
                      className="p-1.5 border border-slate-300 rounded text-xs font-mono flex-1"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-slate-800 font-nepali">
                    भित्री रङ्ग (Fill Color):
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={fillColor}
                      onChange={(e) => setFillColor(e.target.value)}
                      className="w-10 h-8 rounded border border-slate-300 p-0.5 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={fillColor}
                      onChange={(e) => setFillColor(e.target.value)}
                      className="p-1.5 border border-slate-300 rounded text-xs font-mono flex-1"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-slate-800 font-nepali">
                    रेखाको मोटाइ (Stroke Width): {strokeWidth}px
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="0.5"
                    value={strokeWidth}
                    onChange={(e) => setStrokeWidth(e.target.value)}
                    className="w-full accent-gov-blue-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-slate-800 font-nepali">
                    बिन्दुको अर्धव्यास (Point Radius): {pointRadius}px
                  </label>
                  <input
                    type="range"
                    min="3"
                    max="20"
                    step="1"
                    value={pointRadius}
                    onChange={(e) => setPointRadius(e.target.value)}
                    className="w-full accent-gov-blue-800"
                  />
                </div>
              </div>

              {/* Style Preview Box */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-800 text-xs font-nepali">शैली पूर्वावलोकन (Style Preview):</div>
                  <div className="text-[11px] text-slate-500">नक्सामा यस्तो स्वरूप देखिनेछ</div>
                </div>
                <div className="flex items-center gap-4">
                  {/* Point preview */}
                  <div
                    className="rounded-full shadow-sm"
                    style={{
                      width: pointRadius * 2,
                      height: pointRadius * 2,
                      backgroundColor: fillColor,
                      borderColor: strokeColor,
                      borderWidth: strokeWidth,
                      borderStyle: 'solid',
                    }}
                  />
                  {/* Line/Polygon preview */}
                  <div
                    className="w-16 h-8 rounded shadow-sm"
                    style={{
                      backgroundColor: `${fillColor}55`,
                      borderColor: strokeColor,
                      borderWidth: strokeWidth,
                      borderStyle: 'solid',
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-medium transition-colors text-xs"
          >
            रद्द गर्नुहोस् (Cancel)
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-gov-blue-800 hover:bg-gov-blue-900 text-white font-bold transition-all text-xs flex items-center gap-1.5 shadow-md disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'सुरक्षित गर्दै...' : 'सुरक्षित गर्नुहोस् (Save Configuration)'}
          </button>
        </div>
      </div>
    </div>
  );
}
