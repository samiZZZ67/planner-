'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  Eye,
  FileCheck2,
  FileText,
  HelpCircle,
  History,
  Layers,
  Loader2,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { apiFetch } from '@/lib/api/apiClient';
import { defaultPostingTimes, type BookAssignmentRecord, type BookPageRecord, type BookRecord, type BookLearningPackage, type QuizQuestionItem } from '@/lib/books/types';
import { describeScheduleRemaining } from '@/lib/date/bookDeliverySchedule';
import { InteractiveQuizCard } from './InteractiveQuizCard';

interface BookAnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: BookRecord;
  assignments: BookAssignmentRecord[];
  onBookUpdated: (book: BookRecord) => void;
  onAssignmentsUpdated: (assignments: BookAssignmentRecord[]) => void;
  onSendNow?: (assignment: BookAssignmentRecord) => Promise<void>;
  initialTab?: 'overview' | 'pages' | 'schedule' | 'quiz';
  initialQuizAssignmentId?: string;
}

export function BookAnalyticsModal({
  isOpen,
  onClose,
  book,
  assignments,
  onBookUpdated,
  onAssignmentsUpdated,
  onSendNow,
  initialTab,
  initialQuizAssignmentId,
}: BookAnalyticsModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'pages' | 'schedule' | 'quiz'>(initialTab || 'overview');
  const [pages, setPages] = useState<BookPageRecord[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [selectedPageNum, setSelectedPageNum] = useState<number>(book.startPage);
  const [editedText, setEditedText] = useState<string>('');
  const [loadingSinglePage, setLoadingSinglePage] = useState(false);
  const [savingPage, setSavingPage] = useState(false);
  const [pageFilter, setPageFilter] = useState<'all' | 'needs_review' | 'empty'>('all');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const singlePageAbortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const planAbortRef = useRef<AbortController | null>(null);

  // Flexible Plan Config
  const [sectionsPerDay, setSectionsPerDay] = useState<number>(book.sectionsPerDay || 1);
  const [postingTimes, setPostingTimes] = useState<string[]>(() => {
    return book.postingTimes && book.postingTimes.length >= (book.sectionsPerDay || 1)
      ? book.postingTimes
      : defaultPostingTimes(book.sectionsPerDay || 1, book.postingTime);
  });
  const [regeneratingPlan, setRegeneratingPlan] = useState(false);

  // Assignment Editing inside BA
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [assignmentDraft, setAssignmentDraft] = useState<Partial<BookAssignmentRecord>>({});
  const [savingAssignmentId, setSavingAssignmentId] = useState<string | null>(null);
  const [sendingAssignmentId, setSendingAssignmentId] = useState<string | null>(null);

  // Quiz & Learning Package State
  const [selectedQuizAssignmentId, setSelectedQuizAssignmentId] = useState<string>(() => {
    if (initialQuizAssignmentId) return initialQuizAssignmentId;
    const firstPending = assignments.find(a => a.status !== 'completed');
    return firstPending?.id || assignments[0]?.id || '';
  });

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
    if (initialQuizAssignmentId) setSelectedQuizAssignmentId(initialQuizAssignmentId);
  }, [initialTab, initialQuizAssignmentId]);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestionItem[]>([]);
  const [learningPackage, setLearningPackage] = useState<BookLearningPackage | null>(null);
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [regeneratingQuiz, setRegeneratingQuiz] = useState(false);
  const [regeneratingSummary, setRegeneratingSummary] = useState(false);

  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const showNotice = (msg: string) => {
    setNotice(msg);
  };
  const showError = (msg: string) => {
    setError(msg);
  };

  const loadLearningPackageForAssignment = useCallback(async (assignmentId: string) => {
    if (!assignmentId) return;
    setLoadingQuiz(true);
    try {
      const res = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/assignments/${encodeURIComponent(assignmentId)}/learning-package`);
      const data = await res.json();
      if (res.ok && data.learningPackage) {
        setLearningPackage(data.learningPackage);
        setQuizQuestions(data.learningPackage.quiz || []);
      }
    } catch (err: any) {
      console.warn('Could not load learning package:', err);
    } finally {
      setLoadingQuiz(false);
    }
  }, [book.id]);

  useEffect(() => {
    if (activeTab === 'quiz' && selectedQuizAssignmentId) {
      void loadLearningPackageForAssignment(selectedQuizAssignmentId);
    }
  }, [activeTab, selectedQuizAssignmentId, loadLearningPackageForAssignment]);

  const handleRegenerateQuizOnly = async () => {
    if (!selectedQuizAssignmentId) return;
    setRegeneratingQuiz(true);
    try {
      const res = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/assignments/${encodeURIComponent(selectedQuizAssignmentId)}/learning-package`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component: 'quiz' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to regenerate quiz.');
      if (data.learningPackage) {
        setLearningPackage(data.learningPackage);
        setQuizQuestions(data.learningPackage.quiz || []);
        showNotice('Adaptive quiz regenerated successfully!');
      }
    } catch (err: any) {
      showError(err.message || 'Quiz regeneration failed.');
    } finally {
      setRegeneratingQuiz(false);
    }
  };

  const handleRegenerateSummaryOnly = async () => {
    if (!selectedQuizAssignmentId) return;
    setRegeneratingSummary(true);
    try {
      const res = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/assignments/${encodeURIComponent(selectedQuizAssignmentId)}/learning-package`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component: 'summary' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to regenerate summary.');
      if (data.learningPackage) {
        setLearningPackage(data.learningPackage);
        showNotice('Section summary regenerated successfully!');
      }
    } catch (err: any) {
      showError(err.message || 'Summary regeneration failed.');
    } finally {
      setRegeneratingSummary(false);
    }
  };

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // Load extracted pages (summary metadata only to prevent browser freeze on large books)
  const loadPages = useCallback(async () => {
    if (!isOpen) return;
    setLoadingPages(true);
    try {
      const response = await apiFetch(
        `/api/books/${encodeURIComponent(book.id)}/pages?summaryOnly=true&from=${book.startPage}&to=${book.endPage}`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load pages.');
      const loadedPages: BookPageRecord[] = data.pages || [];
      setPages(loadedPages);
      if (loadedPages.length > 0 && !loadedPages.some(p => p.pdfPage === selectedPageNum)) {
        setSelectedPageNum(loadedPages[0].pdfPage);
      }
    } catch (err) {
      console.error('Error loading pages for BA:', err);
    } finally {
      setLoadingPages(false);
    }
  }, [isOpen, book.id, book.startPage, book.endPage, selectedPageNum]);

  useEffect(() => {
    if (isOpen) {
      void loadPages();
      setSectionsPerDay(book.sectionsPerDay || 1);
      setPostingTimes(
        book.postingTimes && book.postingTimes.length >= (book.sectionsPerDay || 1)
          ? book.postingTimes
          : defaultPostingTimes(book.sectionsPerDay || 1, book.postingTime)
      );
    }
  }, [isOpen, book.id, loadPages, book.sectionsPerDay, book.postingTimes, book.postingTime]);

  // Load full single page text on demand to avoid downloading whole book at once
  const loadSinglePageText = useCallback(async (pageNum: number) => {
    if (singlePageAbortRef.current) {
      singlePageAbortRef.current.abort();
    }
    const controller = new AbortController();
    singlePageAbortRef.current = controller;
    setLoadingSinglePage(true);
    try {
      const response = await apiFetch(
        `/api/books/${encodeURIComponent(book.id)}/pages?pageNumber=${pageNum}`,
        { signal: controller.signal }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load page text.');
      if (data.page) {
        setEditedText(data.page.text || '');
        setPages(prev => prev.map(p => (p.pdfPage === pageNum ? { ...p, text: data.page.text, charCount: data.page.charCount } : p)));
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError' && !controller.signal.aborted) {
        console.error('Error fetching page text:', err);
      }
    } finally {
      if (singlePageAbortRef.current === controller) {
        singlePageAbortRef.current = null;
        setLoadingSinglePage(false);
      }
    }
  }, [book.id]);

  // Load single page text whenever selectedPageNum changes or modal switches to pages tab
  useEffect(() => {
    if (!isOpen || activeTab !== 'pages' || !selectedPageNum) return;
    void loadSinglePageText(selectedPageNum);
  }, [isOpen, activeTab, selectedPageNum, loadSinglePageText]);

  // Load preview image on-demand for selected page
  const loadPreviewImage = useCallback(async (pageNum: number) => {
    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
    }
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewLoading(true);

    try {
      const res = await apiFetch(
        `/api/books/${encodeURIComponent(book.id)}/pages/${pageNum}/preview`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      if (res.ok) {
        const blob = await res.blob();
        if (controller.signal.aborted) return;
        const objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return objectUrl;
        });
      } else {
        setPreviewUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
      }
    } catch (err: any) {
      if (!controller.signal.aborted && err?.name !== 'AbortError') {
        setPreviewUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
      }
    } finally {
      if (previewAbortRef.current === controller) {
        previewAbortRef.current = null;
        setPreviewLoading(false);
      }
    }
  }, [book.id]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'pages' || !selectedPageNum) {
      setPreviewUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    void loadPreviewImage(selectedPageNum);
  }, [isOpen, activeTab, selectedPageNum, loadPreviewImage]);

  // Cleanup all abort controllers and object URLs on unmount
  useEffect(() => {
    return () => {
      singlePageAbortRef.current?.abort();
      previewAbortRef.current?.abort();
      planAbortRef.current?.abort();
      setPreviewUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  // Handle sectionsPerDay change
  const handleSectionsPerDayChange = (count: number) => {
    const val = Math.max(1, Math.min(6, count));
    setSectionsPerDay(val);
    setPostingTimes(defaultPostingTimes(val, book.postingTime));
  };

  // ── Analytics Metrics Calculations ──────────────────────────────
  const totalSelectedPages = Math.max(1, book.endPage - book.startPage + 1);
  const totalBookPages = book.totalPdfPages || totalSelectedPages;
  const extractedCount = pages.length;

  const completedAssignments = useMemo(() => assignments.filter(a => a.status === 'completed'), [assignments]);
  const approvedAssignments = useMemo(() => assignments.filter(a => a.status === 'approved'), [assignments]);
  const draftAssignments = useMemo(() => assignments.filter(a => a.status === 'draft'), [assignments]);
  const failedAssignments = useMemo(
    () => assignments.filter(a => a.deliveryStatus === 'failed'),
    [assignments]
  );

  // Completed pages count: sum of unique pages in completed assignments
  const sentPagesCount = useMemo(() => {
    const set = new Set<number>();
    for (const a of completedAssignments) {
      for (let p = a.startPdfPage; p <= a.endPdfPage; p++) set.add(p);
    }
    return set.size;
  }, [completedAssignments]);

  const remainingPagesCount = Math.max(0, book.endPage - (book.currentPage - 1));
  const progressPercent = Math.min(100, Math.round((sentPagesCount / totalSelectedPages) * 100));

  // Identify next pending section
  const nextPendingAssignment = useMemo(() => {
    const pending = assignments
      .filter(a => a.status !== 'completed' && a.status !== 'superseded')
      .sort((a, b) => a.startPdfPage - b.startPdfPage);
    return pending[0] || null;
  }, [assignments]);

  // Extraction Health Audit
  const emptyPages = useMemo(() => pages.filter(p => p.method === 'empty' || !p.text.trim()), [pages]);
  const ocrPages = useMemo(() => pages.filter(p => p.method === 'ocr'), [pages]);
  const unreviewedOcrPages = useMemo(() => pages.filter(p => p.requiresReview && !p.reviewedByUser), [pages]);
  const missingPageNumbers = useMemo(() => {
    if (!pages.length) return [];
    const existing = new Set(pages.map(p => p.pdfPage));
    const missing: number[] = [];
    for (let p = book.startPage; p <= book.endPage; p++) {
      if (!existing.has(p)) missing.push(p);
    }
    return missing;
  }, [pages, book.startPage, book.endPage]);

  // Filtered pages for inspector
  const filteredPages = useMemo(() => {
    if (pageFilter === 'needs_review') {
      return pages.filter(p => (p.requiresReview && !p.reviewedByUser) || p.warnings.length > 0);
    }
    if (pageFilter === 'empty') {
      return pages.filter(p => p.method === 'empty' || !p.text.trim());
    }
    return pages;
  }, [pages, pageFilter]);

  // Save edited page text
  const handleSavePageText = async () => {
    if (savingPage) return;
    setSavingPage(true);
    setError('');
    try {
      const response = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/pages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfPage: selectedPageNum, text: editedText }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save page text.');

      setPages(prev => prev.map(p => (p.pdfPage === selectedPageNum ? data.page : p)));
      showNotice(`Page ${selectedPageNum} text updated in database! Future Telegram deliveries will use this text.`);
    } catch (err: any) {
      showError(err.message || 'Failed to update page text.');
    } finally {
      setSavingPage(false);
    }
  };

  // Mark page as visually reviewed
  const handleMarkReviewed = async () => {
    try {
      const response = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/pages/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfPage: selectedPageNum }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not record page review.');
      setPages(prev => prev.map(p => (p.pdfPage === selectedPageNum ? data.page : p)));
      onBookUpdated(data.book);
      showNotice(`Page ${selectedPageNum} marked as visually verified.`);
    } catch (err: any) {
      showError(err.message || 'Could not record review.');
    }
  };

  // Regenerate Flexible Plan
  const handleRegeneratePlan = async () => {
    if (regeneratingPlan) return;
    if (planAbortRef.current) {
      planAbortRef.current.abort();
    }
    const controller = new AbortController();
    planAbortRef.current = controller;
    setRegeneratingPlan(true);
    setError('');
    try {
      const model = localStorage.getItem('np_freellm_selected_model') || 'auto';
      const response = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          sectionsPerDay,
          postingTimes,
          model,
          preserveCompleted: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Plan generation failed.');

      // Refresh assignments
      const listRes = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/assignments`, {
        signal: controller.signal,
      });
      const listData = await listRes.json();
      if (listRes.ok && listData.assignments) {
        onAssignmentsUpdated(listData.assignments);
      }
      showNotice(
        `Generated ${data.assignments.length} sections (${sectionsPerDay} per day) for remaining pages. Historical sent readings are preserved!`
      );
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        showNotice('Plan generation cancelled.');
      } else {
        showError(err.message || 'Failed to generate plan.');
      }
    } finally {
      if (planAbortRef.current === controller) {
        planAbortRef.current = null;
        setRegeneratingPlan(false);
      }
    }
  };

  const handleCancelPlanRegeneration = () => {
    if (planAbortRef.current) {
      planAbortRef.current.abort();
      planAbortRef.current = null;
    }
    setRegeneratingPlan(false);
    showNotice('Plan generation cancelled.');
  };

  // Edit Assignment
  const handleBeginEditAssignment = (assignment: BookAssignmentRecord) => {
    setEditingAssignmentId(assignment.id);
    setAssignmentDraft({
      scheduledDate: assignment.scheduledDate,
      postingTime: assignment.postingTime || book.postingTime,
      startPdfPage: assignment.startPdfPage,
      endPdfPage: assignment.endPdfPage,
      rationale: assignment.rationale,
      estimatedMinutes: assignment.estimatedMinutes,
      status: assignment.status,
    });
  };

  const handleSaveAssignmentEdit = async (assignmentId: string) => {
    setSavingAssignmentId(assignmentId);
    setError('');
    try {
      const response = await apiFetch(
        `/api/books/${encodeURIComponent(book.id)}/assignments/${encodeURIComponent(assignmentId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(assignmentDraft),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update section.');

      onAssignmentsUpdated(assignments.map(a => (a.id === assignmentId ? data.assignment : a)));
      setEditingAssignmentId(null);
      showNotice(`Section updated successfully!`);
    } catch (err: any) {
      showError(err.message || 'Failed to update section.');
    } finally {
      setSavingAssignmentId(null);
    }
  };

  // Send Now from within BA
  const handleSendNowInternal = async (assignment: BookAssignmentRecord) => {
    if (sendingAssignmentId !== null) return;
    setSendingAssignmentId(assignment.id);
    setError('');
    try {
      if (onSendNow) {
        await onSendNow(assignment);
      } else {
        const response = await apiFetch(
          `/api/books/${encodeURIComponent(book.id)}/assignments/${encodeURIComponent(assignment.id)}/publish`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sendNow: true, override: true }),
          }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not send this section.');
        if (data.book) onBookUpdated(data.book);
        onAssignmentsUpdated(assignments.map(a => (a.id === assignment.id ? { ...a, status: 'completed' } : a)));
        showNotice(`Delivered section to Telegram! Pointer advanced automatically.`);
      }
    } catch (err: any) {
      showError(err.message || 'Send to Telegram failed.');
    } finally {
      setSendingAssignmentId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="v-modal-backdrop"
      style={{
        zIndex: 90,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ba-modal-title"
    >
      <div
        className="v-modal-dialog"
        style={{
          width: '100%',
          maxWidth: 960,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid var(--v-glass-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--v-glass-bg-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'var(--accent-glow)',
                border: '1.5px solid var(--accent-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-color)',
                boxShadow: '0 0 14px var(--accent-glow)',
              }}
            >
              <BarChart3 size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 id="ba-modal-title" style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {book.title}
                </h3>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: '#ffffff',
                    border: '1px solid rgba(255, 255, 255, 0.25)',
                    fontWeight: 600,
                  }}
                >
                  BA · Book Analytics
                </span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                Author: {book.author || 'Unknown'} · {book.durationDays} Days Plan · Daily posting at {book.postingTime} ({book.timezone})
              </p>
            </div>
          </div>
          <button
            type="button"
            className="v-circle-btn"
            onClick={onClose}
            aria-label="Close BA"
            style={{ width: 34, height: 34 }}
          >
            <X size={17} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--v-glass-border)',
            padding: '0 20px',
            background: 'var(--v-glass-bg-subtle)',
            gap: 6,
            overflowX: 'auto',
          }}
        >
          {[
            { id: 'overview', label: 'BA Overview & Analytics', icon: BarChart3 },
            { id: 'pages', label: `Extracted Pages (${pages.length})`, icon: FileText },
            { id: 'schedule', label: `Reading Plan & Multi-Sections (${assignments.length})`, icon: Calendar },
            { id: 'quiz', label: 'Learning & Interactive Quiz', icon: HelpCircle },
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--accent-color, #ffffff)' : 'var(--text-secondary)',
                  borderBottom: active ? '2px solid var(--accent-color, #ffffff)' : '2px solid transparent',
                  background: 'none',
                  borderTop: 'none',
                  borderLeft: 'none',
                  borderRight: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Notice & Error Banners */}
        {notice && (
          <div
            style={{
              padding: '10px 20px',
              background: 'rgba(255, 255, 255, 0.08)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice('')}
              style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {error && (
          <div
            style={{
              padding: '10px 20px',
              background: 'rgba(255, 255, 255, 0.08)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
              color: 'var(--text-secondary)',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Modal Scrollable Body */}
        <div style={{ padding: 22, overflowY: 'auto', flex: 1, display: 'grid', gap: 18 }}>
          {/* ═══════════════════════════════════════════════════════════════
              TAB 1: BA OVERVIEW & ANALYTICS
             ═══════════════════════════════════════════════════════════════ */}
          {activeTab === 'overview' && (
            <div style={{ display: 'grid', gap: 20 }}>
              {/* Top KPI Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                <div
                  className="v-card"
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    background: 'var(--v-glass-bg-subtle)',
                    border: '1px solid var(--v-glass-border)',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Selected Range
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>
                    pp. {book.startPage}–{book.endPage}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {totalSelectedPages} pages selected ({totalBookPages} in PDF)
                  </div>
                </div>

                <div
                  className="v-card"
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    background: 'var(--v-glass-bg-subtle)',
                    border: '1px solid var(--v-glass-border)',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Reading Position
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#ffffff', marginTop: 4 }}>
                    Page {book.currentPage}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {book.currentPage > book.endPage ? 'All pages read' : `Current pending page: ${book.currentPage}`}
                  </div>
                </div>

                <div
                  className="v-card"
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    background: 'var(--v-glass-bg-subtle)',
                    border: '1px solid var(--v-glass-border)',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Pages Sent / Left
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#ffffff', marginTop: 4 }}>
                    {sentPagesCount}{' '}
                    <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 400 }}>
                      / {remainingPagesCount} left
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {progressPercent}% completed to Telegram
                  </div>
                </div>

                <div
                  className="v-card"
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    background: 'var(--v-glass-bg-subtle)',
                    border: '1px solid var(--v-glass-border)',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Delivery Status
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: '#ffffff' }}>
                    {completedAssignments.length} Sent
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {approvedAssignments.length} scheduled · {draftAssignments.length} draft
                    {failedAssignments.length > 0 && ` · ${failedAssignments.length} failed`}
                  </div>
                </div>
              </div>

              {/* Progress Bar */}
              <div
                className="v-card"
                style={{
                  padding: 16,
                  borderRadius: 14,
                  display: 'grid',
                  gap: 8,
                  background: 'var(--v-glass-bg-subtle)',
                  border: '1px solid var(--v-glass-border)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Overall Reading & Telegram Delivery Progress</span>
                  <span style={{ color: '#ffffff', fontWeight: 700 }}>{progressPercent}%</span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: 10,
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${progressPercent}%`,
                      borderRadius: 999,
                      background: '#ffffff',
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                  <span>Start: Page {book.startPage}</span>
                  <span>Currently at: Page {book.currentPage}</span>
                  <span>End: Page {book.endPage}</span>
                </div>
              </div>

              {/* Current & Next Pending Section Card */}
              <div
                className="v-card"
                style={{
                  padding: 16,
                  borderRadius: 14,
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                  background: 'var(--v-glass-bg-subtle)',
                  display: 'grid',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Clock size={16} color="#ffffff" />
                    <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                      Current & Next Pending Delivery
                    </strong>
                  </div>
                  {nextPendingAssignment ? (
                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 600,
                        background: 'rgba(255, 255, 255, 0.1)',
                        color: '#ffffff',
                        border: '1px solid rgba(255, 255, 255, 0.25)',
                      }}
                    >
                      {nextPendingAssignment.deliveryStatus === 'failed'
                        ? 'Failed — Safe to Retry'
                        : nextPendingAssignment.status === 'approved'
                        ? 'Scheduled for Delivery'
                        : 'Draft Pending Review'}
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: '#ffffff', fontWeight: 600 }}>All Scheduled Sections Delivered</span>
                  )}
                </div>

                {nextPendingAssignment ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Section: </span>
                        <strong>
                          Day {nextPendingAssignment.dayNumber}
                          {nextPendingAssignment.sectionNumber ? ` · Part ${nextPendingAssignment.sectionNumber}` : ''}
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Pages: </span>
                        <strong>
                          pp. {nextPendingAssignment.startPdfPage}–{nextPendingAssignment.endPdfPage}
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>Scheduled: </span>
                        <strong>
                          {nextPendingAssignment.scheduledDate} at {nextPendingAssignment.postingTime || book.postingTime}
                        </strong>
                      </div>
                    </div>

                    {(() => {
                      const desc = describeScheduleRemaining(
                        nextPendingAssignment.postingTime || book.postingTime,
                        nextPendingAssignment.scheduledDate,
                        book.timezone
                      );
                      return (
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 12,
                            padding: '6px 10px',
                            borderRadius: 8,
                            background: 'rgba(255, 255, 255, 0.08)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            color: '#ffffff',
                          }}
                        >
                          <Clock size={13} style={{ flexShrink: 0 }} />
                          <span>
                            <strong>Countdown to delivery:</strong> {desc.remainingText}
                          </span>
                        </div>
                      );
                    })()}

                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      <strong>Concepts: </strong>
                      {nextPendingAssignment.concepts.map(c => c.title).join(', ') || 'Core Reading Section'}
                    </div>

                    {nextPendingAssignment.lastDeliveryError && (
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          background: 'rgba(255, 255, 255, 0.08)',
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid rgba(255, 255, 255, 0.25)',
                        }}
                      >
                        Last Error: {nextPendingAssignment.lastDeliveryError}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                      <button
                        type="button"
                        className="v-pill-btn v-pill-btn-accent"
                        disabled={sendingAssignmentId === nextPendingAssignment.id}
                        onClick={() => void handleSendNowInternal(nextPendingAssignment)}
                        style={{
                          padding: '8px 16px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontWeight: 600,
                        }}
                      >
                        {sendingAssignmentId === nextPendingAssignment.id ? (
                          <>
                            <Loader2 size={14} style={{ animation: 'sams-action-spin .8s linear infinite' }} />
                            <span>Sending to Telegram…</span>
                          </>
                        ) : (
                          <>
                            <Send size={14} />
                            <span>Send Now (Override Time)</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                    Great job! Every section in the current reading plan has been dispatched to Telegram.
                  </p>
                )}
              </div>

              {/* Extraction & Health Audit Card */}
              <div
                className="v-card"
                style={{
                  padding: 16,
                  borderRadius: 14,
                  background: 'var(--v-glass-bg-subtle)',
                  border: '1px solid var(--v-glass-border)',
                  display: 'grid',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileCheck2 size={16} color="var(--text-primary)" />
                  <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>Extraction & Content Health Audit</strong>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    • Total Extracted: <strong>{extractedCount} / {totalSelectedPages} pages</strong>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    • Empty/Unreadable Pages:{' '}
                    <strong>{emptyPages.length === 0 ? 'None (Clean)' : `${emptyPages.length} pages`}</strong>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    • OCR Needs Review:{' '}
                    <strong>{unreviewedOcrPages.length === 0 ? '0 pages' : `${unreviewedOcrPages.length} pages`}</strong>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    • Missing Range Pages:{' '}
                    <strong>{missingPageNumbers.length === 0 ? 'None' : `${missingPageNumbers.length} pages`}</strong>
                  </div>
                </div>

                {(emptyPages.length > 0 || unreviewedOcrPages.length > 0) && (
                  <div
                    style={{
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      color: '#ffffff',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <span>
                      ⚠️ Notice: {emptyPages.length} empty or {unreviewedOcrPages.length} OCR pages need inspection. You can view
                      and correct their text directly in the <strong>Extracted Pages</strong> tab.
                    </span>
                    <button
                      type="button"
                      className="v-pill-btn"
                      onClick={() => setActiveTab('pages')}
                      style={{ padding: '4px 10px', fontSize: 11 }}
                    >
                      Go to Extracted Pages →
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              TAB 2: EXTRACTED PAGES INSPECTOR & INLINE EDITOR
             ═══════════════════════════════════════════════════════════════ */}
          {activeTab === 'pages' && (
            <div style={{ display: 'grid', gap: 16 }}>
              {/* Header and Controls */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                  borderBottom: '1px solid var(--v-glass-border)',
                  paddingBottom: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Filter:</label>
                  <select
                    value={pageFilter}
                    onChange={e => setPageFilter(e.target.value as any)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--v-glass-border)',
                      background: 'var(--v-glass-bg-subtle)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                    }}
                  >
                    <option value="all">All Extracted Pages ({pages.length})</option>
                    <option value="needs_review">Needs Review / Warnings ({unreviewedOcrPages.length})</option>
                    <option value="empty">Empty / No Text ({emptyPages.length})</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Jump to page:</label>
                  <select
                    value={selectedPageNum}
                    onChange={e => setSelectedPageNum(Number(e.target.value))}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--v-glass-border)',
                      background: 'var(--v-glass-bg-subtle)',
                      color: 'var(--text-primary)',
                      fontSize: 12,
                    }}
                  >
                    {filteredPages.map(p => (
                      <option key={p.pdfPage} value={p.pdfPage}>
                        Page {p.pdfPage} ({p.method === 'ocr' ? 'OCR' : p.method === 'empty' ? 'Empty' : 'Native'})
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="v-pill-btn"
                    disabled={loadingPages}
                    onClick={() => void loadPages()}
                    style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                    title="Reload extracted pages"
                  >
                    <RefreshCw size={12} style={{ animation: loadingPages ? 'sams-action-spin .8s linear infinite' : 'none' }} />
                    <span style={{ fontSize: 12 }}>Reload</span>
                  </button>
                </div>
              </div>

              {/* Inspector Content */}
              {loadingPages && pages.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  <Loader2 size={24} style={{ animation: 'sams-action-spin .8s linear infinite', margin: '0 auto 8px' }} />
                  <div>Loading extracted pages from database…</div>
                </div>
              ) : pages.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                  No extracted pages found. Please run PDF extraction first.
                </div>
              ) : (() => {
                const currentPageRecord = pages.find(p => p.pdfPage === selectedPageNum);
                if (!currentPageRecord) {
                  return (
                    <div style={{ color: 'var(--text-muted)' }}>
                      Selected page {selectedPageNum} not found in the filtered list.
                    </div>
                  );
                }

                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
                    {/* Left/Main Column: Text Editor & Metadata */}
                    <div style={{ display: 'grid', gap: 12 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                      >
                        <div>
                          <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                            Original PDF Page {currentPageRecord.pdfPage}
                          </strong>
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 11,
                              padding: '2px 8px',
                              borderRadius: 6,
                              background: 'rgba(255, 255, 255, 0.1)',
                              color: '#ffffff',
                            }}
                          >
                            {currentPageRecord.method.toUpperCase()}
                            {currentPageRecord.confidence !== null ? ` (${currentPageRecord.confidence.toFixed(1)}%)` : ''}
                          </span>
                          {currentPageRecord.reviewedByUser && (
                            <span style={{ marginLeft: 6, fontSize: 11, color: '#ffffff' }}>✓ Reviewed</span>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: 6 }}>
                          {currentPageRecord.requiresReview && !currentPageRecord.reviewedByUser && (
                            <button
                              type="button"
                              className="v-pill-btn"
                              onClick={() => void handleMarkReviewed()}
                              style={{ padding: '6px 10px', fontSize: 12, color: '#ffffff' }}
                            >
                              ✓ Verify Page
                            </button>
                          )}
                          <button
                            type="button"
                            className="v-pill-btn"
                            disabled={savingPage || loadingSinglePage}
                            onClick={() => void handleSavePageText()}
                            style={{
                              padding: '6px 12px',
                              fontSize: 12,
                              fontWeight: 600,
                              background: 'rgba(255, 255, 255, 0.15)',
                              borderColor: 'rgba(255, 255, 255, 0.35)',
                              color: '#ffffff',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            {savingPage ? <Loader2 size={13} style={{ animation: 'sams-action-spin .8s linear infinite' }} /> : <Save size={13} />}
                            <span>Save Corrected Text</span>
                          </button>
                        </div>
                      </div>

                      {/* Warnings */}
                      {currentPageRecord.warnings.map(w => (
                        <div
                          key={w}
                          style={{
                            fontSize: 12,
                            color: '#ffffff',
                            background: 'rgba(255, 255, 255, 0.08)',
                            padding: '6px 10px',
                            borderRadius: 8,
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                          }}
                        >
                          ⚠️ {w}
                        </div>
                      ))}

                      {/* Editable Text Area */}
                      <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>Extracted Page Text (Editable — Corrections are saved to DB):</span>
                          {loadingSinglePage && (
                            <span style={{ fontSize: 11, color: '#ffffff', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Loader2 size={11} style={{ animation: 'sams-action-spin .8s linear infinite' }} /> Loading page text…
                            </span>
                          )}
                        </div>
                        <textarea
                          value={loadingSinglePage ? 'Loading page text…' : editedText}
                          disabled={loadingSinglePage}
                          onChange={e => setEditedText(e.target.value)}
                          rows={16}
                          style={{
                            width: '100%',
                            minHeight: 280,
                            borderRadius: 12,
                            border: '1px solid var(--v-glass-border)',
                            padding: '10px 12px',
                            background: 'var(--v-glass-bg-subtle)',
                            color: 'var(--text-primary)',
                            fontFamily: 'ui-monospace, Consolas, monospace',
                            fontSize: 13,
                            lineHeight: 1.6,
                            resize: 'vertical',
                            opacity: loadingSinglePage ? 0.6 : 1,
                          }}
                        />
                      </label>
                    </div>

                    {/* Right Column: Visual Preview (Thumbnail/Full Image) */}
                    <div
                      style={{
                        display: 'grid',
                        gap: 8,
                        alignContent: 'start',
                        borderLeft: '1px solid var(--v-glass-border)',
                        paddingLeft: 16,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                          Original PDF Visual Page Preview
                        </div>
                        {previewLoading && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Loader2 size={11} style={{ animation: 'sams-action-spin .8s linear infinite' }} /> Rendering…
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          borderRadius: 10,
                          overflow: 'hidden',
                          border: '1px solid var(--v-glass-border)',
                          background: previewUrl ? '#ffffff' : 'rgba(0,0,0,0.2)',
                          minHeight: 280,
                          maxHeight: 520,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {previewLoading ? (
                          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                            <Loader2 size={24} style={{ animation: 'sams-action-spin .8s linear infinite', margin: '0 auto 8px' }} />
                            <div style={{ fontSize: 12 }}>Rendering original PDF page view…</div>
                          </div>
                        ) : previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={`Preview page ${selectedPageNum}`}
                            style={{
                              width: '100%',
                              height: 'auto',
                              maxHeight: 520,
                              objectFit: 'contain',
                              display: 'block',
                            }}
                          />
                        ) : (
                          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                            <p style={{ margin: '0 0 10px', fontSize: 12 }}>No page preview rendered yet.</p>
                            <button
                              type="button"
                              className="v-pill-btn"
                              onClick={() => void loadPreviewImage(selectedPageNum)}
                              style={{ padding: '6px 12px', fontSize: 12 }}
                            >
                              Render Page View
                            </button>
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Compare original layout, diagrams, or typography against the extracted text on the left.
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              TAB 3: REVIEW & EDIT READING PLAN + MULTI-SECTIONS
             ═══════════════════════════════════════════════════════════════ */}
          {activeTab === 'schedule' && (
            <div style={{ display: 'grid', gap: 18 }}>
              {/* Flexible Configuration Bar */}
              <div
                className="v-card"
                style={{
                  padding: 16,
                  borderRadius: 14,
                  background: 'var(--v-glass-bg-subtle)',
                  border: '1px solid var(--v-glass-border)',
                  display: 'grid',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Layers size={16} color="var(--accent-color, #ffffff)" />
                  <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                    Flexible Daily Reading Plan Configuration
                  </strong>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                      Sections per day:
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {[1, 2, 3, 4].map(num => (
                        <button
                          key={num}
                          type="button"
                          className="v-pill-btn"
                          onClick={() => handleSectionsPerDayChange(num)}
                          style={{
                            flex: 1,
                            padding: '6px 12px',
                            fontWeight: sectionsPerDay === num ? 700 : 400,
                            background: sectionsPerDay === num ? 'rgba(255, 255, 255, 0.15)' : undefined,
                            borderColor: sectionsPerDay === num ? '#ffffff' : undefined,
                            color: sectionsPerDay === num ? '#ffffff' : undefined,
                          }}
                        >
                          {num} {num === 1 ? 'part' : 'parts'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                      Individual Delivery Times:
                    </label>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {Array.from({ length: sectionsPerDay }).map((_, idx) => (
                        <input
                          key={idx}
                          type="time"
                          value={postingTimes[idx] || '08:00'}
                          onChange={e => {
                            const next = [...postingTimes];
                            next[idx] = e.target.value;
                            setPostingTimes(next);
                          }}
                          style={{
                            padding: '6px 8px',
                            borderRadius: 8,
                            border: '1px solid var(--v-glass-border)',
                            background: 'var(--v-glass-bg-subtle)',
                            color: 'var(--text-primary)',
                            fontSize: 12,
                          }}
                        />
                      ))}
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {Array.from({ length: sectionsPerDay }).map((_, idx) => {
                        const time = postingTimes[idx] || '08:00';
                        const desc = describeScheduleRemaining(time, null, book.timezone);
                        return (
                          <span
                            key={idx}
                            style={{
                              fontSize: 11,
                              padding: '2px 7px',
                              borderRadius: 6,
                              background: 'rgba(255, 255, 255, 0.08)',
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              color: '#ffffff',
                            }}
                          >
                            Part {idx + 1} ({time}): {desc.remainingText}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Already delivered sections will remain untouched. Only uncompleted pages will be re-partitioned.
                  </span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      className="v-pill-btn"
                      disabled={regeneratingPlan}
                      onClick={() => void handleRegeneratePlan()}
                      style={{
                        padding: '8px 16px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: 'rgba(255, 255, 255, 0.15)',
                        borderColor: 'rgba(255, 255, 255, 0.35)',
                        color: '#ffffff',
                        fontWeight: 600,
                      }}
                    >
                      {regeneratingPlan ? (
                        <Loader2 size={14} style={{ animation: 'sams-action-spin .8s linear infinite' }} />
                      ) : (
                        <Sparkles size={14} />
                      )}
                      <span>{regeneratingPlan ? 'Generating Concept Plan…' : 'Regenerate Flexible Reading Plan'}</span>
                    </button>
                    {regeneratingPlan && (
                      <button
                        type="button"
                        className="v-pill-btn"
                        onClick={handleCancelPlanRegeneration}
                        style={{
                          padding: '8px 14px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          background: 'rgba(255, 255, 255, 0.08)',
                          borderColor: 'rgba(255, 255, 255, 0.25)',
                          color: 'var(--text-secondary)',
                          fontWeight: 600,
                        }}
                      >
                        <X size={14} />
                        <span>Cancel</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Schedule List */}
              <div style={{ display: 'grid', gap: 10 }}>
                {assignments.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    No reading sections generated yet. Click “Regenerate Flexible Reading Plan” above to create one.
                  </div>
                ) : (
                  assignments.map(assignment => {
                    const isDelivered = assignment.status === 'completed';
                    const isEditing = editingAssignmentId === assignment.id;

                    return (
                      <div
                        key={assignment.id}
                        className="v-card"
                        style={{
                          padding: 14,
                          borderRadius: 12,
                          border: '1px solid var(--v-glass-border)',
                          background: isDelivered ? 'rgba(255, 255, 255, 0.04)' : 'var(--v-glass-bg-subtle)',
                          display: 'grid',
                          gap: 10,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                              Day {assignment.dayNumber}
                              {assignment.sectionNumber ? ` · Part ${assignment.sectionNumber}` : ''}
                            </strong>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              ({assignment.scheduledDate} · {assignment.postingTime || book.postingTime})
                            </span>
                            <span style={{ fontSize: 12, color: '#ffffff', fontWeight: 600 }}>
                              pp. {assignment.startPdfPage}–{assignment.endPdfPage}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                fontSize: 11,
                                padding: '2px 8px',
                                borderRadius: 6,
                                fontWeight: 600,
                                background: 'rgba(255, 255, 255, 0.1)',
                                color: '#ffffff',
                              }}
                            >
                              {isDelivered ? 'Delivered' : assignment.status.toUpperCase()}
                            </span>

                            {!isDelivered && !isEditing && (
                              <button
                                type="button"
                                className="v-pill-btn"
                                onClick={() => handleBeginEditAssignment(assignment)}
                                style={{ padding: '4px 8px', fontSize: 11, display: 'inline-flex', gap: 4, alignItems: 'center' }}
                              >
                                <Edit3 size={12} /> Edit
                              </button>
                            )}

                            <button
                              type="button"
                              className="v-pill-btn"
                              onClick={() => {
                                setSelectedQuizAssignmentId(assignment.id);
                                setActiveTab('quiz');
                              }}
                              style={{ padding: '5px 10px', fontSize: 11, display: 'inline-flex', gap: 4, alignItems: 'center' }}
                              title="Open interactive quiz for this section"
                            >
                              <HelpCircle size={12} /> Quiz
                            </button>

                            <button
                              type="button"
                              className={`v-pill-btn ${isDelivered ? 'v-pill-btn-success' : 'v-pill-btn-accent'}`}
                              disabled={sendingAssignmentId === assignment.id}
                              onClick={() => void handleSendNowInternal(assignment)}
                              style={{
                                padding: '5px 12px',
                                fontSize: 11,
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                              }}
                            >
                              {sendingAssignmentId === assignment.id ? (
                                <Loader2 size={12} style={{ animation: 'sams-action-spin .8s linear infinite' }} />
                              ) : isDelivered ? (
                                <CheckCircle2 size={12} />
                              ) : (
                                <Send size={12} />
                              )}
                              <span>{isDelivered ? 'Resend' : 'Send Now'}</span>
                            </button>
                          </div>
                        </div>

                        {/* Inline Section Editor */}
                        {isEditing ? (
                          <div
                            style={{
                              padding: 12,
                              borderRadius: 10,
                              background: 'rgba(0,0,0,0.25)',
                              border: '1px solid var(--v-glass-border)',
                              display: 'grid',
                              gap: 10,
                            }}
                          >
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'grid', gap: 4 }}>
                                Scheduled Date:
                                <input
                                  type="date"
                                  value={assignmentDraft.scheduledDate || ''}
                                  onChange={e => setAssignmentDraft(c => ({ ...c, scheduledDate: e.target.value }))}
                                  style={{
                                    padding: '5px 8px',
                                    borderRadius: 6,
                                    border: '1px solid var(--v-glass-border)',
                                    background: 'var(--v-glass-bg-subtle)',
                                    color: 'var(--text-primary)',
                                    fontSize: 12,
                                  }}
                                />
                              </label>

                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'grid', gap: 4 }}>
                                Posting Time:
                                <input
                                  type="time"
                                  value={assignmentDraft.postingTime || ''}
                                  onChange={e => setAssignmentDraft(c => ({ ...c, postingTime: e.target.value }))}
                                  style={{
                                    padding: '5px 8px',
                                    borderRadius: 6,
                                    border: '1px solid var(--v-glass-border)',
                                    background: 'var(--v-glass-bg-subtle)',
                                    color: 'var(--text-primary)',
                                    fontSize: 12,
                                  }}
                                />
                              </label>

                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'grid', gap: 4 }}>
                                Start Page:
                                <input
                                  type="number"
                                  min={book.startPage}
                                  max={book.endPage}
                                  value={assignmentDraft.startPdfPage ?? assignment.startPdfPage}
                                  onChange={e => setAssignmentDraft(c => ({ ...c, startPdfPage: Number(e.target.value) }))}
                                  style={{
                                    padding: '5px 8px',
                                    borderRadius: 6,
                                    border: '1px solid var(--v-glass-border)',
                                    background: 'var(--v-glass-bg-subtle)',
                                    color: 'var(--text-primary)',
                                    fontSize: 12,
                                  }}
                                />
                              </label>

                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'grid', gap: 4 }}>
                                End Page:
                                <input
                                  type="number"
                                  min={book.startPage}
                                  max={book.endPage}
                                  value={assignmentDraft.endPdfPage ?? assignment.endPdfPage}
                                  onChange={e => setAssignmentDraft(c => ({ ...c, endPdfPage: Number(e.target.value) }))}
                                  style={{
                                    padding: '5px 8px',
                                    borderRadius: 6,
                                    border: '1px solid var(--v-glass-border)',
                                    background: 'var(--v-glass-bg-subtle)',
                                    color: 'var(--text-primary)',
                                    fontSize: 12,
                                  }}
                                />
                              </label>
                            </div>

                            {assignmentDraft.postingTime && (
                              <div
                                style={{
                                  fontSize: 11,
                                  padding: '5px 10px',
                                  borderRadius: 6,
                                  background: 'rgba(255, 255, 255, 0.08)',
                                  border: '1px solid rgba(255, 255, 255, 0.2)',
                                  color: '#ffffff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                }}
                              >
                                <Clock size={12} style={{ flexShrink: 0 }} />
                                <span>
                                  <strong>Estimated delivery:</strong>{' '}
                                  {
                                    describeScheduleRemaining(
                                      assignmentDraft.postingTime,
                                      assignmentDraft.scheduledDate || assignment.scheduledDate,
                                      book.timezone
                                    ).remainingText
                                  }
                                </span>
                              </div>
                            )}

                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="v-pill-btn"
                                onClick={() => setEditingAssignmentId(null)}
                                style={{ padding: '5px 12px', fontSize: 12 }}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="v-pill-btn"
                                disabled={savingAssignmentId === assignment.id}
                                onClick={() => void handleSaveAssignmentEdit(assignment.id)}
                                style={{
                                  padding: '5px 14px',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  background: 'rgba(255, 255, 255, 0.15)',
                                  borderColor: 'rgba(255, 255, 255, 0.35)',
                                  color: '#ffffff',
                                }}
                              >
                                {savingAssignmentId === assignment.id ? 'Saving…' : 'Save Section'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {assignment.concepts.map((c, i) => (
                              <span key={i}>
                                <strong>{c.title}:</strong> {c.concept}{' '}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === 'quiz' && (
            <div style={{ display: 'grid', gap: 20 }}>
              {/* Assignment Switcher & Controls */}
              <div
                className="v-card"
                style={{
                  padding: 16,
                  borderRadius: 12,
                  border: '1px solid var(--v-glass-border)',
                  background: 'var(--v-glass-bg-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <label htmlFor="quiz-assignment-select" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    Reading Section:
                  </label>
                  <select
                    id="quiz-assignment-select"
                    value={selectedQuizAssignmentId}
                    onChange={e => setSelectedQuizAssignmentId(e.target.value)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--v-glass-border)',
                      color: 'var(--text-primary)',
                      fontSize: 13,
                    }}
                  >
                    {assignments.map(a => (
                      <option key={a.id} value={a.id} style={{ background: '#18181b', color: '#ffffff' }}>
                        Day {a.dayNumber} (PDF pp. {a.startPdfPage}–{a.endPdfPage}) {a.status === 'completed' ? '✓ Delivered' : `(${a.scheduledDate})`}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="v-pill-btn"
                    disabled={regeneratingSummary || loadingQuiz}
                    onClick={() => void handleRegenerateSummaryOnly()}
                    style={{ padding: '6px 12px', fontSize: 11, display: 'inline-flex', gap: 5, alignItems: 'center' }}
                    title="Regenerate only this section's summary without affecting the quiz"
                  >
                    <RefreshCw size={12} style={{ animation: regeneratingSummary ? 'sams-action-spin .8s linear infinite' : 'none' }} />
                    <span>{regeneratingSummary ? 'Regenerating…' : 'Regenerate Summary Only'}</span>
                  </button>

                  <button
                    type="button"
                    className="v-pill-btn v-pill-btn-accent"
                    disabled={regeneratingQuiz || loadingQuiz}
                    onClick={() => void handleRegenerateQuizOnly()}
                    style={{ padding: '6px 12px', fontSize: 11, display: 'inline-flex', gap: 5, alignItems: 'center', fontWeight: 600 }}
                    title="Regenerate only the quiz questions without affecting the summary"
                  >
                    <Sparkles size={12} style={{ animation: regeneratingQuiz ? 'sams-action-spin .8s linear infinite' : 'none' }} />
                    <span>{regeneratingQuiz ? 'Regenerating…' : 'Regenerate Quiz Only'}</span>
                  </button>
                </div>
              </div>

              {loadingQuiz ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  <Loader2 size={24} style={{ animation: 'sams-action-spin .8s linear infinite', margin: '0 auto 12px auto' }} />
                  <p style={{ margin: 0, fontSize: 13 }}>Loading reading concepts, summary, and quiz questions…</p>
                </div>
              ) : (
                <>
                  {/* Summary & Core Concepts Card */}
                  {learningPackage?.summary && (
                    <div
                      className="v-card"
                      style={{
                        padding: 18,
                        borderRadius: 14,
                        border: '1px solid var(--v-glass-border)',
                        background: 'var(--v-glass-bg-subtle)',
                        display: 'grid',
                        gap: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ffffff', fontWeight: 600, fontSize: 14 }}>
                        <BookOpen size={16} />
                        <span>Section Summary & Conceptual Breakdown</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                        {learningPackage.summary}
                      </div>
                      {learningPackage.keyConcepts && learningPackage.keyConcepts.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
                          {learningPackage.keyConcepts.map((c, i) => (
                            <span
                              key={i}
                              style={{
                                fontSize: 11,
                                padding: '3px 8px',
                                borderRadius: 6,
                                background: 'rgba(255, 255, 255, 0.08)',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                color: '#ffffff',
                                fontWeight: 500,
                              }}
                            >
                              • {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Real-Life Examples Card */}
                  {learningPackage?.realLifeExamples && learningPackage.realLifeExamples.length > 0 && (
                    <div
                      className="v-card"
                      style={{
                        padding: 18,
                        borderRadius: 14,
                        border: '1px solid var(--v-glass-border)',
                        background: 'var(--v-glass-bg-subtle)',
                        display: 'grid',
                        gap: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ffffff', fontWeight: 600, fontSize: 14 }}>
                        <Sparkles size={16} />
                        <span>Real-Life Examples & Verified Sources</span>
                      </div>
                      <div style={{ display: 'grid', gap: 12 }}>
                        {learningPackage.realLifeExamples.map((ex, i) => (
                          <div
                            key={i}
                            style={{
                              padding: 12,
                              borderRadius: 10,
                              background: 'rgba(255, 255, 255, 0.03)',
                              border: '1px solid var(--v-glass-border)',
                              display: 'grid',
                              gap: 6,
                              fontSize: 13,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                              <strong style={{ color: 'var(--text-primary)' }}>{ex.title}</strong>
                              {ex.sourceUrl && (
                                <a
                                  href={ex.sourceUrl.startsWith('http') ? ex.sourceUrl : undefined}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    fontSize: 11,
                                    color: 'var(--accent-color, #ffffff)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                    textDecoration: 'none',
                                  }}
                                >
                                  <span>{ex.sourceTitle}</span>
                                  {ex.sourceUrl.startsWith('http') && <ExternalLink size={11} />}
                                </a>
                              )}
                            </div>
                            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.45 }}>{ex.situation}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              <strong>Connection: </strong>{ex.connection}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Dedicated Interactive Quiz Card */}
                  <InteractiveQuizCard
                    questions={quizQuestions}
                    bookTitle={book.title}
                    assignmentTitle={(() => {
                      const cur = assignments.find(a => a.id === selectedQuizAssignmentId);
                      return cur ? `Day ${cur.dayNumber} (PDF pp. ${cur.startPdfPage}–${cur.endPdfPage})` : '';
                    })()}
                    onRegenerateQuiz={handleRegenerateQuizOnly}
                    isRegenerating={regeneratingQuiz}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
