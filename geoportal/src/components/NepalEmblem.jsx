'use client';

/**
 * Official Coat of Arms of Nepal (निशान छाप), Municipal Logo & Flag of Nepal Components
 * Uses locally stored official assets matching Field Data Collection.
 */

export function EmblemOfNepal({ className = "w-12 h-12", size = 48 }) {
  return (
    <div className={`relative flex items-center justify-center flex-shrink-0 ${className}`}>
      <img
        src="/geoportal/assets/Nepal.png"
        onError={(e) => { e.currentTarget.src = '/assets/Nepal.png'; }}
        alt="Coat of Arms of Nepal"
        width={size}
        height={size}
        className="w-full h-full object-contain drop-shadow-sm"
        loading="eager"
      />
    </div>
  );
}

export function MunicipalLogo({ className = "w-12 h-12", size = 48 }) {
  return (
    <div className={`relative flex items-center justify-center flex-shrink-0 ${className}`}>
      <img
        src="/geoportal/assets/KMC.png"
        onError={(e) => { e.currentTarget.src = '/assets/KMC.png'; }}
        alt="Kathmandu Metropolitan City Logo"
        width={size}
        height={size}
        className="w-full h-full object-contain drop-shadow-sm"
        loading="eager"
      />
    </div>
  );
}

export function NepalFlag({ className = "w-7 h-9" }) {
  return (
    <div className={`relative flex items-center justify-center flex-shrink-0 ${className}`}>
      <img
        src="/geoportal/assets/Nepal_flag.webp"
        onError={(e) => { e.currentTarget.src = '/assets/Nepal_flag.webp'; }}
        alt="Flag of Nepal"
        className="w-full h-full object-contain drop-shadow-sm nepal-flag-wave"
        loading="eager"
      />
    </div>
  );
}

export default function NepalEmblem(props) {
  return <EmblemOfNepal {...props} />;
}
