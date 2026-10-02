'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Globe, Layers, Database, Map as MapIcon, Landmark, ShieldCheck,
  ShieldAlert, Loader2, ChevronRight, MapPin, WifiOff, RefreshCw,
} from 'lucide-react';
import { geoportalAPI, geoAPI } from '../lib/api';
import { collectGeoSignals } from '../lib/geoSignals';
import { EmblemOfNepal, MunicipalLogo, NepalFlag } from '../components/NepalEmblem';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatNumber(n) {
  if (n == null) return '—';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

const DENIED_COPY = {
  proxy_headers: {
    en: 'Proxy connections are not permitted.',
    ne: 'प्रोक्सी जडान अनुमति छैन।',
  },
  outside_nepal: {
    en: 'The Geo World of KMC is available to viewers inside Nepal only.',
    ne: 'केएमसीको जियो वर्ल्ड नेपालभित्रका दर्शकहरूका लागि मात्र उपलब्ध छ।',
  },
  vpn_or_datacenter: {
    en: 'VPN, proxy or datacenter connections are not permitted. Please disconnect your VPN and try again.',
    ne: 'VPN, प्रोक्सी वा डाटासेन्टर जडान अनुमति छैन। कृपया VPN बन्द गरेर पुनः प्रयास गर्नुहोस्।',
  },
  webrtc_country_mismatch: {
    en: 'Network identity check failed. Please disable any VPN or proxy and try again.',
    ne: 'नेटवर्क पहिचान जाँच असफल भयो। कृपया VPN वा प्रोक्सी बन्द गरेर पुनः प्रयास गर्नुहोस्।',
  },
  geoip_unavailable: {
    en: 'Your location could not be verified. Please check your connection and try again.',
    ne: 'तपाईंको स्थान प्रमाणीकरण हुन सकेन। कृपया जडान जाँचेर पुनः प्रयास गर्नुहोस्।',
  },
};

function StatCard({ icon: Icon, value, labelNe, labelEn, delay }) {
  const [display, setDisplay] = useState(0);
  const target = typeof value === 'number' ? value : 0;
  const isNumeric = typeof value === 'number';
  useEffect(() => {
    if (!isNumeric) return;
    let raf;
    const start = performance.now();
    const dur = 1200;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    const t0 = setTimeout(() => { raf = requestAnimationFrame(tick); }, delay);
    return () => { clearTimeout(t0); cancelAnimationFrame(raf); };
  }, [target, isNumeric, delay]);
  return (
    <div className="bg-white/95 backdrop-blur rounded-xl border border-white/40 shadow-xl px-5 py-4 flex items-center gap-4 min-w-[190px]">
      <div className="w-11 h-11 rounded-lg bg-gov-blue-800 flex items-center justify-center shrink-0 shadow">
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <div className="text-2xl font-extrabold text-gov-blue-900 tabular-nums leading-none">
          {isNumeric ? formatNumber(display) : value}
        </div>
        <div className="text-xs font-semibold text-slate-600 font-nepali mt-1">{labelNe}</div>
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">{labelEn}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Landing page                                                         */
/* ------------------------------------------------------------------ */

function LandingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [stats, setStats] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkStep, setCheckStep] = useState('');
  const [denied, setDenied] = useState(null);
  const videoRef = useRef(null);

  // Surface "denied" state when redirected back from the map gate
  useEffect(() => {
    if (searchParams.get('denied') === '1') {
      setDenied({
        reason: 'outside_nepal',
        message: null,
        viaRedirect: true,
      });
    }
  }, [searchParams]);

  // Dynamic landing metadata — loaded live from the GIS database
  useEffect(() => {
    let alive = true;
    geoportalAPI.getLandingStats()
      .then((res) => { if (alive) setStats(res.data); })
      .catch(() => { if (alive) setStats(null); });
    return () => { alive = false; };
  }, []);

  const handleEnter = async () => {
    setChecking(true);
    setDenied(null);
    try {
      setCheckStep('ne');
      const payload = await collectGeoSignals();
      await geoAPI.accessCheck(payload);
      router.push('/map');
    } catch (err) {
      const data = err?.response?.data || {};
      setDenied({
        reason: data.reason || 'geoip_unavailable',
        message: data.message || null,
        viaRedirect: false,
      });
      setChecking(false);
      setCheckStep('');
    }
  };

  const deniedCopy = denied ? (DENIED_COPY[denied.reason] || DENIED_COPY.geoip_unavailable) : null;

  return (
    <div className="relative w-full h-full overflow-y-auto overflow-x-hidden bg-gov-blue-950">
      {/* ---- Cinematic video background ---- */}
      <div className="fixed inset-0 z-0">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          src="/geoportal/videos/kmc-intro.mp4"
          poster="/geoportal/videos/kmc-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
        {/* Municipal blue gradient veil — keeps white text readable */}
        <div className="absolute inset-0 bg-gradient-to-b from-gov-blue-950/80 via-gov-blue-900/55 to-gov-blue-950/90" />
        <div className="absolute inset-0 bg-gov-blue-900/20" />
      </div>

      {/* ---- Foreground ---- */}
      <div className="relative z-10 min-h-full flex flex-col">
        {/* Official tricolor ribbon */}
        <div className="gov-tricolor-bar shrink-0" />

        {/* Slim official header */}
        <header className="shrink-0 bg-white/95 backdrop-blur border-b border-white/30 shadow">
          <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <EmblemOfNepal className="w-9 h-9 sm:w-11 sm:h-11 shrink-0" size={44} />
              <MunicipalLogo className="w-9 h-9 sm:w-11 sm:h-11 shrink-0" size={44} />
              <div className="leading-tight min-w-0">
                <div className="text-[10px] sm:text-xs font-semibold text-gov-red-700 font-nepali truncate">
                  काठमाडौँ महानगरपालिका
                </div>
                <div className="text-sm sm:text-base font-bold text-gov-blue-900 font-nepali truncate">
                  एकीकृत खुला भू-स्थानिक पोर्टल
                </div>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              <NepalFlag className="w-6 h-8" />
              <span className="text-[11px] font-bold text-gov-blue-900 uppercase tracking-wider bg-gov-blue-50 px-2.5 py-1 rounded-full border border-gov-blue-200">
                Official GeoPortal
              </span>
            </div>
          </div>
        </header>

        {/* Hero */}
        <main className="flex-1 flex flex-col items-center justify-center text-center px-4 py-10 sm:py-14">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/15 border border-white/30 backdrop-blur text-white text-xs font-semibold mb-5">
            <MapPin className="w-3.5 h-3.5" />
            <span className="font-nepali">काठमाडौँ महानगरपालिका • ३२ वडा</span>
            <span className="opacity-60">|</span>
            <span>Kathmandu Metropolitan City</span>
          </div>

          <h1 className="font-nepali font-extrabold text-white text-3xl sm:text-5xl lg:text-6xl leading-tight drop-shadow-lg max-w-4xl">
            काठमाडौँको <span className="text-sky-300">जियो वर्ल्ड</span>मा
            <br className="hidden sm:block" /> स्वागत छ
          </h1>
          <p className="mt-3 text-sky-100/95 text-base sm:text-xl font-medium max-w-2xl">
            Welcome to the <span className="font-bold text-white">Geo World of KMC</span> —
            the official open geospatial portal of Kathmandu Metropolitan City
          </p>
          <p className="mt-2 text-sky-200/80 text-xs sm:text-sm font-nepali max-w-xl">
            नगरको सम्पूर्ण भौगोलिक तथ्याङ्क — नक्सा, तहहरू, र भू-स्थानिक जानकारी — एउटै खुला पोर्टलमा
          </p>

          {/* Dynamic metadata from the GIS database */}
          <div className="mt-8 flex flex-wrap items-stretch justify-center gap-3 sm:gap-4">
            <StatCard icon={Layers} value={stats?.vector_layers} labelNe="भेक्टर तहहरू" labelEn="Vector layers" delay={0} />
            <StatCard icon={Database} value={stats?.total_features} labelNe="भौगोलिक विशेषताहरू" labelEn="Map features" delay={120} />
            <StatCard icon={MapIcon} value={stats?.raster_packages} labelNe="र्याष्टर प्याकेजहरू" labelEn="Raster packages" delay={240} />
            <StatCard icon={Landmark} value={stats?.wards_covered ?? 32} labelNe="कभर गरिएका वडाहरू" labelEn="Wards covered" delay={360} />
          </div>

          {stats?.categories?.length > 0 && (
            <div className="mt-5 flex flex-wrap justify-center gap-2 max-w-3xl">
              {stats.categories.slice(0, 8).map((c) => (
                <span
                  key={c.name}
                  className="text-[11px] font-semibold text-white bg-white/12 border border-white/25 rounded-full px-3 py-1 backdrop-blur"
                >
                  {c.name} <span className="opacity-70">({c.layers})</span>
                </span>
              ))}
            </div>
          )}

          {/* Denied notice */}
          {denied && deniedCopy && (
            <div className="mt-8 max-w-xl w-full bg-red-50/95 backdrop-blur border-2 border-red-300 rounded-2xl p-5 text-left shadow-2xl">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="font-bold text-red-800 font-nepali">पहुँच अस्वीकृत — Access denied</div>
                  <p className="text-sm text-red-700 mt-1 font-nepali">{deniedCopy.ne}</p>
                  <p className="text-sm text-red-700/80 mt-0.5">{deniedCopy.en}</p>
                  {denied.message && (
                    <p className="text-xs text-red-600/70 mt-1.5 font-mono break-words">{denied.message}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => { setDenied(null); router.replace('/geoportal'); }}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-red-700 bg-white border border-red-300 rounded-lg px-3 py-1.5 hover:bg-red-100"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> पुनः प्रयास गर्नुहोस् / Try again
                    </button>
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-red-600/80 px-1 py-1.5">
                      <WifiOff className="w-3.5 h-3.5" /> VPN / proxy बन्द गर्नुहोस्
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="mt-9">
            <button
              onClick={handleEnter}
              disabled={checking}
              className="group relative inline-flex items-center gap-3 bg-white text-gov-blue-900 font-extrabold text-lg sm:text-xl px-10 sm:px-12 py-4 sm:py-5 rounded-2xl shadow-2xl hover:shadow-sky-300/30 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-80 disabled:cursor-wait overflow-hidden"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-sky-100/0 via-sky-200/60 to-sky-100/0 -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
              {checking ? (
                <Loader2 className="w-6 h-6 animate-spin text-gov-blue-700" />
              ) : (
                <Globe className="w-6 h-6 text-gov-blue-700 group-hover:rotate-12 transition-transform" />
              )}
              <span className="relative">
                {checking
                  ? (checkStep === 'ne' ? 'स्थान प्रमाणीकरण हुँदैछ…' : 'Verifying…')
                  : 'Enter the Geo World of KMC'}
                {!checking && (
                  <span className="block text-xs font-semibold text-gov-blue-600 font-nepali mt-0.5">
                    केएमसीको जियो वर्ल्डमा प्रवेश गर्नुहोस्
                  </span>
                )}
              </span>
              {!checking && <ChevronRight className="w-5 h-5 text-gov-blue-700 group-hover:translate-x-1 transition-transform" />}
            </button>
          </div>
        </main>

        {/* Footer */}
        <footer className="shrink-0 bg-gov-blue-950/85 backdrop-blur border-t border-white/15">
          <div className="max-w-6xl mx-auto px-4 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-2 text-center">
            <div className="text-[11px] text-sky-200/80 font-nepali">
              © काठमाडौँ महानगरपालिका, नगर कार्यपालिकाको कार्यालय • Kathmandu Metropolitan City
            </div>
            <div className="flex items-center gap-3 text-[11px] text-sky-200/70">
              {stats?.last_updated && (
                <span>Updated {new Date(stats.last_updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              )}
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live GIS database
              </span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default function GeoPortalLandingPage() {
  return (
    <Suspense fallback={
      <div className="w-full h-full bg-gov-blue-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    }>
      <LandingInner />
    </Suspense>
  );
}
