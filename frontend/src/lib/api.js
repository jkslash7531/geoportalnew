'use client';

import axios from 'axios';

/**
 * KMC-GIS-SERVER API Client
 * Axios instance with JWT interceptor and error handling.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ---- Request Interceptor: Attach JWT ----
api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('kmc_access_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ---- Response Interceptor: Handle 401 + Token Refresh ----
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Do not attempt token refresh for login or refresh requests
    const isAuthEndpoint = originalRequest?.url?.includes('/auth/login') ||
                           originalRequest?.url?.includes('/auth/refresh');

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = localStorage.getItem('kmc_refresh_token');
        if (!refreshToken) throw new Error('No refresh token');

        const res = await axios.post(`${API_BASE}/auth/refresh`, {
          refresh_token: refreshToken,
        });

        const { access_token, refresh_token: newRefresh } = res.data;
        localStorage.setItem('kmc_access_token', access_token);
        localStorage.setItem('kmc_refresh_token', newRefresh);

        processQueue(null, access_token);
        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError);
        localStorage.removeItem('kmc_access_token');
        localStorage.removeItem('kmc_refresh_token');
        localStorage.removeItem('kmc_user');
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;

// ---- Auth API ----
export const authAPI = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  refresh: (refresh_token) => api.post('/auth/refresh', { refresh_token }),
  me: () => api.get('/auth/me'),
};

// ---- Users API ----
export const usersAPI = {
  list: () => api.get('/users'),
  get: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
  getProjects: (userId) => api.get(`/users/${userId}/projects`),
};

// ---- Projects API ----
export const projectsAPI = {
  list: () => api.get('/projects'),
  get: (id) => api.get(`/projects/${id}`),
  create: (data) => api.post('/projects', data),
  update: (id, data) => api.put(`/projects/${id}`, data),
  delete: (id) => api.delete(`/projects/${id}`),
  uploadBoundary: (id, formData) =>
    api.post(`/projects/${id}/boundary/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  generateGrid: (id, data) => api.post(`/projects/${id}/generate-grid`, data),
  getAssignments: (id) => api.get(`/projects/${id}/assignments`),
  assignLayer: (id, layerId) => api.post(`/projects/${id}/assign-layer`, { layer_id: layerId }),
  assignTiles: (id, mbtilesId) => api.post(`/projects/${id}/assign-tiles`, { mbtiles_id: mbtilesId }),
  unassignLayer: (id, layerId) => api.delete(`/projects/${id}/unassign-layer/${layerId}`),
  unassignTiles: (id, mbtilesId) => api.delete(`/projects/${id}/unassign-tiles/${mbtilesId}`),
  getCollectors: (id) => api.get(`/projects/${id}/collectors`),
  assignCollectors: (id, userIds) =>
    api.post(`/projects/${id}/collectors`, { user_ids: Array.isArray(userIds) ? userIds : [userIds] }),
  unassignCollector: (id, userId) => api.delete(`/projects/${id}/collectors/${userId}`),
};

// ---- Tasks API ----
export const tasksAPI = {
  list: (projectId, statusFilter, collectorFilter) => {
    const params = {};
    if (statusFilter && statusFilter !== 'ALL') params.status_filter = statusFilter;
    if (collectorFilter && collectorFilter !== 'ALL') params.collector_filter = collectorFilter;
    return api.get(`/projects/${projectId}/tasks`, { params });
  },
  assign: (projectId, taskIds, userId) =>
    api.post(`/projects/${projectId}/tasks/assign`, { task_ids: Array.isArray(taskIds) ? taskIds : [taskIds], user_id: userId }),
  autoDistribute: (projectId, userIds) =>
    api.post(`/projects/${projectId}/tasks/auto-distribute`, { user_ids: userIds }),
  lock: (taskId, data) => api.post(`/tasks/${taskId}/lock`, data || {}),
  unlock: (taskId) => api.post(`/tasks/${taskId}/unlock`),
  submit: (taskId) => api.post(`/tasks/${taskId}/submit`),
  validate: (taskId, action) => api.post(`/tasks/${taskId}/validate?action=${action}`),
  reset: (projectId) => api.delete(`/projects/${projectId}/tasks/reset`),
};

// ---- Layers API ----
export const layersAPI = {
  listGlobal: () => api.get('/layers'),
  listAll: (params = {}) => api.get('/layers', { params: { all_layers: true, ...params } }),
  listProject: (projectId) => api.get(`/projects/${projectId}/layers`),
  get: (id) => api.get(`/layers/${id}`),
  create: (data) => api.post('/layers', data),
  createProject: (projectId, data) => api.post(`/projects/${projectId}/layers`, data),
  update: (id, data) => api.put(`/layers/${id}`, data),
  delete: (id) => api.delete(`/layers/${id}`),
  getDeleted: () => api.get('/layers/deleted'),
  restore: (id) => api.post(`/layers/${id}/restore`),
  permanentDelete: (id) => api.delete(`/layers/${id}/permanent`),
  download: (layerId, format = 'geojson') =>
    api.get(`/layers/${layerId}/download`, {
      params: { format },
      responseType: 'blob',
    }),
  link: (sourceLayerId, data) => api.post(`/layers/${sourceLayerId}/link`, data),
  getRelationships: (layerId) => api.get(`/layers/${layerId}/relationships`),
  getFields: (layerId) => api.get(`/layers/${layerId}/fields`),
  updateFields: (layerId, fields) => api.put(`/layers/${layerId}/fields`, fields),
  getNextId: (layerId, params = {}) => api.get(`/layers/${layerId}/next-id`, { params }),
  upload: (formData, onUploadProgress) => api.post('/layers/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    onUploadProgress,
  }),
  getAuditEdits: (layerId, limit = 100) => api.get(`/layers/${layerId}/audit-edits`, { params: { limit } }),
};

// ---- Features API ----
export const featuresAPI = {
  list: (layerId, bbox) => {
    const params = bbox ? { bbox } : {};
    return api.get(`/layers/${layerId}/features`, { params });
  },
  create: (data) => api.post('/features', data),
  update: (id, data) => api.put(`/features/${id}`, data),
  delete: (id) => api.delete(`/features/${id}`),
  getLinked: (featureId) => api.get(`/features/${featureId}/linked`),
  link: (featureId, data) => api.post(`/features/${featureId}/link`, data),
  unlink: (featureId, params) => api.delete(`/features/${featureId}/link`, { params }),
  split: (featureId, blade) => api.post(`/features/${featureId}/split`, { blade }),
  merge: (layerId, featureIds) => api.post(`/layers/${layerId}/merge`, { feature_ids: featureIds }),
  getExtent: (layerId) => api.get(`/layers/${layerId}/extent`),
};

// ---- Tiles API ----
export const tilesAPI = {
  listGlobal: () => api.get('/tiles'),
  listAll: (params = {}) => api.get('/tiles', { params: { all_tiles: true, ...params } }),
  listProject: (projectId) => api.get(`/projects/${projectId}/tiles`),
  download: (tileId) =>
    api.get(`/tiles/${tileId}/download`, {
      responseType: 'blob',
    }),
  upload: (formData, onUploadProgress) => api.post('/tiles/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    onUploadProgress,
  }),
  uploadProject: (projectId, formData, onUploadProgress) => api.post(`/projects/${projectId}/tiles/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    onUploadProgress,
  }),
  delete: (id) => api.delete(`/tiles/${id}`),
  getDeleted: () => api.get('/tiles/deleted'),
  restore: (id) => api.post(`/tiles/${id}/restore`),
  permanentDelete: (id) => api.delete(`/tiles/${id}/permanent`),
};

// ---- Media API ----
export const mediaAPI = {
  upload: (formData) => api.post('/media/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  get: (id) => api.get(`/media/${id}`),
};

// ---- Resumable Chunked Uploads API (files up to 100 GB) ----
// Splits the file into 32 MB chunks sent as raw bytes, so multi-GB uploads
// never spool a giant temp file server-side and can resume after a drop.
export const uploadsAPI = {
  init: (data) => api.post('/uploads/init', data, { timeout: 30000 }),
  chunk: (uploadId, index, blob, onUploadProgress) =>
    api.post(`/uploads/${uploadId}/chunk`, blob, {
      params: { index },
      headers: { 'Content-Type': 'application/octet-stream' },
      timeout: 0,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      onUploadProgress,
    }),
  complete: (uploadId) => api.post(`/uploads/${uploadId}/complete`, {}, { timeout: 0 }),
  status: (uploadId) => api.get(`/uploads/${uploadId}`),
  abort: (uploadId) => api.delete(`/uploads/${uploadId}`),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Upload a file of any size via the resumable chunked API.
 * @param {File} file
 * @param {object} meta { kind: 'vector'|'raster', name, description?, is_global, project_id?, editable_by_collectors?, allow_snapping? }
 * @param {(p:{phase:string,loaded:number,total:number})=>void} onProgress phase: 'uploading' | 'assembling'
 * @returns the /complete response payload
 */
export async function uploadFileResumable(file, meta, onProgress) {
  const initRes = await uploadsAPI.init({
    filename: file.name,
    total_size: file.size,
    kind: meta.kind,
    name: meta.name,
    description: meta.description,
    is_global: meta.is_global,
    project_id: meta.project_id,
    editable_by_collectors: meta.editable_by_collectors,
    allow_snapping: meta.allow_snapping,
  });
  const { upload_id: uploadId, chunk_size: chunkSize, total_chunks: totalChunks } = initRes.data;

  // Resume support: ask the server which chunks are already there.
  let startIndex = 0;
  try {
    const st = await uploadsAPI.status(uploadId);
    if (st.data && st.data.next_index != null) startIndex = st.data.next_index;
  } catch { /* fresh upload */ }

  let sentBytes = startIndex * chunkSize;
  const report = (loaded) => onProgress && onProgress({ phase: 'uploading', loaded, total: file.size });

  for (let i = startIndex; i < totalChunks; i++) {
    const blob = file.slice(i * chunkSize, Math.min(file.size, (i + 1) * chunkSize));
    const chunkStart = sentBytes;
    let attempt = 0;
    for (;;) {
      try {
        await uploadsAPI.chunk(uploadId, i, blob, (e) => {
          if (e.total || e.loaded) report(chunkStart + (e.loaded || 0));
        });
        break;
      } catch (err) {
        attempt += 1;
        if (attempt >= 4) {
          try { await uploadsAPI.abort(uploadId); } catch { /* ignore */ }
          throw err;
        }
        await sleep(1000 * attempt * attempt); // 1s, 4s, 9s backoff
      }
    }
    sentBytes += blob.size;
    report(sentBytes);
  }

  onProgress && onProgress({ phase: 'assembling', loaded: file.size, total: file.size });
  const doneRes = await uploadsAPI.complete(uploadId);
  return doneRes.data;
}

// ---- Helper: Trigger Browser Blob File Download ----
export const triggerFileDownload = (response, defaultFilename = 'download') => {
  if (!response || !response.data) return;
  const blob = new Blob([response.data], {
    type: response.headers?.['content-type'] || 'application/octet-stream',
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;

  let filename = defaultFilename;
  const disposition = response.headers?.['content-disposition'];
  if (disposition && disposition.includes('filename=')) {
    const match = disposition.match(/filename="?([^";]+)"?/);
    if (match && match[1]) filename = match[1].trim();
  }
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.parentNode.removeChild(link);
  window.URL.revokeObjectURL(url);
};

// ---- Real-Time Tracking API ----
export const trackingAPI = {
  ping: (data) => api.post('/tracking/ping', data),
  setStatus: (data) => api.post('/tracking/status', data),
  sendBeaconStatus: (statusData) => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('kmc_access_token');
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
    const url = `${baseUrl}/tracking/status`;
    const payload = JSON.stringify(statusData);

    // 1. Try fetch with keepalive: true (keeps request alive during unload and supports headers)
    try {
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch (e) {
      // 2. Fallback to navigator.sendBeacon
      try {
        if (navigator.sendBeacon) {
          const blob = new Blob([payload], { type: 'application/json' });
          const beaconUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url;
          navigator.sendBeacon(beaconUrl, blob);
        }
      } catch (err) {}
    }
  },
  getCollectors: (projectId = null, onlineOnly = false) => {
    const params = {};
    if (projectId) params.project_id = projectId;
    if (onlineOnly) params.online_only = true;
    return api.get('/tracking/collectors', { params });
  },
  getCollectorsGeoJSON: (projectId = null) => {
    const params = {};
    if (projectId) params.project_id = projectId;
    return api.get('/tracking/collectors/geojson', { params });
  },
  getHistory: (userId, limit = 200) =>
    api.get(`/tracking/collectors/${userId}/history`, { params: { limit } }),
  getAdminEvents: (params = {}) => api.get('/tracking/admin/logs/events', { params }),
  getAdminRoutes: (params = {}) => api.get('/tracking/admin/logs/collector-routes', { params }),
  downloadAdminLogs: () =>
    api.get('/tracking/admin/logs/download', {
      responseType: 'blob',
    }),
};

// ---- GeoPortal API ----
export const geoportalAPI = {
  getCatalog: () => api.get('/geoportal/catalog'),
  getFeatureDetail: (layerId, featureId) => api.get(`/geoportal/layers/${layerId}/features/${featureId}`),
  updateLayerConfig: (layerId, data) => api.put(`/geoportal/layers/${layerId}/config`, data),
  updateMBTilesConfig: (mbtilesId, data) => api.put(`/geoportal/mbtiles/${mbtilesId}/config`, data),
  exportLayer: (layerId, format = 'geojson', bbox = null) => {
    const params = { format };
    if (bbox) params.bbox = bbox;
    return api.post(`/geoportal/export/${layerId}`, null, {
      params,
      responseType: format === 'csv' ? 'blob' : 'json',
    });
  },
};

// ---- GIS Analytics & Infographics API ----
export const analyticsAPI = {
  getLayerAnalytics: (layerId, bbox = null, ward = null) => {
    const params = {};
    if (bbox) params.bbox = bbox;
    if (ward) params.ward = ward;
    return api.get(`/analytics/layer/${layerId}`, { params });
  },
};

// ---- House Numbering API ----
export const houseNumberingAPI = {
  getStats: () => api.get('/house-numbering/stats'),
  listNumbers: (params = {}) => api.get('/house-numbering/numbers', { params }),
  generateNumbers: (data) => api.post('/house-numbering/generate', data),
  updateNumber: (id, data) => api.put(`/house-numbering/numbers/${id}`, data),
  deleteNumber: (id) => api.delete(`/house-numbering/numbers/${id}`),
  exportRegistry: (format = 'csv', params = {}) =>
    api.get('/house-numbering/export', {
      params: { format, ...params },
      responseType: format === 'csv' ? 'blob' : 'json',
    }),
};

// ---- Platform Modules API ----
export const modulesAPI = {
  list: () => api.get('/modules'),
  update: (id, data) => api.put(`/modules/${id}`, data),
};

// ---- Advanced Questionnaire API ----
export const questionnairesAPI = {
  listByProject: (projectId) => api.get(`/projects/${projectId}/questionnaires`),
  getActive: (projectId) => api.get(`/projects/${projectId}/questionnaires/active`),
  getById: (id) => api.get(`/questionnaires/${id}`),
  createDraft: (projectId, data) => api.post(`/projects/${projectId}/questionnaires`, data),
  updateDraft: (id, data) => api.put(`/questionnaires/${id}`, data),
  validateSchema: (id) => api.post(`/questionnaires/${id}/validate`),
  publish: (id, data = {}) => api.post(`/questionnaires/${id}/publish`, data),
  duplicate: (id) => api.post(`/questionnaires/${id}/duplicate`),
};

// ---- Field Records API ----
export const recordsAPI = {
  saveDraft: (projectId, data) => api.post(`/projects/${projectId}/records/draft`, data),
  submit: (projectId, data) => api.post(`/projects/${projectId}/records/submit`, data),
  listMyRecords: (projectId, status = null) => {
    const params = {};
    if (status) params.status_filter = status;
    return api.get(`/projects/${projectId}/records/my`, { params });
  },
  listAllRecords: (projectId, params = {}) => api.get(`/projects/${projectId}/records`, { params }),
  getById: (id) => api.get(`/records/${id}`),
  review: (id, data) => api.put(`/records/${id}/review`, data),
  exportGeoJSON: (projectId, status = null) => {
    const params = {};
    if (status) params.status_filter = status;
    return api.get(`/projects/${projectId}/records/export`, { params });
  },
};



