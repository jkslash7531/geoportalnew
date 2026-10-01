'use client';

import { useState, useEffect, useCallback } from 'react';
import GeoPortalNavbar from '../components/GeoPortalNavbar';
import GeoPortalMap from '../components/GeoPortalMap';
import LayerCatalogPanel from '../components/LayerCatalogPanel';
import AnalyticsPanel from '../components/AnalyticsPanel';
import MetadataModal from '../components/MetadataModal';
import FeatureInspectorModal from '../components/FeatureInspectorModal';
import AuthModal from '../components/AuthModal';
import LayerAccessModal from '../components/LayerAccessModal';
import { geoportalAPI, authAPI } from '../lib/api';

export default function GeoPortalHomePage() {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  // Active layers state (All layers turned off by default as requested)
  const [activeLayerIds, setActiveLayerIds] = useState(new Set());
  const [layerOpacities, setLayerOpacities] = useState({});
  // Polygon Layer Outlines state (Default ON for polygon vector layers)
  const [layerOutlines, setLayerOutlines] = useState({});
  const [zoomToLayerTrigger, setZoomToLayerTrigger] = useState(null);

  // Basemap state
  const [activeBasemap, setActiveBasemap] = useState('osm');
  const [basemapOpacity, setBasemapOpacity] = useState(100);

  // Collapsible panels state (collapsed by default as requested)
  const [catalogCollapsed, setCatalogCollapsed] = useState(true);
  const [analyticsCollapsed, setAnalyticsCollapsed] = useState(true);
  const [selectedAnalyticsLayerId, setSelectedAnalyticsLayerId] = useState(null);
  const [currentMapExtent, setCurrentMapExtent] = useState(null);

  // Modals
  const [metadataModalLayer, setMetadataModalLayer] = useState(null);
  const [inspectedFeature, setInspectedFeature] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [configuringLayer, setConfiguringLayer] = useState(null);

  // Check current user session on mount
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('kmc_access_token') : null;
    if (token) {
      authAPI.me()
        .then((res) => {
          setUser(res.data);
        })
        .catch(() => {
          if (typeof window !== 'undefined') {
            localStorage.removeItem('kmc_access_token');
          }
          setUser(null);
        });
    }
  }, []);

  // Fetch Catalog respecting current user role & authentication
  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await geoportalAPI.getCatalog();
      setCatalog(res.data);

      // All raster and vector layers are turned off by default
      const defaultActive = new Set();
      const initialOpacities = {};

      res.data.categories?.forEach((cat) => {
        cat.layers.forEach((lyr) => {
          const key = `${lyr.type}_${lyr.id}`;
          initialOpacities[key] = lyr.opacity ?? 1.0;
        });
      });

      // All raster and vector layers are turned off by default
      setActiveLayerIds(defaultActive);
      setLayerOpacities(initialOpacities);
      setSelectedAnalyticsLayerId(null);
    } catch (err) {
      console.error('Error loading GeoPortal catalog:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog, user]);

  // Handle Logout
  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('kmc_access_token');
    }
    setUser(null);
  };

  // Toggle Layer Visibility (Uses unique key `${layer.type}_${layer.id}` to eliminate ID collision)
  const handleToggleLayer = (layer) => {
    const key = `${layer.type}_${layer.id}`;
    setActiveLayerIds((prev) => {
      const next = new Set(prev);
      const isNowActive = !next.has(key);
      if (isNowActive) {
        next.add(key);
        if (layer.type === 'vector') {
          setSelectedAnalyticsLayerId(layer.id);
        }
      } else {
        next.delete(key);
        // If the layer being deactivated was selected for analytics, clear it or pick another active vector layer
        if (selectedAnalyticsLayerId === layer.id) {
          const remainingVector = catalog?.categories
            ?.flatMap((c) => c.layers)
            ?.find((l) => l.type === 'vector' && next.has(`${l.type}_${l.id}`));
          setSelectedAnalyticsLayerId(remainingVector ? remainingVector.id : null);
        }
      }
      return next;
    });
  };

  // Explicitly Select Layer for Analytics (also turns on the layer if off)
  const handleSelectLayerForAnalytics = (layerId) => {
    setSelectedAnalyticsLayerId(layerId);
    const key = `vector_${layerId}`;
    setActiveLayerIds((prev) => {
      if (!prev.has(key)) {
        const next = new Set(prev);
        next.add(key);
        return next;
      }
      return prev;
    });
  };

  // Zoom to layer bounds/extent
  const handleZoomToLayer = (layer) => {
    if (!layer || !layer.bounds) return;
    const key = `${layer.type}_${layer.id}`;
    setActiveLayerIds((prev) => {
      if (!prev.has(key)) {
        const next = new Set(prev);
        next.add(key);
        return next;
      }
      return prev;
    });
    setZoomToLayerTrigger({
      bounds: layer.bounds,
      timestamp: Date.now(),
    });
  };

  // Opacity Change
  const handleOpacityChange = (layerKey, opacity) => {
    setLayerOpacities((prev) => ({
      ...prev,
      [layerKey]: opacity,
    }));
  };

  // Toggle Polygon Layer Outline Mode (Defaults to ON)
  const handleToggleOutline = (layerId) => {
    setLayerOutlines((prev) => {
      const current = prev[layerId] !== undefined ? prev[layerId] : true;
      return {
        ...prev,
        [layerId]: !current,
      };
    });
  };

  const selectedLayerObj = catalog?.categories
    ?.flatMap((c) => c.layers)
    ?.find((l) => l.id === selectedAnalyticsLayerId);

  return (
    <div className="w-full h-full flex flex-col bg-slate-100 overflow-hidden font-sans">
      {/* Public / Authenticated Header */}
      <GeoPortalNavbar
        catalog={catalog}
        loading={loading}
        onRefresh={fetchCatalog}
        catalogCollapsed={catalogCollapsed}
        onToggleCatalog={() => setCatalogCollapsed(!catalogCollapsed)}
        analyticsCollapsed={analyticsCollapsed}
        onToggleAnalytics={() => setAnalyticsCollapsed(!analyticsCollapsed)}
        user={user}
        onOpenLogin={() => setShowAuthModal(true)}
        onLogout={handleLogout}
      />

      {/* Main Workspace Area */}
      <main className="flex-1 relative overflow-hidden">
        {/* Full-bleed OpenLayers Map */}
        <GeoPortalMap
          catalog={catalog}
          activeLayerIds={activeLayerIds}
          layerOpacities={layerOpacities}
          layerOutlines={layerOutlines}
          onExtentChange={setCurrentMapExtent}
          onFeatureClick={setInspectedFeature}
          activeBasemap={activeBasemap}
          basemapOpacity={basemapOpacity}
          zoomToLayerTrigger={zoomToLayerTrigger}
        />

        {/* Floating Top-Right: Layer Catalog (Field Data style panel with Basemaps included) */}
        <aside className="absolute top-4 right-4 z-30 pointer-events-auto flex flex-col items-end">
          <LayerCatalogPanel
            catalog={catalog}
            activeLayerIds={activeLayerIds}
            onToggleLayer={handleToggleLayer}
            onOpacityChange={handleOpacityChange}
            layerOpacities={layerOpacities}
            layerOutlines={layerOutlines}
            onToggleOutline={handleToggleOutline}
            onSelectLayerForAnalytics={handleSelectLayerForAnalytics}
            selectedAnalyticsLayerId={selectedAnalyticsLayerId}
            onZoomToLayer={handleZoomToLayer}
            onOpenMetadata={setMetadataModalLayer}
            onConfigureLayer={(layer) => setConfiguringLayer(layer)}
            isCollapsed={catalogCollapsed}
            onToggleCollapse={() => setCatalogCollapsed(!catalogCollapsed)}
            user={user}
            activeBasemap={activeBasemap}
            onBasemapChange={setActiveBasemap}
            basemapOpacity={basemapOpacity}
            onBasemapOpacityChange={setBasemapOpacity}
          />
        </aside>

        {/* Floating Bottom-Left: Infographics & Analytics (Responsive on all devices) */}
        <aside className="absolute bottom-6 left-4 z-30 pointer-events-auto">
          <AnalyticsPanel
            layerId={selectedAnalyticsLayerId}
            layerName={selectedLayerObj?.name}
            mapExtent={currentMapExtent}
            isCollapsed={analyticsCollapsed}
            onToggleCollapse={() => setAnalyticsCollapsed(!analyticsCollapsed)}
          />
        </aside>

        {/* Feature Inspector Popup (filters properties based on allowed attributes) */}
        <FeatureInspectorModal
          inspectedFeature={inspectedFeature}
          catalog={catalog}
          onClose={() => setInspectedFeature(null)}
        />
      </main>

      {/* Layer Metadata Modal */}
      <MetadataModal
        layer={metadataModalLayer}
        isOpen={!!metadataModalLayer}
        onClose={() => setMetadataModalLayer(null)}
      />

      {/* User Login Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={(loggedUser) => {
          setUser(loggedUser);
          setShowAuthModal(false);
          fetchCatalog();
        }}
      />

      {/* GIS Admin Layer & Attribute Access Management Modal */}
      <LayerAccessModal
        layer={configuringLayer}
        isOpen={!!configuringLayer}
        onClose={() => setConfiguringLayer(null)}
        onSaved={fetchCatalog}
      />
    </div>
  );
}
