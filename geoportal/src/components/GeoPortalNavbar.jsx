'use client';

import { useState } from 'react';
import {
  Globe, Layers, LogIn, LogOut, ShieldCheck, RefreshCw,
  BarChart3, ClipboardList, CheckCircle2, ChevronDown, User, Shield
} from 'lucide-react';
import { EmblemOfNepal, MunicipalLogo, NepalFlag } from './NepalEmblem';

const ROLE_BADGES = {
  SuperAdmin: { label: 'सुपर प्रशासक', class: 'bg-red-50 text-red-800 border-red-300' },
  GisAdmin: { label: 'GIS अधिकृत (Admin)', class: 'bg-red-50 text-red-800 border-red-300' },
  Validator: { label: 'प्रमाणीकरणकर्ता (Validator)', class: 'bg-purple-50 text-purple-800 border-purple-300' },
  MunicipalUser: { label: 'नगरपालिका कर्मचारी', class: 'bg-blue-50 text-blue-800 border-blue-300' },
  DataCollector: { label: 'तथ्याङ्क संकलक', class: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
  BasicViewer: { label: 'नागरिक दर्शक (Viewer)', class: 'bg-slate-50 text-slate-800 border-slate-300' },
};

export default function GeoPortalNavbar({
  catalog,
  loading = false,
  onRefresh,
  catalogCollapsed,
  onToggleCatalog,
  analyticsCollapsed,
  onToggleAnalytics,
  user = null,
  onOpenLogin,
  onLogout,
}) {
  const [showUserMenu, setShowUserMenu] = useState(false);

  const totalLayers = catalog?.total_vector_layers || 0;
  const totalRasters = catalog?.total_raster_packages || 0;
  const roleBadge = ROLE_BADGES[user?.role] || ROLE_BADGES.BasicViewer;

  return (
    <header className="w-full bg-white shadow-md z-40 relative flex-shrink-0" id="government-header">
      {/* 1. TOP ACCENT TRICOLOR BAR (Official Nepal Gov Red & Royal Blue standard) */}
      <div className="gov-tricolor-bar" />

      {/* 2. OFFICIAL GOVERNMENT MASTHEAD */}
      <div className="px-2.5 sm:px-4 py-1.5 md:py-2 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 md:gap-4">
          
          {/* Left: Coat of Arms + Municipal Logo + Hierarchy */}
          <div className="flex items-center gap-2 sm:gap-3.5 min-w-0">
            <EmblemOfNepal className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 shrink-0" size={56} />
            <MunicipalLogo className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 shrink-0" size={56} />
            
            <div className="leading-tight min-w-0">
              <div className="text-[9px] sm:text-[11px] font-semibold text-gov-red-700 font-nepali truncate">
                नेपाल सरकार • काठमाडौँ महानगरपालिका • नगर कार्यपालिकाको कार्यालय
              </div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm sm:text-lg md:text-xl font-bold text-gov-blue-800 tracking-tight font-nepali truncate">
                  काठमाडौँ महानगरपालिका
                </h1>
                <span className="md:hidden text-[9px] font-bold text-gov-blue-900 uppercase bg-gov-blue-50 px-1 py-0.2 rounded border border-gov-blue-100 shrink-0">
                  GeoPortal
                </span>
              </div>
              <div className="hidden md:inline-block text-[10px] md:text-[11px] font-bold text-gov-blue-900 uppercase tracking-wider bg-gov-blue-50/90 px-2 py-0.5 rounded mt-0.5 border border-gov-blue-200">
                एकीकृत भू-स्थानिक खुला पोर्टल (KMC Public GeoPortal)
              </div>
            </div>
          </div>

          {/* Right: National Flag, Refresh & Auth Controls */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Waving National Flag */}
            <div className="hidden lg:flex items-center gap-2 pr-3 border-r border-slate-200">
              <NepalFlag className="w-7 h-9" />
            </div>

            {/* Quick Status Pill */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-800 font-nepali">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>{user ? `${roleBadge.label} मोड` : 'खुला पहुँच (Public)'}</span>
            </div>

            {/* Refresh Button */}
            <button
              onClick={onRefresh}
              disabled={loading}
              className="p-1.5 sm:p-2 rounded-lg border border-slate-200 text-gov-blue-800 hover:bg-gov-blue-50 transition-colors"
              title="पुनः लोड गर्नुहोस् (Refresh Catalog)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* User Profile or Login Button */}
            {user ? (
              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-gov-blue-800 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                    {user.full_name ? user.full_name.charAt(0).toUpperCase() : 'U'}
                  </div>
                  <div className="hidden md:block text-left pr-1">
                    <div className="text-xs font-bold text-slate-800 leading-tight">
                      {user.full_name || user.username}
                    </div>
                    <div className="text-[10px] text-gov-blue-700 font-semibold font-nepali">
                      {roleBadge.label}
                    </div>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden sm:block" />
                </button>

                {showUserMenu && (
                  <div className="absolute top-full right-0 mt-1 w-56 bg-white rounded-xl border border-slate-200 shadow-xl p-1 z-50 animate-scale-up font-sans text-xs">
                    <div className="p-2.5 border-b border-slate-100 bg-slate-50 rounded-t-lg">
                      <div className="font-bold text-slate-800">{user.full_name || user.username}</div>
                      <div className="text-[11px] text-slate-500 truncate">{user.email || user.username}</div>
                      <span className={`inline-block mt-1 px-1.5 py-0.2 rounded text-[9px] font-bold border font-nepali ${roleBadge.class}`}>
                        {roleBadge.label}
                      </span>
                    </div>

                    <a
                      href="/login"
                      className="w-full flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-100 rounded-md transition-colors font-nepali"
                    >
                      <ClipboardList className="w-3.5 h-3.5 text-gov-blue-800" />
                      <span>तथ्याङ्क संकलन पोर्टल (Field Data)</span>
                    </a>

                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        onLogout?.();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-gov-red-700 hover:bg-gov-red-50 rounded-md transition-colors font-nepali font-semibold border-t border-slate-100 mt-1"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>प्रणालीबाट बाहिरिनुहोस् (Sign Out)</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={onOpenLogin}
                className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-lg bg-gov-blue-800 hover:bg-gov-blue-900 active:scale-98 text-white text-xs font-bold transition-all shadow-sm font-nepali cursor-pointer border border-gov-blue-900"
                title="प्रमाणीकरणकर्ता वा GIS प्रशासक लगइन (Sign In)"
              >
                <LogIn className="w-3.5 h-3.5 text-gov-gold-400" />
                <span>लगइन (Sign In)</span>
              </button>
            )}
          </div>

        </div>
      </div>

      {/* 3. GOVERNMENT NAVIGATION RIBBON (Royal Navy Blue #0447AF — Matching Field Data Collection) */}
      <nav className="bg-gov-blue-800 text-white px-4 shadow-inner hidden md:block" id="main-gov-navigation">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center overflow-x-auto py-1 scrollbar-none gap-1.5">
            
            {/* GeoPortal Map Module Tab (Active) */}
            <button
              className="px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors bg-gov-blue-950 text-white border border-gov-gold-400/60 shadow-sm"
              title="एकीकृत खुला भू-पोर्टल नक्सा"
            >
              <Globe className="w-3.5 h-3.5 text-gov-gold-400" />
              <span>खुला भू-पोर्टल (Public Map)</span>
            </button>

            {/* Toggle Layer Control */}
            <button
              onClick={onToggleCatalog}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                !catalogCollapsed
                  ? 'bg-gov-blue-700 text-white border border-gov-blue-600'
                  : 'text-gov-blue-100 hover:bg-gov-blue-700 hover:text-white'
              }`}
              title="तह व्यवस्थापन प्यानल खोल्नुहोस्/बन्द गर्नुहोस्"
            >
              <Layers className="w-3.5 h-3.5 text-gov-gold-400" />
              <span>तह व्यवस्थापन ({totalLayers + totalRasters})</span>
            </button>

            {/* Toggle Analytics Infographics */}
            <button
              onClick={onToggleAnalytics}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                !analyticsCollapsed
                  ? 'bg-gov-blue-700 text-white border border-gov-blue-600'
                  : 'text-gov-blue-100 hover:bg-gov-blue-700 hover:text-white'
              }`}
              title="इन्फोग्राफिक्स तथा तथ्याङ्कीय विश्लेषण"
            >
              <BarChart3 className="w-3.5 h-3.5 text-gov-gold-400" />
              <span>इन्फोग्राफिक्स (Analytics)</span>
            </button>

            <span className="text-gov-blue-600 px-1">|</span>

            {/* Direct Switch to GIS Control */}
            <a
              href="/login"
              className="px-2.5 py-1.5 rounded-md text-xs font-medium text-gov-blue-100 hover:bg-gov-blue-700 hover:text-white flex items-center gap-1.5 transition-colors"
              title="GIS Control प्रणालीमा जानुहोस् (Go to GIS Control)"
            >
              <ClipboardList className="w-3.5 h-3.5 text-gov-gold-400" />
              <span>GIS Control</span>
            </a>
          </div>

          {/* Right: Live Database Indicator */}
          <div className="flex items-center gap-2 text-[11px] text-gov-blue-100 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-nepali">
              {user?.role === 'GisAdmin' ? 'प्रशासक मोड (All Layers Visible)' : 'केन्द्रीकृत प्रत्यक्ष भू-तथ्याङ्क (PostGIS Live)'}
            </span>
            <span>&bull;</span>
            <span className="font-mono text-gov-gold-300 font-bold">{totalLayers} भेक्टर</span>
            <span>&bull;</span>
            <span className="font-mono text-gov-gold-300 font-bold">{totalRasters} रास्टर</span>
          </div>
        </div>
      </nav>
    </header>
  );
}
