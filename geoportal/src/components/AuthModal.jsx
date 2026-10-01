'use client';

import { useState } from 'react';
import {
  Shield, Eye, EyeOff, Lock, User, AlertCircle, Loader2, X
} from 'lucide-react';
import { EmblemOfNepal, MunicipalLogo } from './NepalEmblem';
import { authAPI } from '../lib/api';

export default function AuthModal({ isOpen, onClose, onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('कृपया प्रयोगकर्ता नाम र पासवर्ड दुवै प्रविष्ट गर्नुहोस्।');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await authAPI.login(username.trim(), password);
      const { access_token, user_id, role, username: uname } = res.data;
      localStorage.setItem('kmc_access_token', access_token);

      let userData = { id: user_id, username: uname, role };
      try {
        const meRes = await authAPI.me();
        userData = meRes.data;
      } catch (err) {}

      localStorage.setItem('kmc_user', JSON.stringify(userData));
      onSuccess?.(userData);
      onClose();
    } catch (err) {
      const msg = err.response?.data?.detail || 'लगइन असफल भयो। कृपया विवरण जाँच गर्नुहोस्।';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Tricolor Ribbon */}
        <div className="gov-tricolor-bar" />

        {/* Header */}
        <div className="p-4 bg-gov-blue-800 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-gov-gold-400" />
            <h2 className="text-sm font-bold font-nepali">
              भू-स्थानिक प्रणाली लगइन (GeoPortal Sign In)
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-gov-blue-900 text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          <div className="text-center mb-5">
            <div className="inline-flex items-center justify-center gap-3 mb-2">
              <EmblemOfNepal className="w-12 h-12 drop-shadow-sm" size={48} />
              <MunicipalLogo className="w-12 h-12 drop-shadow-sm" size={48} />
            </div>
            <h1 className="text-base font-bold text-gov-blue-800 font-nepali">
              काठमाडौँ महानगरपालिका
            </h1>
            <p className="text-[11px] text-slate-500 font-nepali mt-0.5">
              प्रमाणीकरणकर्ता (Validator) तथा GIS प्रशासक पहुँच
            </p>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-gov-red-50 border border-gov-red-200 text-gov-red-800 text-xs">
              <AlertCircle className="w-4 h-4 text-gov-red-700 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 font-nepali mb-1">
                प्रयोगकर्ता नाम (Username)
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  autoComplete="username"
                  required
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:ring-2 focus:ring-gov-blue-800 focus:border-gov-blue-800 outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 font-nepali mb-1">
                पासवर्ड (Password)
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  required
                  className="w-full pl-9 pr-9 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:ring-2 focus:ring-gov-blue-800 focus:border-gov-blue-800 outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 bg-gov-blue-800 hover:bg-gov-blue-900 active:scale-98 text-white rounded-lg font-bold font-nepali text-xs transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-gov-gold-400" />
                  <span>प्रमाणित गरिँदैछ...</span>
                </>
              ) : (
                <span>लगइन गर्नुहोस् (Sign In)</span>
              )}
            </button>
          </form>

          <p className="mt-4 text-center text-[10px] text-slate-400 font-nepali">
            * फिल्ड तथ्याङ्क संकलन प्रणालीबाट GIS प्रशासकले सिर्जना गरेको खाताबाट लगइन गर्नुहोस्।
          </p>
        </div>
      </div>
    </div>
  );
}
