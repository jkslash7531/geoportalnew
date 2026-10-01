'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plus, Trash2, ArrowUp, ArrowDown, Save, CheckCircle2, AlertTriangle,
  Eye, EyeOff, Layers, Settings, FileText, Globe, Copy, Sparkles, Check,
  X, ChevronRight, ChevronDown, ChevronUp, ListFilter, HelpCircle, Code, ShieldCheck,
  Smartphone, Monitor, RefreshCw, Upload, Download, SplitSquareVertical, Pencil
} from 'lucide-react';
import { questionnairesAPI } from '../../lib/api';
import {
  filterNepaliOnly,
  filterEnglishOnly,
  filterKeyIdentifier,
  SKIP_OPERATORS,
  evaluateQuestionVisibility,
} from '../../lib/questionnaireUtils';

// Universal Question Types as specified in System Objective
export const QUESTION_TYPES = [
  // Input
  { id: 'text', label: 'पाठ (Short Text)', category: 'Input', icon: 'Type' },
  { id: 'textarea', label: 'लामो पाठ (Long Text / Paragraph)', category: 'Input', icon: 'AlignLeft' },
  { id: 'nepali_text', label: 'नेपाली युनिकोड (Nepali Unicode)', category: 'Input', icon: 'Globe' },
  { id: 'number', label: 'संख्या (Number)', category: 'Input', icon: 'Hash' },
  { id: 'decimal', label: 'दशमलव (Decimal)', category: 'Input', icon: 'Percent' },
  { id: 'currency', label: 'रकम (Currency - NPR रू)', category: 'Input', icon: 'DollarSign' },
  { id: 'phone', label: 'फोन नम्बर (Phone)', category: 'Input', icon: 'Phone' },
  { id: 'email', label: 'इमेल (Email)', category: 'Input', icon: 'Mail' },
  // Selection
  { id: 'single_choice', label: 'एकल छनोट (Radio / Single Choice)', category: 'Selection', icon: 'CheckCircle' },
  { id: 'multiple_choice', label: 'बहु-छनोट (Checkbox / Multiple)', category: 'Selection', icon: 'CheckSquare' },
  { id: 'dropdown', label: 'ड्रपडाउन (Dropdown)', category: 'Selection', icon: 'ChevronDown' },
  { id: 'yes_no', label: 'हो / होइन (Yes / No)', category: 'Selection', icon: 'ToggleLeft' },
  { id: 'rating', label: 'रेटिङ (Rating 1-5)', category: 'Selection', icon: 'Star' },
  { id: 'likert', label: 'लाइकर्त स्केल (Likert Scale)', category: 'Selection', icon: 'BarChart' },
  // Date/Time
  { id: 'date', label: 'मिति (Date)', category: 'Date/Time', icon: 'Calendar' },
  { id: 'time', label: 'समय (Time)', category: 'Date/Time', icon: 'Clock' },
  { id: 'datetime', label: 'मिति र समय (Date & Time)', category: 'Date/Time', icon: 'CalendarClock' },
  // Spatial
  { id: 'gps_coordinate', label: 'GPS निर्देशांक (GPS Coordinate)', category: 'Spatial', icon: 'MapPin' },
  { id: 'feature_picker', label: 'अवस्थित फिचर छनोट (Feature Picker)', category: 'Spatial', icon: 'Crosshair' },
  // Media
  { id: 'photo', label: 'फोटो / क्यामेरा (Photo Capture)', category: 'Media', icon: 'Camera' },
  { id: 'signature', label: 'डिजिटल हस्ताक्षर (Signature)', category: 'Media', icon: 'PenTool' },
  { id: 'document', label: 'फाइल / कागजात (Document/File)', category: 'Media', icon: 'FileUp' },
  // Structural / Dynamic
  { id: 'repeat_group', label: 'दोहोरिने समूह (Repeat Group / Roster)', category: 'Structural', icon: 'Repeat' },
  { id: 'calculated', label: 'गणना गरिएको मान (Calculated Field)', category: 'Dynamic', icon: 'Calculator' },
];

export default function QuestionnaireBuilder({
  projectId,
  project,
  onPublished,
  onClose,
}) {
  const [questionnaires, setQuestionnaires] = useState([]);
  const [activeQId, setActiveQId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // Active definition working state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('v1.0');
  const [status, setStatus] = useState('DRAFT');
  const [sections, setSections] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [settings, setSettings] = useState({
    autosave_seconds: 30,
    require_gps: true,
    gps_accuracy_threshold_m: 15,
    allow_offline: true,
  });

  // Selected item in editor
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState(null);
  const [editingSection, setEditingSection] = useState(null); // { id, title, title_ne, description }

  // Custom Dropdowns state
  const [showAddQuestionMenu, setShowAddQuestionMenu] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);

  // Preview & Validation mode
  const [viewMode, setViewMode] = useState('editor'); // 'editor' | 'preview' | 'validation'
  const [previewLanguage, setPreviewLanguage] = useState('ne'); // 'ne' | 'en'
  const [previewAnswers, setPreviewAnswers] = useState({});
  const [validationReport, setValidationReport] = useState(null);
  const [validating, setValidating] = useState(false);

  // Load questionnaires for project
  const loadQuestionnaires = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const res = await questionnairesAPI.listByProject(projectId);
      const list = res.data || [];
      setQuestionnaires(list);

      if (list.length > 0) {
        // Select active or latest
        const active = list.find((q) => q.is_active) || list[0];
        loadDefinition(active);
      } else {
        // Init default template
        initDefaultTemplate();
      }
    } catch (err) {
      console.error('Failed to load questionnaires', err);
      initDefaultTemplate();
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadQuestionnaires();
  }, [loadQuestionnaires]);

  const initDefaultTemplate = () => {
    setActiveQId(null);
    setTitle(`${project?.name || 'नगरपालिका'} स्थलगत सर्वेक्षण प्रश्नावली`);
    setDescription('Kathmandu Metropolitan City Advanced Field Survey Questionnaire');
    setVersion('v1.0');
    setStatus('DRAFT');
    const defaultSec = {
      id: 'sec_1',
      title: 'सामान्य विवरण (General Information)',
      title_ne: 'सामान्य विवरण',
      order: 1,
      description: 'सडक, वडा तथा स्थानको प्रारम्भिक पहिचान',
    };
    setSections([defaultSec]);
    setSelectedSectionId('sec_1');
    setQuestions([
      {
        id: 'q_ward',
        name: 'ward_number',
        label: 'वडा नम्बर (Ward Number)',
        label_ne: 'वडा नम्बर',
        type: 'dropdown',
        section_id: 'sec_1',
        required: true,
        options: Array.from({ length: 32 }, (_, i) => ({ value: `${i + 1}`, label: `Ward ${i + 1}`, label_ne: `वडा नं ${i + 1}` })),
        gis_binding: 'ward_number',
      },
      {
        id: 'q_bldg_use',
        name: 'building_use',
        label: 'भवन / संरचनाको उपयोग (Building Use)',
        label_ne: 'भवन / संरचनाको उपयोग',
        type: 'single_choice',
        section_id: 'sec_1',
        required: true,
        options: [
          { value: 'residential', label: 'Residential (आवासीय)', label_ne: 'आवासीय' },
          { value: 'commercial', label: 'Commercial (व्यापारिक)', label_ne: 'व्यापारिक' },
          { value: 'institutional', label: 'Institutional (सरकारी/संस्थागत)', label_ne: 'सरकारी/संस्थागत' },
          { value: 'mixed', label: 'Mixed Use (मिश्रित)', label_ne: 'मिश्रित' },
        ],
        gis_binding: 'building_use',
      },
      {
        id: 'q_floors',
        name: 'floor_count',
        label: 'तला संख्या (Number of Floors)',
        label_ne: 'तला संख्या',
        type: 'number',
        section_id: 'sec_1',
        required: true,
        validation: { min: 1, max: 25 },
        gis_binding: 'floor_count',
      }
    ]);
  };

  const loadDefinition = (qDef) => {
    setActiveQId(qDef.id);
    setTitle(qDef.title || '');
    setDescription(qDef.description || '');
    setVersion(qDef.version || 'v1.0');
    setStatus(qDef.status || 'DRAFT');

    const schema = qDef.schema_definition || {};
    const secs = schema.sections || [];
    setSections(secs);
    setQuestions(schema.questions || []);
    setSettings(schema.settings || { autosave_seconds: 30, require_gps: true });

    if (secs.length > 0) {
      setSelectedSectionId(secs[0].id);
    }
  };

  // Section Handlers
  const handleAddSection = () => {
    const nextOrder = sections.length + 1;
    const newId = `sec_${Date.now()}`;
    const newSec = {
      id: newId,
      title: `Section ${nextOrder}`,
      title_ne: `खण्ड ${nextOrder}`,
      order: nextOrder,
      description: '',
    };
    setSections([...sections, newSec]);
    setSelectedSectionId(newId);
    setEditingSection({ ...newSec }); // Open edit modal immediately
  };

  const handleUpdateSection = (secId, updates) => {
    setSections((prev) => prev.map((s) => (s.id === secId ? { ...s, ...updates } : s)));
  };

  const handleDeleteSection = (secId) => {
    if (sections.length <= 1) {
      alert('कम से कम एक खण्ड (Section) अनिवार्य छ।');
      return;
    }
    if (confirm('के तपाईं यो खण्ड र यसका सबै प्रश्नहरू हटाउन चाहनुहुन्छ?')) {
      setSections(sections.filter((s) => s.id !== secId));
      setQuestions(questions.filter((q) => q.section_id !== secId));
      const remaining = sections.filter((s) => s.id !== secId);
      setSelectedSectionId(remaining[0]?.id || null);
    }
  };

  // Question Handlers
  const handleAddQuestion = (type = 'text') => {
    const qCount = questions.length + 1;
    const newId = `q_${Date.now()}`;
    const defaultKey = `field_${qCount}`;
    const typeObj = QUESTION_TYPES.find((t) => t.id === type) || QUESTION_TYPES[0];

    const newQ = {
      id: newId,
      name: defaultKey,
      label: `नयाँ प्रश्न ${qCount}`,
      label_ne: `नयाँ प्रश्न ${qCount}`,
      type: type,
      section_id: selectedSectionId || sections[0]?.id || 'sec_1',
      required: false,
      help_text: '',
      help_text_ne: '',
      gis_binding: defaultKey,
      options: ['single_choice', 'multiple_choice', 'dropdown', 'ranking'].includes(type)
        ? [
            { value: 'opt_1', label: 'विकल्प १ (Option 1)', label_ne: 'विकल्प १' },
            { value: 'opt_2', label: 'विकल्प २ (Option 2)', label_ne: 'विकल्प २' },
          ]
        : undefined,
      conditions: [],
      calculation: type === 'calculated' ? { formula: 'field_1 * field_2' } : undefined,
    };

    setQuestions([...questions, newQ]);
    setSelectedQuestionId(newId);
  };

  const handleUpdateQuestion = (qId, updates) => {
    setQuestions(questions.map((q) => (q.id === qId ? { ...q, ...updates } : q)));
  };

  const handleDeleteQuestion = (qId) => {
    setQuestions(questions.filter((q) => q.id !== qId));
    if (selectedQuestionId === qId) setSelectedQuestionId(null);
  };

  const handleMoveQuestion = (qId, direction) => {
    const currentList = [...questions];
    const index = currentList.findIndex((q) => q.id === qId);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentList.length) return;

    const temp = currentList[index];
    currentList[index] = currentList[targetIndex];
    currentList[targetIndex] = temp;
    setQuestions(currentList);
  };

  // Save Draft to Backend
  const handleSaveDraft = async () => {
    try {
      setSaving(true);
      setMessage(null);

      const payload = {
        title,
        description,
        schema_definition: {
          sections,
          questions,
          settings,
        },
      };

      let saved;
      if (activeQId) {
        const res = await questionnairesAPI.updateDraft(activeQId, payload);
        saved = res.data;
        setMessage({ type: 'success', text: 'प्रश्नावली मस्यौदा सफलतापूर्वक सुरक्षित भयो (Draft saved).' });
      } else {
        const res = await questionnairesAPI.createDraft(projectId, payload);
        saved = res.data;
        setActiveQId(saved.id);
        setMessage({ type: 'success', text: 'नयाँ प्रश्नावली मस्यौदा तयार भयो (New draft created).' });
      }

      await loadQuestionnaires();
    } catch (err) {
      console.error('Failed to save draft', err);
      setMessage({ type: 'error', text: err.response?.data?.detail || 'मस्यौदा सुरक्षित गर्न सकिएन।' });
    } finally {
      setSaving(false);
    }
  };

  // Run Pre-Publish Validation
  const handleRunValidation = async () => {
    if (!activeQId) {
      await handleSaveDraft();
    }
    try {
      setValidating(true);
      const res = await questionnairesAPI.validateSchema(activeQId);
      setValidationReport(res.data);
      setViewMode('validation');
    } catch (err) {
      console.error('Validation check failed', err);
      setMessage({ type: 'error', text: 'प्रमाणीकरण परीक्षण असफल भयो।' });
    } finally {
      setValidating(false);
    }
  };

  // Publish Questionnaire
  const handlePublish = async () => {
    if (!activeQId) {
      alert('पहिले मस्यौदा सुरक्षित गर्नुहोस् (Please save draft first).');
      return;
    }
    if (!confirm('के तपाईं यो प्रश्नावली प्रकाशित गर्न निश्चित हुनुहुन्छ? यो परियोजनाको सक्रिय फारम बन्नेछ।')) {
      return;
    }

    try {
      setSaving(true);
      const res = await questionnairesAPI.publish(activeQId, { increment_version: true });
      setMessage({ type: 'success', text: `प्रश्नावली ${res.data.version} सफलतापूर्वक प्रकाशित भयो!` });
      setStatus('PUBLISHED');
      await loadQuestionnaires();
      if (onPublished) onPublished(res.data);
    } catch (err) {
      console.error('Failed to publish', err);
      setMessage({ type: 'error', text: err.response?.data?.detail || 'प्रश्नावली प्रकाशित गर्न सकिएन।' });
    } finally {
      setSaving(false);
    }
  };

  // Duplicate Version
  const handleDuplicate = async () => {
    if (!activeQId) return;
    try {
      setSaving(true);
      const res = await questionnairesAPI.duplicate(activeQId);
      setMessage({ type: 'success', text: `नयाँ संस्करण ${res.data.version} मस्यौदा तयार भयो!` });
      loadDefinition(res.data);
      await loadQuestionnaires();
    } catch (err) {
      console.error('Failed to duplicate', err);
    } finally {
      setSaving(false);
    }
  };

  const selectedQuestion = useMemo(
    () => questions.find((q) => q.id === selectedQuestionId),
    [questions, selectedQuestionId]
  );

  const selectedSection = useMemo(
    () => sections.find((s) => s.id === selectedSectionId),
    [sections, selectedSectionId]
  );

  const activeSectionQuestions = useMemo(
    () => questions.filter((q) => q.section_id === selectedSectionId),
    [questions, selectedSectionId]
  );

  return (
    <div className="flex flex-col h-full bg-slate-100 text-slate-800 font-sans select-none overflow-hidden">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gov-blue-900 text-white shadow-md z-10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-gov-blue-800 rounded-lg text-gov-gold-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm font-nepali tracking-wide">{title || 'प्रश्नावली निर्माणकर्ता'}</span>
              <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider ${
                status === 'PUBLISHED' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}>
                {version} • {status}
              </span>
            </div>
            <span className="text-[11px] text-gov-blue-200">
              {project?.name} • GIS-Native Metadata Survey Engine
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Mode Switcher */}
          <div className="flex bg-gov-blue-800 rounded-lg p-0.5 border border-gov-blue-700">
            <button
              type="button"
              onClick={() => setViewMode('editor')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                viewMode === 'editor' ? 'bg-gov-blue-600 text-white' : 'text-gov-blue-200 hover:text-white'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>बिल्डर (Builder)</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('preview')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                viewMode === 'preview' ? 'bg-gov-blue-600 text-white' : 'text-gov-blue-200 hover:text-white'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>पूर्वावलोकन (Preview)</span>
            </button>
            <button
              type="button"
              onClick={handleRunValidation}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                viewMode === 'validation' ? 'bg-gov-blue-600 text-white' : 'text-gov-blue-200 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>जाँच (Validate)</span>
            </button>
          </div>

          {/* Version / Duplicate Button */}
          {activeQId && (
            <button
              type="button"
              onClick={handleDuplicate}
              title="नयाँ संस्करण मस्यौदा प्रतिलिपि गर्नुहोस्"
              className="p-1.5 bg-gov-blue-800 hover:bg-gov-blue-700 text-gov-blue-200 hover:text-white rounded-lg transition-colors border border-gov-blue-700"
            >
              <Copy className="w-4 h-4" />
            </button>
          )}

          {/* Save Draft */}
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            <Save className={`w-3.5 h-3.5 ${saving ? 'animate-spin' : ''}`} />
            <span>सुरक्षित (Save Draft)</span>
          </button>

          {/* Publish Button */}
          <button
            type="button"
            onClick={handlePublish}
            disabled={saving}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50 font-nepali"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>प्रकाशित गर्नुहोस् (Publish)</span>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-gov-blue-200 hover:text-white hover:bg-gov-blue-800 rounded-lg ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Notification Toast */}
      {message && (
        <div
          className={`flex items-center justify-between px-4 py-2 text-xs font-semibold ${
            message.type === 'success' ? 'bg-emerald-100 text-emerald-900 border-b border-emerald-200' : 'bg-rose-100 text-rose-900 border-b border-rose-200'
          }`}
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="text-slate-500 hover:text-slate-800">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Workspace Body */}
      {viewMode === 'editor' && (
        <div className="flex flex-1 min-h-0 divide-x divide-slate-200 bg-white">
          {/* Column 1: Sections & Questionnaire Structure */}
          <div className="w-64 flex flex-col bg-slate-50 shrink-0">
            <div className="p-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider font-nepali">
                खण्डहरू (Sections)
              </span>
              <button
                type="button"
                onClick={handleAddSection}
                className="flex items-center gap-1 px-2 py-1 bg-gov-blue-800 hover:bg-gov-blue-700 text-white text-[11px] font-bold rounded shadow-sm font-nepali"
              >
                <Plus className="w-3 h-3" />
                <span>थप्नुहोस्</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
              {sections.map((sec, idx) => {
                const isSelected = sec.id === selectedSectionId;
                const count = questions.filter((q) => q.section_id === sec.id).length;
                return (
                  <div
                    key={sec.id}
                    onClick={() => setSelectedSectionId(sec.id)}
                    className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all border ${
                      isSelected
                        ? 'bg-gov-blue-50 border-gov-blue-300 text-gov-blue-900 shadow-sm'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded">
                        {idx + 1}
                      </span>
                      <div className="truncate">
                        <div className="text-xs font-bold truncate font-nepali">{sec.title_ne || sec.title}</div>
                        {sec.title && sec.title_ne && (
                          <div className="text-[10px] text-slate-400 truncate">{sec.title}</div>
                        )}
                        <div className="text-[10px] text-slate-400">{count} प्रश्नहरू</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingSection({ ...sec });
                        }}
                        className="p-1 text-slate-400 hover:text-gov-blue-800 hover:bg-gov-blue-100 rounded transition-colors"
                        title="खण्ड सम्पादन गर्नुहोस् (Edit Section)"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {sections.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSection(sec.id);
                          }}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                          title="खण्ड मेटाउनुहोस्"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* General Project Questionnaire Metadata */}
            <div className="p-3 border-t border-slate-200 bg-white">
              <label className="block text-[11px] font-bold text-slate-600 mb-1 font-nepali">
                प्रश्नावली शीर्षक (Title)
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-xs px-2.5 py-1.5 rounded border border-slate-300 focus:outline-none focus:ring-1 focus:ring-gov-blue-500 mb-2 font-nepali"
              />
              <label className="block text-[11px] font-bold text-slate-600 mb-1 font-nepali">
                विवरण (Description)
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full text-xs px-2.5 py-1.5 rounded border border-slate-300 focus:outline-none focus:ring-1 focus:ring-gov-blue-500 resize-none font-nepali"
              />
            </div>
          </div>

          {/* Column 2: Question List for Selected Section */}
          <div className="flex-1 flex flex-col min-w-0 bg-white">
            {/* Section Header & Add Question Dropdown */}
            <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-sm text-slate-800 font-nepali truncate">
                  {selectedSection?.title_ne || selectedSection?.title || 'खण्ड'}
                </span>
                {selectedSection?.title && selectedSection?.title_ne && (
                  <span className="text-xs text-slate-500 hidden sm:inline truncate">
                    ({selectedSection.title})
                  </span>
                )}
                {selectedSection && (
                  <button
                    type="button"
                    onClick={() => setEditingSection({ ...selectedSection })}
                    className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold text-gov-blue-700 hover:text-gov-blue-900 bg-gov-blue-50 hover:bg-gov-blue-100 rounded border border-gov-blue-200 font-nepali transition-colors shrink-0"
                    title="खण्ड सम्पादन गर्नुहोस् (Edit Section Details)"
                  >
                    <Pencil className="w-3 h-3" />
                    <span>सम्पादन</span>
                  </button>
                )}
                <span className="text-xs text-slate-500 shrink-0">
                  ({activeSectionQuestions.length} प्रश्नहरू)
                </span>
              </div>

              {/* Add Question Menu */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowAddQuestionMenu((prev) => !prev)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gov-blue-800 hover:bg-gov-blue-700 text-white text-xs font-bold rounded-lg shadow-sm font-nepali transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>नयाँ प्रश्न थप्नुहोस् (Add Question)</span>
                    {showAddQuestionMenu ? (
                      <ChevronUp className="w-3.5 h-3.5 ml-1" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 ml-1" />
                    )}
                  </button>

                  {showAddQuestionMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-20"
                        onClick={() => setShowAddQuestionMenu(false)}
                      />
                      <div className="absolute right-0 top-full mt-1.5 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl z-30 p-2 max-h-96 overflow-y-auto scrollbar-thin animate-fade-in">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1">
                          प्रश्नका प्रकारहरू (Question Types)
                        </div>
                        {QUESTION_TYPES.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              handleAddQuestion(t.id);
                              setShowAddQuestionMenu(false);
                            }}
                            className="w-full text-left px-2.5 py-1.5 text-xs text-slate-700 hover:bg-gov-blue-50 hover:text-gov-blue-900 rounded-md font-nepali flex items-center justify-between transition-colors"
                          >
                            <span>{t.label}</span>
                            <span className="text-[10px] px-1 bg-slate-100 text-slate-500 rounded">{t.category}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Questions Draggable / Reorderable List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
              {activeSectionQuestions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                  <FileText className="w-12 h-12 stroke-[1.2] mb-2" />
                  <p className="text-xs font-nepali">यो खण्डमा कुनै प्रश्न थपिएको छैन।</p>
                  <p className="text-[11px]">माथिको बटनबाट नयाँ प्रश्न थप्नुहोस्।</p>
                </div>
              ) : (
                activeSectionQuestions.map((q, idx) => {
                  const isSelected = q.id === selectedQuestionId;
                  const typeMeta = QUESTION_TYPES.find((t) => t.id === q.type);
                  return (
                    <div
                      key={q.id}
                      onClick={() => setSelectedQuestionId(q.id)}
                      className={`flex items-start justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-gov-blue-50/70 border-gov-blue-400 shadow-md ring-1 ring-gov-blue-400'
                          : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="flex flex-col items-center gap-1 pt-0.5">
                          <span className="text-[11px] font-bold text-slate-400">#{idx + 1}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveQuestion(q.id, 'up');
                            }}
                            className="p-0.5 text-slate-400 hover:text-slate-700"
                            title="माथि सार्नुहोस्"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveQuestion(q.id, 'down');
                            }}
                            className="p-0.5 text-slate-400 hover:text-slate-700"
                            title="तल सार्नुहोस्"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-slate-900 font-nepali">
                              {q.label_ne || q.label}
                            </span>
                            {q.required && (
                              <span className="text-[10px] px-1.5 py-0.2 bg-rose-100 text-rose-700 rounded font-bold">
                                अनिवार्य (Required)
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-[11px] text-slate-500">
                            <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-mono text-[10px]">
                              {q.name}
                            </span>
                            <span>•</span>
                            <span className="text-gov-blue-700 font-medium font-nepali">
                              {typeMeta?.label || q.type}
                            </span>
                            {q.gis_binding && (
                              <>
                                <span>•</span>
                                <span className="text-slate-400 text-[10px] font-mono">GIS: {q.gis_binding}</span>
                              </>
                            )}
                            {q.conditions && q.conditions.length > 0 && (
                              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-bold">
                                {q.conditions.length} सर्त (Logic)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteQuestion(q.id);
                        }}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 transition-colors ml-2"
                        title="प्रश्न मेटाउनुहोस्"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Column 3: Question Settings & Inspector Panel */}
          <div className="w-80 sm:w-96 flex flex-col bg-slate-50 shrink-0 border-l border-slate-200 min-w-0 max-w-full">
            <div className="p-3 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider font-nepali">
                प्रश्न विशेषता (Question Inspector)
              </span>
              {selectedQuestion && (
                <span className="text-[10px] font-mono text-slate-500">{selectedQuestion.name}</span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
              {selectedQuestion ? (
                <>
                  {/* Basic Details */}
                  <div className="space-y-3 bg-white p-3 rounded-xl border border-slate-200 shadow-sm min-w-0">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-slate-700 font-nepali">
                          प्रश्न शीर्षक नेपाली (Nepali Label) *
                        </label>
                        <span className="text-[10px] text-gov-blue-700 bg-gov-blue-50 px-1.5 py-0.2 rounded font-semibold font-nepali">
                          नेपाली मात्र
                        </span>
                      </div>
                      <input
                        type="text"
                        placeholder="प्रश्नको नाम नेपालीमा लेख्नुहोस्..."
                        value={selectedQuestion.label_ne || ''}
                        onChange={(e) =>
                          handleUpdateQuestion(selectedQuestion.id, {
                            label_ne: filterNepaliOnly(e.target.value),
                          })
                        }
                        className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-gov-blue-500 font-nepali"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-slate-700">
                          Display Label (English)
                        </label>
                        <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded font-semibold">
                          English only
                        </span>
                      </div>
                      <input
                        type="text"
                        placeholder="Question label in English..."
                        value={selectedQuestion.label || ''}
                        onChange={(e) =>
                          handleUpdateQuestion(selectedQuestion.id, {
                            label: filterEnglishOnly(e.target.value),
                          })
                        }
                        className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-gov-blue-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Internal Key (PostGIS) *
                        </label>
                        <input
                          type="text"
                          value={selectedQuestion.name || ''}
                          onChange={(e) => {
                            const cleanKey = filterKeyIdentifier(e.target.value);
                            handleUpdateQuestion(selectedQuestion.id, { name: cleanKey, gis_binding: cleanKey });
                          }}
                          className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-300 font-mono text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          GIS Column Binding
                        </label>
                        <input
                          type="text"
                          value={selectedQuestion.gis_binding || ''}
                          onChange={(e) =>
                            handleUpdateQuestion(selectedQuestion.id, {
                              gis_binding: filterKeyIdentifier(e.target.value),
                            })
                          }
                          className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-300 font-mono text-slate-800"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        Question Type (प्रश्नको प्रकार)
                      </label>
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowTypeDropdown((prev) => !prev)}
                          className="w-full text-xs px-2.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 flex items-center justify-between transition-colors shadow-xs"
                        >
                          <div className="flex items-center gap-1.5 min-w-0 truncate">
                            <span className="text-xs font-bold font-nepali text-gov-blue-900 truncate">
                              {QUESTION_TYPES.find((t) => t.id === selectedQuestion.type)?.label || selectedQuestion.type}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.2 bg-slate-100 text-slate-500 rounded shrink-0">
                              {QUESTION_TYPES.find((t) => t.id === selectedQuestion.type)?.category}
                            </span>
                          </div>
                          {showTypeDropdown ? (
                            <ChevronUp className="w-3.5 h-3.5 text-slate-500 shrink-0 ml-1" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0 ml-1" />
                          )}
                        </button>

                        {showTypeDropdown && (
                          <>
                            <div
                              className="fixed inset-0 z-30"
                              onClick={() => setShowTypeDropdown(false)}
                            />
                            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-40 max-h-64 overflow-y-auto scrollbar-thin p-1.5 animate-fade-in">
                              {QUESTION_TYPES.map((t) => (
                                <button
                                  key={t.id}
                                  type="button"
                                  onClick={() => {
                                    handleUpdateQuestion(selectedQuestion.id, { type: t.id });
                                    setShowTypeDropdown(false);
                                  }}
                                  className={`w-full text-left px-2.5 py-1.5 text-xs rounded-lg flex items-center justify-between transition-colors ${
                                    selectedQuestion.type === t.id
                                      ? 'bg-gov-blue-50 text-gov-blue-900 font-bold'
                                      : 'text-slate-700 hover:bg-slate-100'
                                  }`}
                                >
                                  <span className="font-nepali">{t.label}</span>
                                  <span className="text-[10px] px-1 bg-slate-100 text-slate-500 rounded">{t.category}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                      <span className="text-xs font-bold text-slate-700 font-nepali">अनिवार्य प्रश्न (Required)</span>
                      <input
                        type="checkbox"
                        checked={Boolean(selectedQuestion.required)}
                        onChange={(e) => handleUpdateQuestion(selectedQuestion.id, { required: e.target.checked })}
                        className="w-4 h-4 rounded text-gov-blue-600 focus:ring-gov-blue-500"
                      />
                    </div>
                  </div>

                  {/* Choice Manager (for selection types) */}
                  {['single_choice', 'multiple_choice', 'dropdown', 'ranking'].includes(selectedQuestion.type) && (
                    <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-2 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700 font-nepali">छनोटका विकल्पहरू (Choices)</span>
                        <button
                          type="button"
                          onClick={() => {
                            const cur = selectedQuestion.options || [];
                            const nextNum = cur.length + 1;
                            handleUpdateQuestion(selectedQuestion.id, {
                              options: [
                                ...cur,
                                { value: `val_${nextNum}`, label: `Option ${nextNum}`, label_ne: `विकल्प ${nextNum}` },
                              ],
                            });
                          }}
                          className="text-[11px] font-bold text-gov-blue-700 hover:text-gov-blue-900 flex items-center gap-1 font-nepali"
                        >
                          <Plus className="w-3 h-3" />
                          <span>विकल्प थप्नुहोस्</span>
                        </button>
                      </div>

                      <div className="space-y-1.5">
                        {(selectedQuestion.options || []).map((opt, oIdx) => (
                          <div key={oIdx} className="flex flex-col gap-1 p-2 bg-slate-50 rounded-lg border border-slate-200">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                placeholder="Key"
                                value={opt.value}
                                onChange={(e) => {
                                  const newOpts = [...selectedQuestion.options];
                                  newOpts[oIdx].value = filterKeyIdentifier(e.target.value);
                                  handleUpdateQuestion(selectedQuestion.id, { options: newOpts });
                                }}
                                className="w-20 text-[11px] px-1.5 py-1 rounded border border-slate-300 font-mono"
                                title="Option Key (English/ASCII)"
                              />
                              <input
                                type="text"
                                placeholder="नेपाली विकल्प (नेपाली मात्र)"
                                value={opt.label_ne || ''}
                                onChange={(e) => {
                                  const newOpts = [...selectedQuestion.options];
                                  newOpts[oIdx].label_ne = filterNepaliOnly(e.target.value);
                                  handleUpdateQuestion(selectedQuestion.id, { options: newOpts });
                                }}
                                className="flex-1 text-[11px] px-2 py-1 rounded border border-slate-300 font-nepali"
                                title="Nepali Label (Nepali only)"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const newOpts = selectedQuestion.options.filter((_, i) => i !== oIdx);
                                  handleUpdateQuestion(selectedQuestion.id, { options: newOpts });
                                }}
                                className="p-1 text-slate-400 hover:text-rose-600 rounded"
                                title="मेटाउनुहोस्"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <input
                              type="text"
                              placeholder="English Label (English only)"
                              value={opt.label || ''}
                              onChange={(e) => {
                                const newOpts = [...selectedQuestion.options];
                                newOpts[oIdx].label = filterEnglishOnly(e.target.value);
                                handleUpdateQuestion(selectedQuestion.id, { options: newOpts });
                              }}
                              className="w-full text-[11px] px-2 py-0.5 rounded border border-slate-200 text-slate-600"
                              title="English Label (English only)"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Conditional Logic / Skip Logic Builder */}
                  <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-2.5 min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 font-nepali">सर्त / स्किप लजिक (Skip Logic)</span>
                      <button
                        type="button"
                        onClick={() => {
                          const cur = selectedQuestion.conditions || [];
                          handleUpdateQuestion(selectedQuestion.id, {
                            conditions: [
                              ...cur,
                              { depends_on: '', operator: '==', value: '' },
                            ],
                          });
                        }}
                        className="text-[11px] font-bold text-gov-blue-700 hover:text-gov-blue-900 flex items-center gap-1 font-nepali"
                      >
                        <Plus className="w-3 h-3" />
                        <span>सर्त थप्नुहोस्</span>
                      </button>
                    </div>

                    {(selectedQuestion.conditions || []).length > 1 && (
                      <div className="flex items-center justify-between p-2 bg-gov-blue-50/70 rounded-lg border border-gov-blue-200">
                        <span className="text-[11px] font-bold text-gov-blue-900 font-nepali">
                          सर्त मिलान:
                        </span>
                        <div className="flex bg-white rounded border border-gov-blue-300 p-0.5 text-xs font-bold">
                          <button
                            type="button"
                            onClick={() => handleUpdateQuestion(selectedQuestion.id, { condition_logic: 'AND' })}
                            className={`px-2 py-0.5 rounded ${
                              (selectedQuestion.condition_logic || 'AND') === 'AND'
                                ? 'bg-gov-blue-800 text-white'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            AND (सबै)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateQuestion(selectedQuestion.id, { condition_logic: 'OR' })}
                            className={`px-2 py-0.5 rounded ${
                              selectedQuestion.condition_logic === 'OR'
                                ? 'bg-gov-blue-800 text-white'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            OR (कुनै एक)
                          </button>
                        </div>
                      </div>
                    )}

                    {(selectedQuestion.conditions || []).length === 0 ? (
                      <p className="text-[11px] text-slate-400">यो प्रश्न सधैं देखिन्छ (Always visible).</p>
                    ) : (
                      selectedQuestion.conditions.map((cond, cIdx) => {
                        const targetQ = questions.find((q) => q.name === cond.depends_on);
                        return (
                          <div key={cIdx} className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-xs min-w-0 overflow-hidden">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-slate-500 uppercase">
                                IF (सर्त #{cIdx + 1})
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = selectedQuestion.conditions.filter((_, i) => i !== cIdx);
                                  handleUpdateQuestion(selectedQuestion.id, { conditions: updated });
                                }}
                                className="text-slate-400 hover:text-rose-600 p-0.5 rounded"
                                title="सर्त हटाउनुहोस्"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* 1. Target Question */}
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-600 mb-0.5 font-nepali">
                                प्रश्न छनोट (Depends On Question)
                              </label>
                              <select
                                value={cond.depends_on}
                                onChange={(e) => {
                                  const updated = [...selectedQuestion.conditions];
                                  updated[cIdx].depends_on = e.target.value;
                                  updated[cIdx].value = '';
                                  handleUpdateQuestion(selectedQuestion.id, { conditions: updated });
                                }}
                                className="w-full text-xs p-1.5 border border-slate-300 rounded bg-white truncate font-nepali"
                              >
                                <option value="">-- प्रश्न छनोट गर्नुहोस् --</option>
                                {questions
                                  .filter((q) => q.id !== selectedQuestion.id)
                                  .map((q) => (
                                    <option key={q.name} value={q.name}>
                                      {q.label_ne || q.label} [{q.name}]
                                    </option>
                                  ))}
                              </select>
                            </div>

                            {/* 2. Operator */}
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-600 mb-0.5 font-nepali">
                                सर्त (Operator)
                              </label>
                              <select
                                value={cond.operator || '=='}
                                onChange={(e) => {
                                  const updated = [...selectedQuestion.conditions];
                                  updated[cIdx].operator = e.target.value;
                                  handleUpdateQuestion(selectedQuestion.id, { conditions: updated });
                                }}
                                className="w-full text-xs p-1.5 border border-slate-300 rounded bg-white truncate font-nepali"
                              >
                                {SKIP_OPERATORS.map((op) => (
                                  <option key={op.id} value={op.id}>
                                    {op.label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* 3. Expected Value */}
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-600 mb-0.5 font-nepali">
                                अपेक्षित मान (Expected Value)
                              </label>
                              {['is_empty', 'is_not_empty'].includes(cond.operator) ? (
                                <div className="p-1.5 bg-slate-200/70 rounded text-[11px] text-slate-600 font-nepali">
                                  ✓ मान आवश्यक पर्दैन
                                </div>
                              ) : targetQ?.type === 'yes_no' ? (
                                <select
                                  value={cond.value}
                                  onChange={(e) => {
                                    const updated = [...selectedQuestion.conditions];
                                    updated[cIdx].value = e.target.value;
                                    handleUpdateQuestion(selectedQuestion.id, { conditions: updated });
                                  }}
                                  className="w-full text-xs p-1.5 border border-slate-300 rounded bg-white font-nepali"
                                >
                                  <option value="">-- उत्तर छान्नुहोस् --</option>
                                  <option value="yes">हो (Yes)</option>
                                  <option value="no">होइन (No)</option>
                                </select>
                              ) : ['single_choice', 'multiple_choice', 'dropdown', 'ranking'].includes(targetQ?.type) && targetQ?.options?.length > 0 ? (
                                <select
                                  value={cond.value}
                                  onChange={(e) => {
                                    const updated = [...selectedQuestion.conditions];
                                    updated[cIdx].value = e.target.value;
                                    handleUpdateQuestion(selectedQuestion.id, { conditions: updated });
                                  }}
                                  className="w-full text-xs p-1.5 border border-slate-300 rounded bg-white font-nepali truncate"
                                >
                                  <option value="">-- विकल्प छनोट गर्नुहोस् --</option>
                                  {targetQ.options.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label_ne || opt.label} ({opt.value})
                                    </option>
                                  ))}
                                </select>
                              ) : ['number', 'decimal', 'currency'].includes(targetQ?.type) ? (
                                <input
                                  type="number"
                                  placeholder="e.g. 5"
                                  value={cond.value}
                                  onChange={(e) => {
                                    const updated = [...selectedQuestion.conditions];
                                    updated[cIdx].value = e.target.value;
                                    handleUpdateQuestion(selectedQuestion.id, { conditions: updated });
                                  }}
                                  className="w-full text-xs p-1.5 border border-slate-300 rounded bg-white font-mono"
                                />
                              ) : (
                                <input
                                  type="text"
                                  placeholder="अपेक्षित मान लेख्नुहोस्..."
                                  value={cond.value}
                                  onChange={(e) => {
                                    const updated = [...selectedQuestion.conditions];
                                    updated[cIdx].value = e.target.value;
                                    handleUpdateQuestion(selectedQuestion.id, { conditions: updated });
                                  }}
                                  className="w-full text-xs p-1.5 border border-slate-300 rounded bg-white"
                                />
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>


                  {/* Calculations & Formula (for calculated types) */}
                  {selectedQuestion.type === 'calculated' && (
                    <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-2">
                      <span className="text-xs font-bold text-slate-700 font-nepali">गणना सूत्र (Formula)</span>
                      <input
                        type="text"
                        placeholder="e.g. length * width"
                        value={selectedQuestion.calculation?.formula || ''}
                        onChange={(e) =>
                          handleUpdateQuestion(selectedQuestion.id, {
                            calculation: { formula: e.target.value },
                          })
                        }
                        className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono"
                      />
                      <p className="text-[10px] text-slate-500">
                        अन्य प्रश्नका key हरू प्रयोग गरी गणितीय सूत्र लेख्नुहोस्।
                      </p>
                    </div>
                  )}

                  {/* Validation Limits */}
                  <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-2">
                    <span className="text-xs font-bold text-slate-700 font-nepali">मान सीमा (Validation Limits)</span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">न्यूनतम (Min)</label>
                        <input
                          type="number"
                          value={selectedQuestion.validation?.min ?? ''}
                          onChange={(e) =>
                            handleUpdateQuestion(selectedQuestion.id, {
                              validation: { ...selectedQuestion.validation, min: e.target.value ? Number(e.target.value) : undefined },
                            })
                          }
                          className="w-full text-xs p-1.5 border rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">अधिकतम (Max)</label>
                        <input
                          type="number"
                          value={selectedQuestion.validation?.max ?? ''}
                          onChange={(e) =>
                            handleUpdateQuestion(selectedQuestion.id, {
                              validation: { ...selectedQuestion.validation, max: e.target.value ? Number(e.target.value) : undefined },
                            })
                          }
                          className="w-full text-xs p-1.5 border rounded"
                        />
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                  <HelpCircle className="w-10 h-10 stroke-[1.2] mb-2" />
                  <p className="text-xs font-nepali">कुनै प्रश्न छनोट गरिएको छैन।</p>
                  <p className="text-[11px]">बायाँबाट प्रश्न छान्नुहोस्।</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Live Preview Mode */}
      {viewMode === 'preview' && (
        <div className="flex-1 flex flex-col bg-slate-100 p-6 overflow-y-auto items-center">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col min-h-0">
            {/* Preview Banner */}
            <div className="px-6 py-4 bg-gradient-to-r from-gov-blue-900 to-gov-blue-800 text-white flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-gov-gold-400 font-bold">
                  प्रत्यक्ष पूर्वावलोकन (Live Questionnaire Preview)
                </div>
                <h3 className="text-base font-bold font-nepali mt-0.5">{title}</h3>
              </div>

              {/* Language Switcher */}
              <div className="flex items-center gap-1 bg-gov-blue-950/60 p-1 rounded-lg border border-gov-blue-700/50">
                <button
                  type="button"
                  onClick={() => setPreviewLanguage('ne')}
                  className={`px-2.5 py-1 text-xs font-bold rounded ${
                    previewLanguage === 'ne' ? 'bg-gov-gold-500 text-gov-blue-950 shadow-sm' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  नेपाली
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewLanguage('en')}
                  className={`px-2.5 py-1 text-xs font-bold rounded ${
                    previewLanguage === 'en' ? 'bg-gov-gold-500 text-gov-blue-950 shadow-sm' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  English
                </button>
              </div>
            </div>

            {/* Simulated Form Body */}
            <div className="p-6 space-y-6 overflow-y-auto">
              {sections.map((sec, sIdx) => {
                const secQs = questions.filter((q) => q.section_id === sec.id);
                return (
                  <div key={sec.id} className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-gov-blue-800 text-white flex items-center justify-center text-xs font-bold">
                        {sIdx + 1}
                      </span>
                      <h4 className="text-sm font-bold text-slate-800 font-nepali">
                        {previewLanguage === 'ne' ? sec.title_ne || sec.title : sec.title}
                      </h4>
                    </div>

                    <div className="p-4 space-y-4">
                      {secQs.map((q) => {
                        // Check skip conditions
                        const isVisible = evaluateQuestionVisibility(q, previewAnswers);
                        if (!isVisible) return null;

                        const labelText = previewLanguage === 'ne' ? q.label_ne || q.label : q.label;

                        return (
                          <div key={q.id} className="space-y-1.5 animate-fade-in">
                            <label className="block text-xs font-bold text-slate-700 font-nepali">
                              {labelText}
                              {q.required && <span className="text-rose-600 ml-1">*</span>}
                            </label>

                            {/* Render input by type */}
                            {q.type === 'text' && (
                              <input
                                type="text"
                                value={previewAnswers[q.name] || ''}
                                onChange={(e) => setPreviewAnswers({ ...previewAnswers, [q.name]: e.target.value })}
                                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-1 focus:ring-gov-blue-500"
                              />
                            )}

                            {q.type === 'number' && (
                              <input
                                type="number"
                                value={previewAnswers[q.name] || ''}
                                onChange={(e) => setPreviewAnswers({ ...previewAnswers, [q.name]: e.target.value })}
                                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-1 focus:ring-gov-blue-500"
                              />
                            )}

                            {q.type === 'dropdown' && (
                              <select
                                value={previewAnswers[q.name] || ''}
                                onChange={(e) => setPreviewAnswers({ ...previewAnswers, [q.name]: e.target.value })}
                                className="w-full text-xs px-3 py-2 border rounded-lg bg-white"
                              >
                                <option value="">-- छनोट गर्नुहोस् --</option>
                                {(q.options || []).map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {previewLanguage === 'ne' ? opt.label_ne || opt.label : opt.label}
                                  </option>
                                ))}
                              </select>
                            )}

                            {q.type === 'single_choice' && (
                              <div className="space-y-1 pt-1">
                                {(q.options || []).map((opt) => (
                                  <label key={opt.value} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer font-nepali">
                                    <input
                                      type="radio"
                                      name={q.name}
                                      value={opt.value}
                                      checked={previewAnswers[q.name] === opt.value}
                                      onChange={() => setPreviewAnswers({ ...previewAnswers, [q.name]: opt.value })}
                                      className="text-gov-blue-600"
                                    />
                                    <span>{previewLanguage === 'ne' ? opt.label_ne || opt.label : opt.label}</span>
                                  </label>
                                ))}
                              </div>
                            )}

                            {q.type === 'yes_no' && (
                              <div className="flex items-center gap-4 pt-1 font-nepali text-xs">
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={q.name}
                                    value="yes"
                                    checked={previewAnswers[q.name] === 'yes'}
                                    onChange={() => setPreviewAnswers({ ...previewAnswers, [q.name]: 'yes' })}
                                    className="text-gov-blue-600"
                                  />
                                  <span>{previewLanguage === 'ne' ? 'हो' : 'Yes'}</span>
                                </label>
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={q.name}
                                    value="no"
                                    checked={previewAnswers[q.name] === 'no'}
                                    onChange={() => setPreviewAnswers({ ...previewAnswers, [q.name]: 'no' })}
                                    className="text-gov-blue-600"
                                  />
                                  <span>{previewLanguage === 'ne' ? 'होइन' : 'No'}</span>
                                </label>
                              </div>
                            )}

                            {q.type === 'multiple_choice' && (
                              <div className="space-y-1 pt-1">
                                {(q.options || []).map((opt) => {
                                  const selectedList = previewAnswers[q.name] || [];
                                  const isChecked = selectedList.includes(opt.value);
                                  return (
                                    <label key={opt.value} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer font-nepali">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => {
                                          const updated = isChecked
                                            ? selectedList.filter((v) => v !== opt.value)
                                            : [...selectedList, opt.value];
                                          setPreviewAnswers({ ...previewAnswers, [q.name]: updated });
                                        }}
                                        className="text-gov-blue-600 rounded"
                                      />
                                      <span>{previewLanguage === 'ne' ? opt.label_ne || opt.label : opt.label}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}

                            {q.type === 'photo' && (
                              <div className="p-4 border-2 border-dashed border-slate-300 rounded-xl text-center text-slate-400 text-xs">
                                📷 फोटो क्याप्चर क्षेत्र (Camera Capture Sandbox)
                              </div>
                            )}

                            {q.type === 'gps_coordinate' && (
                              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
                                <span className="font-mono text-slate-600">Lat: 27.7172° N, Lng: 85.3240° E</span>
                                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-[10px]">GPS Fixed</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Validation Report View */}
      {viewMode === 'validation' && (
        <div className="flex-1 flex flex-col bg-slate-100 p-6 overflow-y-auto items-center">
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-6 h-6 text-gov-blue-800" />
                <h3 className="text-base font-bold font-nepali text-slate-800">
                  प्रश्नावली प्रमाणीकरण रिपोर्ट (Pre-Publish Verification)
                </h3>
              </div>
              <button
                type="button"
                onClick={handleRunValidation}
                disabled={validating}
                className="p-1.5 text-slate-500 hover:text-slate-800"
              >
                <RefreshCw className={`w-4 h-4 ${validating ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {validationReport ? (
              <div className="space-y-4">
                <div className={`p-4 rounded-xl border flex items-center gap-3 ${
                  validationReport.valid
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}>
                  {validationReport.valid ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0" />
                  )}
                  <div>
                    <h4 className="font-bold text-sm">
                      {validationReport.valid ? 'संरचना पूर्ण रूपमा प्रमाणित (Schema Valid)' : 'प्रमाणीकरण त्रुटिहरू फेला परे (Validation Errors)'}
                    </h4>
                    <p className="text-xs mt-0.5 opacity-90">
                      {validationReport.valid
                        ? 'प्रश्नावली प्रकाशित गर्न पूर्ण रूपमा तयार छ। सबै कुञ्जीहरू, सर्तहरू तथा संरचना सही छन्।'
                        : 'कृपया तलका त्रुटिहरू सच्याएर पुनः जाँच गर्नुहोस्।'}
                    </p>
                  </div>
                </div>

                {validationReport.errors && validationReport.errors.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-rose-800 uppercase tracking-wide">
                      त्रुटिहरू (Critical Errors - {validationReport.errors.length})
                    </span>
                    <ul className="space-y-1">
                      {validationReport.errors.map((err, i) => (
                        <li key={i} className="text-xs text-rose-700 bg-rose-50/50 p-2 rounded border border-rose-100 flex items-start gap-1.5">
                          <X className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-500" />
                          <span>{err}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {validationReport.warnings && validationReport.warnings.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-amber-800 uppercase tracking-wide">
                      चेतावनीहरू (Warnings - {validationReport.warnings.length})
                    </span>
                    <ul className="space-y-1">
                      {validationReport.warnings.map((warn, i) => (
                        <li key={i} className="text-xs text-amber-700 bg-amber-50/50 p-2 rounded border border-amber-100 flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
                          <span>{warn}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="pt-4 border-t flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setViewMode('editor')}
                    className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-lg font-nepali"
                  >
                    बिल्डरमा फर्कनुहोस्
                  </button>
                  {validationReport.valid && (
                    <button
                      type="button"
                      onClick={handlePublish}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg font-nepali shadow-md"
                    >
                      अहिले प्रकाशित गर्नुहोस् (Publish Now)
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400 text-xs font-nepali">
                परीक्षण गरिँदैछ...
              </div>
            )}
          </div>
        </div>
      )}
      {/* Section Edit Modal */}
      {editingSection && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in font-sans">
          <div className="bg-white rounded-2xl border border-slate-300 shadow-2xl w-full max-w-md overflow-hidden animate-scale-in">
            <div className="px-4 py-3 bg-gov-blue-800 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-gov-gold-400" />
                <h3 className="text-xs font-bold font-nepali">खण्ड सम्पादन (Edit Section)</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingSection(null)}
                className="text-gov-blue-200 hover:text-white p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700 font-nepali">
                    खण्डको नाम नेपाली (Nepali Title) *
                  </label>
                  <span className="text-[10px] text-gov-blue-700 bg-gov-blue-50 px-1.5 py-0.2 rounded font-semibold font-nepali">
                    नेपाली मात्र
                  </span>
                </div>
                <input
                  type="text"
                  placeholder="उदाहरण: सामान्य विवरण"
                  value={editingSection.title_ne || ''}
                  onChange={(e) =>
                    setEditingSection({ ...editingSection, title_ne: filterNepaliOnly(e.target.value) })
                  }
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-gov-blue-500 font-nepali"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700">
                    Section Title (English)
                  </label>
                  <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded font-semibold">
                    English only
                  </span>
                </div>
                <input
                  type="text"
                  placeholder="e.g. General Information"
                  value={editingSection.title || ''}
                  onChange={(e) =>
                    setEditingSection({ ...editingSection, title: filterEnglishOnly(e.target.value) })
                  }
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-gov-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 font-nepali">
                  खण्डको विवरण (Description / Instructions)
                </label>
                <textarea
                  rows={2}
                  placeholder="खण्ड सम्बन्धी संक्षिप्त विवरण..."
                  value={editingSection.description || ''}
                  onChange={(e) =>
                    setEditingSection({ ...editingSection, description: e.target.value })
                  }
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-gov-blue-500 resize-none font-nepali"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingSection(null)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  रद्द (Cancel)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleUpdateSection(editingSection.id, {
                      title: editingSection.title,
                      title_ne: editingSection.title_ne,
                      description: editingSection.description,
                    });
                    setEditingSection(null);
                  }}
                  className="px-4 py-1.5 rounded-lg bg-gov-blue-800 hover:bg-gov-blue-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm font-nepali"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>परिवर्तन सुरक्षित गर्नुहोस्</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
