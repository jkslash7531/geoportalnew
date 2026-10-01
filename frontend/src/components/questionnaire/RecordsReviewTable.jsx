'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText, CheckCircle2, AlertTriangle, RefreshCw, Download, Search,
  Eye, Check, X, ShieldCheck, Clock, User, Layers, MapPin
} from 'lucide-react';
import { recordsAPI } from '../../lib/api';

const STATUS_BADGES = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-300',
  IN_PROGRESS: 'bg-amber-100 text-amber-800 border-amber-300',
  SUBMITTED: 'bg-blue-100 text-blue-800 border-blue-300',
  UNDER_REVIEW: 'bg-purple-100 text-purple-800 border-purple-300',
  RETURNED: 'bg-rose-100 text-rose-800 border-rose-300',
  APPROVED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
};

export default function RecordsReviewTable({
  projectId,
  onZoomToRecord,
}) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  // Selected record for full inspection & review modal
  const [inspectingRecord, setInspectingRecord] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  const loadRecords = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const res = await recordsAPI.listAllRecords(projectId);
      setRecords(res.data || []);
    } catch (err) {
      console.error('Failed to load project records', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // Handle Review action (APPROVED or RETURNED)
  const handleReviewAction = async (status) => {
    if (!inspectingRecord) return;
    try {
      setSubmittingReview(true);
      await recordsAPI.review(inspectingRecord.id, {
        status,
        reviewer_notes: reviewNotes,
      });
      alert(`रेकर्ड सफलतापूर्वक ${status === 'APPROVED' ? 'स्वीकृत' : 'फिर्ता'} गरियो।`);
      setInspectingRecord(null);
      setReviewNotes('');
      await loadRecords();
    } catch (err) {
      console.error('Failed to review record', err);
      alert('समीक्षा सुरक्षित गर्न सकिएन।');
    } finally {
      setSubmittingReview(false);
    }
  };

  // Export GeoJSON
  const handleExportGeoJSON = async () => {
    try {
      const res = await recordsAPI.exportGeoJSON(projectId);
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(res.data, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `kmc_records_project_${projectId}.geojson`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (err) {
      console.error('Failed to export GeoJSON', err);
      alert('GeoJSON निर्यात गर्न सकिएन।');
    }
  };

  const filtered = records.filter((r) => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchId = r.record_id?.toLowerCase().includes(q);
      const matchCol = r.collector_name?.toLowerCase().includes(q);
      const matchAns = JSON.stringify(r.answers || {}).toLowerCase().includes(q);
      return matchId || matchCol || matchAns;
    }
    return true;
  });

  return (
    <div className="space-y-3 font-sans select-none text-slate-800">
      {/* Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 flex-1 max-w-sm">
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="रेकर्ड वा गणक खोज्नुहोस्..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-gov-blue-500 font-nepali"
            />
          </div>
        </div>

        {/* Filter Pills & Actions */}
        <div className="flex items-center gap-1.5">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-nepali"
          >
            <option value="ALL">सबै स्थिति (All Status)</option>
            <option value="SUBMITTED">बुझाइएका (Submitted)</option>
            <option value="UNDER_REVIEW">समीक्षामा (Under Review)</option>
            <option value="APPROVED">स्वीकृत (Approved)</option>
            <option value="RETURNED">फिर्ता भएका (Returned)</option>
            <option value="IN_PROGRESS">अधुरो (In Progress)</option>
          </select>

          <button
            type="button"
            onClick={loadRecords}
            className="p-1.5 text-slate-500 hover:text-slate-800 border rounded-lg hover:bg-slate-50"
            title="पुनः लोड"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={handleExportGeoJSON}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gov-blue-800 hover:bg-gov-blue-700 text-white rounded-lg text-xs font-bold font-nepali transition-colors shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>GeoJSON निर्यात</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold font-nepali">
                <th className="py-2.5 px-3">रेकर्ड आइडी (Record ID)</th>
                <th className="py-2.5 px-3">गणक (Collector)</th>
                <th className="py-2.5 px-3">स्थिति (Status)</th>
                <th className="py-2.5 px-3">पूर्णता (%)</th>
                <th className="py-2.5 px-3">फिचर प्रकार</th>
                <th className="py-2.5 px-3">समय (Timestamp)</th>
                <th className="py-2.5 px-3 text-right">कार्य (Actions)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 font-nepali">
                    लोड हुँदैछ...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 font-nepali">
                    कुनै रेकर्ड फेला परेन।
                  </td>
                </tr>
              ) : (
                filtered.map((rec) => {
                  const badgeClass = STATUS_BADGES[rec.status] || STATUS_BADGES.DRAFT;
                  const dateStr = rec.submitted_at || rec.last_saved_at;
                  return (
                    <tr key={rec.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-800">
                        {rec.record_id}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">
                        {rec.collector_name || `User #${rec.collector_id}`}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${badgeClass} uppercase`}>
                          {rec.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-700">
                        {rec.completion_percentage}%
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 capitalize">
                        {rec.geometry_type || 'Point'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                        {dateStr ? new Date(dateStr).toLocaleString('ne-NP') : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setInspectingRecord(rec)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-gov-blue-50 text-gov-blue-800 hover:bg-gov-blue-100 rounded text-xs font-bold font-nepali transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>समीक्षा (Inspect)</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Full Inspection & QA Modal */}
      {inspectingRecord && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="px-5 py-3.5 bg-gov-blue-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-gov-gold-400" />
                <h3 className="font-bold text-sm font-nepali">
                  रेकर्ड समीक्षा तथा प्रमाणीकरण (Record QA Review)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectingRecord(null)}
                className="p-1 text-gov-blue-200 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-500 block text-[10px]">रेकर्ड आइडी (Record ID):</span>
                  <span className="font-mono font-bold text-slate-800">{inspectingRecord.record_id}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">गणक (Data Collector):</span>
                  <span className="font-bold text-slate-800">{inspectingRecord.collector_name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">प्रश्नावली संस्करण:</span>
                  <span className="font-mono text-slate-700">{inspectingRecord.questionnaire_version}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">फिचर आइडी (PostGIS Feature ID):</span>
                  <span className="font-mono text-slate-700">{inspectingRecord.feature_id ? `#${inspectingRecord.feature_id}` : 'None'}</span>
                </div>
              </div>

              {/* Answers Grid */}
              <div className="space-y-2">
                <h4 className="font-bold text-xs text-slate-800 uppercase tracking-wider font-nepali">
                  संकलित उत्तरहरू (Collected Answers)
                </h4>
                <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-2 max-h-60 overflow-y-auto scrollbar-thin text-xs">
                  {Object.entries(inspectingRecord.answers || {}).map(([key, val]) => (
                    <div key={key} className="flex items-start justify-between py-1 border-b border-slate-100 last:border-none">
                      <span className="font-mono text-slate-600 font-semibold">{key}</span>
                      <span className="font-bold text-slate-900 text-right max-w-xs break-words">
                        {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Reviewer Note Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 font-nepali">
                  समीक्षकको टिप्पणी / सुधार निर्देशन (Reviewer Notes / Feedback)
                </label>
                <textarea
                  rows={2}
                  placeholder="यदि कुनै विवरण सच्याउनु परेमा गणकका लागि निर्देशन लेख्नुहोस्..."
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-gov-blue-500 font-nepali"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setInspectingRecord(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-bold font-nepali"
              >
                रद्द गर्नुहोस्
              </button>

              <button
                type="button"
                disabled={submittingReview}
                onClick={() => handleReviewAction('RETURNED')}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold font-nepali shadow-sm"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>फिर्ता पठाउनुहोस् (Return for Correction)</span>
              </button>

              <button
                type="button"
                disabled={submittingReview}
                onClick={() => handleReviewAction('APPROVED')}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold font-nepali shadow-md"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>स्वीकृत गर्नुहोस् (Approve Record)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
