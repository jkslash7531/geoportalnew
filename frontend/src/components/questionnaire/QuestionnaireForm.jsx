'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Save, CheckCircle2, ChevronRight, ChevronLeft, ChevronDown, ChevronUp,
  AlertCircle, AlertTriangle, Check, X, Camera, MapPin, Plus, Trash2,
  Search, Globe, Clock, FileText, Layers, Hash, Calendar, Percent,
  HelpCircle, RefreshCw, PenTool, Image, Eye, Cloud
} from 'lucide-react';
import { recordsAPI } from '../../lib/api';
import { evaluateQuestionVisibility } from '../../lib/questionnaireUtils';

export default function QuestionnaireForm({
  projectId,
  questionnaire,
  geometry,
  geometryType = 'POINT',
  initialRecord = null,
  onSaved,
  onSubmitSuccess,
  onCancel,
  currentGps = null,
}) {
  const schemaDef = questionnaire?.schema_definition || {};
  const sections = useMemo(() => schemaDef.sections || [], [schemaDef]);
  const questions = useMemo(() => schemaDef.questions || [], [schemaDef]);
  const settings = useMemo(() => schemaDef.settings || {}, [schemaDef]);

  // Active language: 'ne' (Nepali Unicode) | 'en' (English)
  const [lang, setLang] = useState('ne');

  // Active section index
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);

  // Form State: answers, repeats, calculated values, media
  const [answers, setAnswers] = useState(initialRecord?.answers || {});
  const [repeatData, setRepeatData] = useState(initialRecord?.repeat_data || {});
  const [calculatedValues, setCalculatedValues] = useState(initialRecord?.calculated_values || {});
  const [mediaRefs, setMediaRefs] = useState(initialRecord?.media_refs || []);
  const [recordId, setRecordId] = useState(initialRecord?.record_id || null);

  // Saving / Sync State
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'saving' | 'unsaved' | 'error'
  const [lastSavedTime, setLastSavedTime] = useState(initialRecord?.last_saved_at ? new Date(initialRecord.last_saved_at) : null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [searchQuery, setSearchQuery] = useState('');

  // Signature drawing state
  const [activeSignatureQId, setActiveSignatureQId] = useState(null);
  const sigCanvasRef = useRef(null);
  const [isDrawingSig, setIsDrawingSig] = useState(false);

  // Mark unsaved on answer change
  const handleAnswerChange = (qName, value) => {
    setAnswers((prev) => ({ ...prev, [qName]: value }));
    setSaveStatus('unsaved');
    if (validationErrors[qName]) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[qName];
        return next;
      });
    }
  };

  // Real-time calculation engine
  useEffect(() => {
    const calculatedQs = questions.filter((q) => q.type === 'calculated' && q.calculation?.formula);
    if (calculatedQs.length === 0) return;

    const newCalculated = { ...calculatedValues };
    let hasChanges = false;

    for (const q of calculatedQs) {
      try {
        let formula = q.calculation.formula;
        // Replace question keys with current answer values
        for (const [key, val] of Object.entries(answers)) {
          if (val !== undefined && val !== null && val !== '') {
            const num = Number(val);
            if (!isNaN(num)) {
              formula = formula.replaceAll(key, String(num));
            }
          }
        }
        // Safely evaluate simple math expressions
        if (/^[\d\s+\-*/().]+$/.test(formula)) {
          // eslint-disable-next-line no-eval
          const result = Function(`"use strict"; return (${formula})`)();
          if (!isNaN(result) && isFinite(result)) {
            const rounded = Math.round(result * 100) / 100;
            if (newCalculated[q.name] !== rounded) {
              newCalculated[q.name] = rounded;
              hasChanges = true;
            }
          }
        }
      } catch (e) {
        // Calculation error ignored
      }
    }

    if (hasChanges) {
      setCalculatedValues(newCalculated);
    }
  }, [answers, questions, calculatedValues]);

  // Evaluate Skip Logic visibility for a question
  const isQuestionVisible = useCallback((q) => {
    return evaluateQuestionVisibility(q, answers);
  }, [answers]);

  // Overall Completion Calculation
  const { completionPercentage, answeredCount, totalRequiredCount, incompleteSectionIndices } = useMemo(() => {
    const requiredQs = questions.filter((q) => q.required && isQuestionVisible(q));
    const totalReq = requiredQs.length;
    let answered = 0;
    const incompleteSecs = new Set();

    for (const q of questions) {
      if (!isQuestionVisible(q)) continue;
      const val = answers[q.name];
      const isAnswered = val !== undefined && val !== null && val !== '' && !(Array.isArray(val) && val.length === 0);

      if (q.required) {
        if (isAnswered) {
          answered++;
        } else {
          const sIdx = sections.findIndex((s) => s.id === q.section_id);
          if (sIdx !== -1) incompleteSecs.add(sIdx);
        }
      }
    }

    const pct = totalReq > 0 ? Math.round((answered / totalReq) * 100) : (Object.keys(answers).length > 0 ? 100 : 0);
    return {
      completionPercentage: pct,
      answeredCount: answered,
      totalRequiredCount: totalReq,
      incompleteSectionIndices: Array.from(incompleteSecs),
    };
  }, [questions, answers, isQuestionVisible, sections]);

  // Autosave Timer
  useEffect(() => {
    const intervalSec = settings.autosave_seconds || 30;
    if (intervalSec <= 0) return;

    const timer = setInterval(() => {
      if (saveStatus === 'unsaved') {
        handleSaveDraft(true); // silent autosave
      }
    }, intervalSec * 1000);

    return () => clearInterval(timer);
  }, [saveStatus, answers, repeatData, calculatedValues, mediaRefs, recordId]);

  // Save Draft Handler
  const handleSaveDraft = async (isAutosave = false) => {
    try {
      setSaveStatus('saving');
      const payload = {
        record_id: recordId,
        questionnaire_id: questionnaire.id,
        geom_geojson: geometry || null,
        geometry_type: geometryType,
        answers,
        repeat_data: repeatData,
        calculated_values: calculatedValues,
        media_refs: mediaRefs,
        completion_percentage: completionPercentage,
        status: completionPercentage > 0 ? 'IN_PROGRESS' : 'DRAFT',
      };

      const res = await recordsAPI.saveDraft(projectId, payload);
      setRecordId(res.data.record_id);
      setSaveStatus('saved');
      setLastSavedTime(new Date());

      if (onSaved) onSaved(res.data, isAutosave);
    } catch (err) {
      console.error('Failed to save draft', err);
      setSaveStatus('error');
    }
  };

  // Submit Handler
  const handleSubmit = async () => {
    // Validate required questions
    const errors = {};
    for (const q of questions) {
      if (!isQuestionVisible(q)) continue;
      if (q.required) {
        const val = answers[q.name];
        if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
          errors[q.name] = `${lang === 'ne' ? q.label_ne || q.label : q.label} भर्न अनिवार्य छ।`;
        }
      }
      // Numeric limit validation
      if (q.validation && q.type === 'number') {
        const num = Number(answers[q.name]);
        if (!isNaN(num)) {
          if (q.validation.min !== undefined && num < q.validation.min) {
            errors[q.name] = `न्यूनतम मान ${q.validation.min} हुनुपर्छ।`;
          }
          if (q.validation.max !== undefined && num > q.validation.max) {
            errors[q.name] = `अधिकतम मान ${q.validation.max} भन्दा बढी हुन सक्दैन।`;
          }
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      // Jump to first section with error
      const firstErrorQ = questions.find((q) => errors[q.name]);
      if (firstErrorQ) {
        const secIdx = sections.findIndex((s) => s.id === firstErrorQ.section_id);
        if (secIdx !== -1) setActiveSectionIndex(secIdx);
      }
      alert('कृपया सबै अनिवार्य प्रश्नहरू पूरा गर्नुहोस् (Please complete all required fields).');
      return;
    }

    try {
      setIsSubmitting(true);
      const payload = {
        record_id: recordId,
        questionnaire_id: questionnaire.id,
        geom_geojson: geometry || null,
        geometry_type: geometryType,
        answers,
        repeat_data: repeatData,
        calculated_values: calculatedValues,
        media_refs: mediaRefs,
        completion_percentage: 100.0,
      };

      const res = await recordsAPI.submit(projectId, payload);
      setSaveStatus('saved');
      if (onSubmitSuccess) onSubmitSuccess(res.data);
    } catch (err) {
      console.error('Failed to submit questionnaire', err);
      alert(err.response?.data?.detail || 'सर्वेक्षण बुझाउन सकिएन।');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Active section data
  const currentSection = sections[activeSectionIndex] || sections[0];
  const sectionQuestions = useMemo(() => {
    let list = questions.filter((q) => q.section_id === currentSection?.id);
    if (searchQuery.trim()) {
      const qLower = searchQuery.toLowerCase();
      list = list.filter(
        (q) =>
          (q.label && q.label.toLowerCase().includes(qLower)) ||
          (q.label_ne && q.label_ne.includes(qLower)) ||
          (q.name && q.name.toLowerCase().includes(qLower))
      );
    }
    return list;
  }, [questions, currentSection, searchQuery]);

  // Repeat Group Helpers
  const handleAddRepeatRow = (qName) => {
    const existing = repeatData[qName] || [];
    setRepeatData({
      ...repeatData,
      [qName]: [...existing, {}],
    });
    setSaveStatus('unsaved');
  };

  const handleRemoveRepeatRow = (qName, index) => {
    const existing = repeatData[qName] || [];
    setRepeatData({
      ...repeatData,
      [qName]: existing.filter((_, i) => i !== index),
    });
    setSaveStatus('unsaved');
  };

  const handleUpdateRepeatField = (qName, rowIndex, fieldKey, val) => {
    const existing = [...(repeatData[qName] || [])];
    if (!existing[rowIndex]) existing[rowIndex] = {};
    existing[rowIndex][fieldKey] = val;
    setRepeatData({
      ...repeatData,
      [qName]: existing,
    });
    setSaveStatus('unsaved');
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 font-sans select-none overflow-hidden relative">
      {/* Top Header Bar */}
      <div className="px-4 py-3 bg-gov-blue-900 text-white shadow-md flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gov-blue-800 flex items-center justify-center text-gov-gold-400 shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-sm truncate font-nepali">
              {lang === 'ne' ? questionnaire.title : (questionnaire.title_en || questionnaire.title)}
            </h3>
            <div className="flex items-center gap-2 text-[10px] text-gov-blue-200">
              <span>{questionnaire.version}</span>
              <span>•</span>
              <span className="font-mono text-[9px]">{recordId || 'New Draft'}</span>
              <span>•</span>
              <span className="capitalize">{geometryType} Feature</span>
            </div>
          </div>
        </div>

        {/* Header Controls: Language + Autosave Status */}
        <div className="flex items-center gap-2">
          {/* Save Status Pill */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-gov-blue-950/60 rounded-full text-[11px] border border-gov-blue-800">
            {saveStatus === 'saving' && (
              <>
                <RefreshCw className="w-3 h-3 animate-spin text-gov-gold-400" />
                <span className="text-gov-gold-300">सुरक्षित हुँदैछ...</span>
              </>
            )}
            {saveStatus === 'saved' && (
              <>
                <Cloud className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-300">
                  {lastSavedTime ? `${lastSavedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} मा सुरक्षित` : 'सुरक्षित'}
                </span>
              </>
            )}
            {saveStatus === 'unsaved' && (
              <>
                <AlertCircle className="w-3 h-3 text-amber-400" />
                <span className="text-amber-300">असुरक्षित परिवर्तन</span>
              </>
            )}
          </div>

          {/* Bilingual Switcher */}
          <button
            type="button"
            onClick={() => setLang(lang === 'ne' ? 'en' : 'ne')}
            className="flex items-center gap-1 px-2.5 py-1 bg-gov-blue-800 hover:bg-gov-blue-700 text-white rounded-lg text-xs font-bold transition-colors border border-gov-blue-700"
            title="भाषा परिवर्तन गर्नुहोस् (Switch Language)"
          >
            <Globe className="w-3 h-3 text-gov-gold-400" />
            <span>{lang === 'ne' ? 'नेपाली' : 'EN'}</span>
          </button>

          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="p-1 text-gov-blue-200 hover:text-white rounded-lg"
              title="बन्द गर्नुहोस्"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar & Jump Bar */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 shrink-0">
        <div className="flex items-center justify-between text-xs mb-1.5 font-nepali">
          <span className="font-bold text-slate-700">
            फारम पूर्णता (Progress): <span className="text-gov-blue-800">{completionPercentage}%</span>
          </span>
          <span className="text-[11px] text-slate-500">
            {answeredCount} / {totalRequiredCount} अनिवार्य प्रश्नहरू भरिए
          </span>
        </div>

        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-gov-blue-700 to-emerald-500 transition-all duration-300 rounded-full"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>

        {/* Section Pill Carousel */}
        <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto scrollbar-none pb-1">
          {sections.map((sec, idx) => {
            const isActive = idx === activeSectionIndex;
            const isIncomplete = incompleteSectionIndices.includes(idx);
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSectionIndex(idx)}
                className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-all font-nepali ${
                  isActive
                    ? 'bg-gov-blue-800 text-white shadow-sm'
                    : isIncomplete
                    ? 'bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span>{idx + 1}.</span>
                <span>{lang === 'ne' ? sec.title_ne || sec.title : sec.title}</span>
                {isIncomplete && !isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Section Content Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 scrollbar-thin">
        {/* Section Header */}
        <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <h4 className="font-bold text-sm text-slate-800 font-nepali">
              {lang === 'ne' ? currentSection?.title_ne || currentSection?.title : currentSection?.title}
            </h4>
            {currentSection?.description && (
              <p className="text-xs text-slate-500 mt-0.5 font-nepali">{currentSection.description}</p>
            )}
          </div>
          <span className="text-xs px-2 py-0.5 bg-slate-100 rounded text-slate-600 font-bold">
            खण्ड {activeSectionIndex + 1} / {sections.length}
          </span>
        </div>

        {/* Questions in Section */}
        {sectionQuestions.map((q) => {
          if (!isQuestionVisible(q)) return null;

          const labelText = lang === 'ne' ? q.label_ne || q.label : q.label;
          const helpText = lang === 'ne' ? q.help_text_ne || q.help_text : q.help_text;
          const errorMsg = validationErrors[q.name];

          return (
            <div
              key={q.id}
              className={`p-4 bg-white rounded-xl border transition-all ${
                errorMsg ? 'border-rose-300 bg-rose-50/20 shadow-sm' : 'border-slate-200 shadow-sm'
              }`}
            >
              {/* Question Label */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <label className="block text-xs font-bold text-slate-800 font-nepali leading-relaxed">
                  {labelText}
                  {q.required && <span className="text-rose-600 ml-1 font-bold">*</span>}
                </label>
                {q.type === 'calculated' && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-800 font-bold rounded">
                    स्वतः गणना (Auto)
                  </span>
                )}
              </div>

              {helpText && (
                <p className="text-[11px] text-slate-500 mb-2 font-nepali">{helpText}</p>
              )}

              {/* Universal Question Type Renderers */}
              {/* 1. Text & Unicode Input */}
              {['text', 'nepali_text', 'phone', 'email'].includes(q.type) && (
                <input
                  type={q.type === 'email' ? 'email' : q.type === 'phone' ? 'tel' : 'text'}
                  value={answers[q.name] ?? ''}
                  onChange={(e) => handleAnswerChange(q.name, e.target.value)}
                  placeholder={lang === 'ne' ? 'यहाँ लेख्नुहोस्...' : 'Type answer here...'}
                  className={`w-full text-xs px-3 py-2 rounded-lg border focus:outline-none focus:ring-1 ${
                    errorMsg ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-300 focus:ring-gov-blue-500'
                  } ${q.type === 'nepali_text' ? 'font-nepali' : ''}`}
                />
              )}

              {/* 2. Long Text / Textarea */}
              {q.type === 'textarea' && (
                <textarea
                  rows={3}
                  value={answers[q.name] ?? ''}
                  onChange={(e) => handleAnswerChange(q.name, e.target.value)}
                  placeholder={lang === 'ne' ? 'विस्तृत विवरण लेख्नुहोस्...' : 'Detailed description...'}
                  className={`w-full text-xs px-3 py-2 rounded-lg border focus:outline-none focus:ring-1 ${
                    errorMsg ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-300 focus:ring-gov-blue-500'
                  } font-nepali`}
                />
              )}

              {/* 3. Number, Decimal, Currency */}
              {['number', 'decimal', 'currency'].includes(q.type) && (
                <div className="relative">
                  {q.type === 'currency' && (
                    <span className="absolute left-3 top-2 text-xs font-bold text-slate-500 font-nepali">
                      रू
                    </span>
                  )}
                  <input
                    type="number"
                    step={q.type === 'decimal' ? '0.01' : '1'}
                    value={answers[q.name] ?? ''}
                    onChange={(e) => handleAnswerChange(q.name, e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="0"
                    className={`w-full text-xs px-3 py-2 rounded-lg border focus:outline-none focus:ring-1 ${
                      q.type === 'currency' ? 'pl-8' : ''
                    } ${errorMsg ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-300 focus:ring-gov-blue-500'}`}
                  />
                </div>
              )}

              {/* 4. Single Choice / Radio */}
              {q.type === 'single_choice' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {(q.options || []).map((opt) => {
                    const isSelected = answers[q.name] === opt.value;
                    const optLabel = lang === 'ne' ? opt.label_ne || opt.label : opt.label;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleAnswerChange(q.name, opt.value)}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-xs transition-all font-nepali ${
                          isSelected
                            ? 'bg-gov-blue-50 border-gov-blue-600 text-gov-blue-900 font-bold shadow-sm'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                            isSelected ? 'border-gov-blue-700 bg-gov-blue-700' : 'border-slate-300'
                          }`}
                        >
                          {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <span className="truncate">{optLabel}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 5. Multiple Choice / Checkbox */}
              {q.type === 'multiple_choice' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {(q.options || []).map((opt) => {
                    const selectedList = answers[q.name] || [];
                    const isChecked = selectedList.includes(opt.value);
                    const optLabel = lang === 'ne' ? opt.label_ne || opt.label : opt.label;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          const updated = isChecked
                            ? selectedList.filter((v) => v !== opt.value)
                            : [...selectedList, opt.value];
                          handleAnswerChange(q.name, updated);
                        }}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-xs transition-all font-nepali ${
                          isChecked
                            ? 'bg-gov-blue-50 border-gov-blue-600 text-gov-blue-900 font-bold shadow-sm'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center ${
                            isChecked ? 'border-gov-blue-700 bg-gov-blue-700 text-white' : 'border-slate-300'
                          }`}
                        >
                          {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <span className="truncate">{optLabel}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 6. Dropdown */}
              {q.type === 'dropdown' && (
                <select
                  value={answers[q.name] ?? ''}
                  onChange={(e) => handleAnswerChange(q.name, e.target.value)}
                  className={`w-full text-xs px-3 py-2 rounded-lg border bg-white focus:outline-none focus:ring-1 font-nepali ${
                    errorMsg ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-300 focus:ring-gov-blue-500'
                  }`}
                >
                  <option value="">-- छनोट गर्नुहोस् (Select) --</option>
                  {(q.options || []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {lang === 'ne' ? opt.label_ne || opt.label : opt.label}
                    </option>
                  ))}
                </select>
              )}

              {/* 7. Yes / No Switch */}
              {q.type === 'yes_no' && (
                <div className="flex items-center gap-2 pt-1 font-nepali">
                  <button
                    type="button"
                    onClick={() => handleAnswerChange(q.name, 'yes')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${
                      answers[q.name] === 'yes'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    हो (Yes)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAnswerChange(q.name, 'no')}
                    className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${
                      answers[q.name] === 'no'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    होइन (No)
                  </button>
                </div>
              )}

              {/* 8. Date / Time */}
              {['date', 'time', 'datetime'].includes(q.type) && (
                <input
                  type={q.type === 'datetime' ? 'datetime-local' : q.type}
                  value={answers[q.name] ?? ''}
                  onChange={(e) => handleAnswerChange(q.name, e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-gov-blue-500"
                />
              )}

              {/* 9. Calculated Field (Read Only) */}
              {q.type === 'calculated' && (
                <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg border border-purple-200">
                  <span className="text-xs font-mono text-purple-900 font-bold">
                    {calculatedValues[q.name] ?? answers[q.name] ?? '0'}
                  </span>
                  <span className="text-[10px] text-purple-600 font-mono">
                    सूत्र: {q.calculation?.formula || ''}
                  </span>
                </div>
              )}

              {/* 10. Photo Capture */}
              {q.type === 'photo' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 px-3 py-2 bg-gov-blue-800 hover:bg-gov-blue-700 text-white text-xs font-bold rounded-lg cursor-pointer shadow-sm font-nepali">
                      <Camera className="w-3.5 h-3.5" />
                      <span>तस्बिर खिच्नुहोस् / अपलोड</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              const newRef = {
                                type: 'photo',
                                field: q.name,
                                name: file.name,
                                dataUrl: event.target.result,
                                timestamp: new Date().toISOString(),
                              };
                              setMediaRefs([...mediaRefs, newRef]);
                              handleAnswerChange(q.name, file.name);
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </label>
                  </div>

                  {/* Photo Thumbnail Previews */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {mediaRefs
                      .filter((m) => m.field === q.name)
                      .map((media, mIdx) => (
                        <div key={mIdx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-slate-300 group">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={media.dataUrl} alt="Captured" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => {
                              setMediaRefs(mediaRefs.filter((_, i) => i !== mIdx));
                              handleAnswerChange(q.name, '');
                            }}
                            className="absolute top-1 right-1 p-0.5 bg-rose-600 text-white rounded-full opacity-80 hover:opacity-100"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* 11. GPS Coordinate Stamp */}
              {q.type === 'gps_coordinate' && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-gov-blue-700" />
                    <span className="text-xs font-mono text-slate-700">
                      {answers[q.name]
                        ? JSON.stringify(answers[q.name])
                        : currentGps
                        ? `${currentGps.latitude.toFixed(6)}, ${currentGps.longitude.toFixed(6)}`
                        : 'अपेक्षित (Not captured)'}
                    </span>
                  </div>
                  {currentGps && (
                    <button
                      type="button"
                      onClick={() =>
                        handleAnswerChange(q.name, {
                          lat: currentGps.latitude,
                          lng: currentGps.longitude,
                          accuracy: currentGps.accuracy,
                        })
                      }
                      className="px-2.5 py-1 bg-gov-blue-800 text-white text-[11px] font-bold rounded font-nepali"
                    >
                      हालको स्थान लिनुहोस्
                    </button>
                  )}
                </div>
              )}

              {/* 12. Repeat Group / Dynamic Roster */}
              {q.type === 'repeat_group' && (
                <div className="space-y-3 pt-2">
                  <div className="space-y-2">
                    {(repeatData[q.name] || []).map((row, rIdx) => (
                      <div key={rIdx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-700 font-nepali">
                          <span>प्रविष्टि #{rIdx + 1} (Entry #{rIdx + 1})</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveRepeatRow(q.name, rIdx)}
                            className="text-rose-600 hover:text-rose-800 p-0.5"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            placeholder="नाम (Name / Item)"
                            value={row.name || ''}
                            onChange={(e) => handleUpdateRepeatField(q.name, rIdx, 'name', e.target.value)}
                            className="text-xs px-2 py-1.5 border rounded bg-white font-nepali"
                          />
                          <input
                            type="number"
                            placeholder="संख्या / उमेर (Number / Value)"
                            value={row.value || ''}
                            onChange={(e) => handleUpdateRepeatField(q.name, rIdx, 'value', e.target.value)}
                            className="text-xs px-2 py-1.5 border rounded bg-white"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleAddRepeatRow(q.name)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-gov-blue-900 rounded-lg text-xs font-bold font-nepali transition-colors border border-slate-200"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>नयाँ प्रविष्टि थप्नुहोस् (+ Add Row)</span>
                  </button>
                </div>
              )}

              {/* Error Message */}
              {errorMsg && (
                <p className="text-[11px] text-rose-600 font-bold mt-1.5 flex items-center gap-1 font-nepali">
                  <AlertCircle className="w-3 h-3" />
                  <span>{errorMsg}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Sticky Action Footer */}
      <div className="p-3 bg-white border-t border-slate-200 flex items-center justify-between shrink-0 shadow-lg">
        {/* Navigation Buttons: Previous & Next */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={activeSectionIndex === 0}
            onClick={() => setActiveSectionIndex(activeSectionIndex - 1)}
            className="flex items-center gap-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg disabled:opacity-40 transition-colors font-nepali"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>अघिल्लो (Prev)</span>
          </button>

          {activeSectionIndex < sections.length - 1 ? (
            <button
              type="button"
              onClick={() => setActiveSectionIndex(activeSectionIndex + 1)}
              className="flex items-center gap-1 px-3.5 py-2 bg-gov-blue-800 hover:bg-gov-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors font-nepali"
            >
              <span>पछिल्लो (Next)</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : null}
        </div>

        {/* Action Buttons: Save Draft vs Submit */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleSaveDraft(false)}
            disabled={saveStatus === 'saving'}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded-lg transition-colors font-nepali"
          >
            <Save className={`w-3.5 h-3.5 ${saveStatus === 'saving' ? 'animate-spin' : ''}`} />
            <span>मस्यौदा सुरक्षित (Save Draft)</span>
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-md transition-colors font-nepali disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>बुझाउनुहोस् (Submit Survey)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
