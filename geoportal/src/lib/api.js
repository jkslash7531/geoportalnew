import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach token if user was previously logged in on the same domain
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('kmc_access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

export const authAPI = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  me: () => api.get('/auth/me'),
};

export const geoportalAPI = {
  getCatalog: () => api.get('/geoportal/catalog'),
  getLandingStats: () => api.get('/geoportal/landing-stats'),
  getFeatureDetail: (layerId, featureId) => api.get(`/geoportal/layers/${layerId}/features/${featureId}`),
  exportLayer: (layerId, format = 'geojson', bbox = null) => {
    const params = { format };
    if (bbox) params.bbox = bbox;
    return api.post(`/geoportal/export/${layerId}`, null, {
      params,
      responseType: format === 'csv' ? 'blob' : 'json',
    });
  },
  updateLayerConfig: (layerId, data) => api.put(`/geoportal/layers/${layerId}/config`, data),
  updateMBTilesConfig: (mbtilesId, data) => api.put(`/geoportal/mbtiles/${mbtilesId}/config`, data),
};

export const analyticsAPI = {
  getLayerAnalytics: (layerId, bbox = null, ward = null) => {
    const params = {};
    if (bbox) params.bbox = bbox;
    if (ward) params.ward = ward;
    return api.get(`/analytics/layer/${layerId}`, { params });
  },
};

export const houseNumberingAPI = {
  getStats: () => api.get('/house-numbering/stats'),
  listNumbers: (params = {}) => api.get('/house-numbering/numbers', { params }),
};

/**
 * Geo World entry gate — Nepal-only access verification.
 * accessCheck runs the server-side Nepal / VPN evaluation and issues the
 * HttpOnly geo-pass cookie on success. verify re-checks the cookie.
 */
export const geoAPI = {
  accessCheck: (payload) => api.post('/geo/access-check', payload || {}),
  verify: () => api.get('/geo/verify'),
};

export default api;
