'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText, Clock, CheckCircle2, AlertCircle, ArrowRight, RefreshCw,
  Search, Filter, MapPin, X, AlertTriangle, Layers, Calendar
} from 'lucide-react';
import { recordsAPI } from '../../lib/api';

const STATUS_CONFIG = {
  DRAFT: { label: 'मस्यौदा (Draft)', color: 'bg-slate-100 text-slate-700 border-slate-300' },
  IN_PROGRESS: { label: 'अधुरो (In Progress)', color: 'bg-amber-100 text-amber-800 border-amber-300' },
  SUBMITTED: { label: 'बुझाइएको (Submitted)', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  UNDER_REVIEW: { label: 'समीक्षामा (Under Review)', color: 'bg-purple-100 text-purple-800 border-purple-300' },
  RETURNED: { label: 'फिर्ता भएको (Returned)', color: 'bg-rose-100 text-rose-800 border-rose-300' },
  APPROVED: { label: 'स्वीकृत (Approved)', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
};

export default function MyRecordsPanel({
  projectId,
  projects = [],
  onSelectProject,
  onResumeRecord,
  onClose,
}) {
  const [selectedProjectId, setSelectedProjectId] = useState(
    projectId || (projects && projects.length > 0 ? projects[0].id : null)
  );
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (projectId) {
      setSelectedProjectId(projectId);
    } else if (!selectedProjectId && projects && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projectId, projects]);

  const loadRecords = useCallback(async () => {
    if (!selectedProjectId) {
      setRecords([]);
      return;
    }
    try {
      setLoading(true);
      const res = await recordsAPI.listMyRecords(selectedProjectId);
      setRecords(res.data || []);
    } catch (err) {
      console.error('Failed to load my records', err);
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // Filter records
  const filteredRecords = records.filter((r) => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchId = r.record_id?.toLowerCase().includes(q);
      const matchAnswers = JSON.stringify(r.answers || {}).toLowerCase().includes(q);
      return matchId || matchAnswers;
    }
    return true;
  });

  const draftAndInProgressCount = records.filter((r) => ['DRAFT', 'IN_PROGRESS', 'RETURNED'].includes(r.status)).length;

  return (
    <div className="flex flex-col h-full bg-slate-50 font-sans select-none overflow-hidden text-slate-800">
      {/* Header */}
      <div className="p-4 bg-gov-blue-900 text-white shadow-md flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-gov-blue-800 rounded-lg text-gov-gold-400">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm font-nepali">
              मेरा सर्वेक्षण रेकर्डहरू (My Records)
            </h3>
            <span className="text-[11px] text-gov-blue-200">
              {draftAndInProgressCount} वटा अधुरो / सुधार्नुपर्ने फारमहरू
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={loadRecords}
            className="p-1.5 text-gov-blue-200 hover:text-white rounded-lg hover:bg-gov-blue-800 transition-colors"
            title="पुनः लोड (Refresh)"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-gov-blue-200 hover:text-white rounded-lg hover:bg-gov-blue-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Project Selector (if multiple or provided) */}
      {projects && projects.length > 0 && (
        <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <label className="text-[11px] font-bold text-slate-600 font-nepali shrink-0">परियोजना:</label>
          <select
            value={selectedProjectId || ''}
            onChange={(e) => {
              const pid = Number(e.target.value);
              setSelectedProjectId(pid);
              if (onSelectProject) {
                const found = projects.find((p) => p.id === pid);
                if (found) onSelectProject(found);
              }
            }}
            className="w-full text-xs py-1 px-2 bg-white border border-slate-300 rounded-md font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-gov-blue-500 font-nepali"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.project_mode === 'ADVANCED_QUESTIONNAIRE' ? '★' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="p-3 bg-white border-b border-slate-200 space-y-2 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="रेकर्ड आइडी वा उत्तर खोज्नुहोस्..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-gov-blue-500 font-nepali"
          />
        </div>

        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none pb-0.5">
          {[
            { id: 'ALL', label: 'सबै (All)' },
            { id: 'IN_PROGRESS', label: 'अधुरो' },
            { id: 'RETURNED', label: 'सुधार्नुपर्ने' },
            { id: 'SUBMITTED', label: 'बुझाइएको' },
            { id: 'APPROVED', label: 'स्वीकृत' },
          ].map((tab) => {
            const isActive = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg whitespace-nowrap transition-colors font-nepali ${
                  isActive
                    ? 'bg-gov-blue-800 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Records List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 scrollbar-thin">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 text-xs font-nepali">
            <RefreshCw className="w-6 h-6 animate-spin mb-2" />
            <span>रेकर्डहरू लोड हुँदैछ...</span>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 text-xs font-nepali">
            <FileText className="w-10 h-10 stroke-[1.2] mb-2" />
            <span>कुनै रेकर्ड फेला परेन।</span>
          </div>
        ) : (
          filteredRecords.map((rec) => {
            const statusMeta = STATUS_CONFIG[rec.status] || STATUS_CONFIG.DRAFT;
            const canResume = ['DRAFT', 'IN_PROGRESS', 'RETURNED'].includes(rec.status);
            const dateStr = rec.last_saved_at ? new Date(rec.last_saved_at).toLocaleDateString('ne-NP') : '';
            const timeStr = rec.last_saved_at ? new Date(rec.last_saved_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

            return (
              <div
                key={rec.id}
                className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-slate-300 transition-all space-y-2"
              >
                {/* Top Row: Record ID + Status Badge */}
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-slate-800">
                    {rec.record_id}
                  </span>
                  <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${statusMeta.color} font-nepali`}>
                    {statusMeta.label}
                  </span>
                </div>

                {/* Return Note from Reviewer (if any) */}
                {rec.status === 'RETURNED' && rec.reviewer_notes && (
                  <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-start gap-1.5 font-nepali">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">समीक्षकको टिप्पणी (Reviewer Note): </span>
                      <span>{rec.reviewer_notes}</span>
                    </div>
                  </div>
                )}

                {/* Progress Bar & Geometry info */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-nepali">
                    <span>पूर्णता (Progress): <strong>{rec.completion_percentage}%</strong></span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{dateStr} {timeStr}</span>
                    </span>
                  </div>

                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        rec.completion_percentage === 100 ? 'bg-emerald-500' : 'bg-gov-blue-600'
                      }`}
                      style={{ width: `${rec.completion_percentage}%` }}
                    />
                  </div>
                </div>

                {/* Bottom Row: Resume Button */}
                <div className="pt-1 flex items-center justify-between border-t border-slate-100 text-xs">
                  <span className="text-[11px] text-slate-500 font-mono">
                    {rec.geometry_type || 'Point'} Feature
                  </span>

                  {canResume && (
                    <button
                      type="button"
                      onClick={() => onResumeRecord && onResumeRecord(rec)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gov-blue-800 hover:bg-gov-blue-700 text-white rounded-lg font-bold text-xs font-nepali shadow-sm transition-colors"
                    >
                      <span>जारी राख्नुहोस् (Resume)</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
