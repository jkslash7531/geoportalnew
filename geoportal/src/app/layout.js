import './globals.css';

export const metadata = {
  title: 'काठमाडौँ महानगरपालिका | एकीकृत खुला भू-स्थानिक पोर्टल (KMC Public GeoPortal)',
  description: 'काठमाडौँ महानगरपालिकाको आधिकारिक सार्वजनिक खुला भू-स्थानिक पोर्टल तथा नक्साङ्कन ड्यासबोर्ड',
  keywords: 'KMC, Kathmandu, GeoPortal, GIS, WebGIS, PostGIS, Nepal Open Data, Spatial Infrastructure',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ne">
      <body className="w-full h-full fixed inset-0 overflow-hidden bg-slate-100 text-slate-900 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
