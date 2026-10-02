'use client';

import { useEffect } from 'react';

/**
 * GeoPortalView — Single Source of Truth Redirector
 * All GeoPortal functionality and design is maintained exclusively in /geoportal.
 * This guarantees consistent design, single-source maintenance, and zero code duplication.
 */
export default function GeoPortalView() {
  useEffect(() => {
    window.location.href = '/geoportal';
  }, []);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-white p-6 font-sans">
      <div className="w-10 h-10 border-4 border-gov-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
      <h2 className="text-base font-bold font-nepali mb-1">
        काठमाडौँ महानगरपालिका एकीकृत नगर सूचना प्रणाली तथा खुला भू-स्थानिक पोर्टल
      </h2>
      <p className="text-xs text-slate-400 font-nepali">
        जियोपोर्टलमा लैजाँदैछ (Redirecting to GeoPortal)...
      </p>
    </div>
  );
}
