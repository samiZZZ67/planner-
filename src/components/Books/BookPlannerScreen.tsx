'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, BookOpen, Brain, CheckCircle2, ChevronDown, ChevronUp, Clock3, Eye, FileText, FileUp, HelpCircle, LoaderCircle, LockKeyhole, Pencil, Save, Send, Trash2, TriangleAlert, X } from 'lucide-react';
import { apiFetch } from '@/lib/api/apiClient';
import { notifyFeedback } from '@/lib/utils/actionFeedback';
import { BookAnalyticsModal } from './BookAnalyticsModal';
import { BookReviewModal } from './BookReviewModal';
import { LiveBookDeliveryCountdown } from './LiveBookDeliveryCountdown';
import { describeScheduleRemaining } from '@/lib/date/bookDeliverySchedule';
import type { BookAssignmentRecord, BookPageRecord, BookRecord, BookStudyNotes } from '@/lib/books/types';

const fieldStyle: React.CSSProperties = { display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 13 };
const inputStyle: React.CSSProperties = { width: '100%', minHeight: 42, borderRadius: 12, border: '1px solid var(--v-glass-border)', padding: '9px 12px', background: 'var(--v-glass-bg-subtle)', color: 'var(--text-primary)' };

interface AssignmentDetail {
  book: { title: string; author: string };
  assignment: BookAssignmentRecord;
  originalPages: BookPageRecord[];
}

function SendNowButton({
  assignment,
  sending,
  onSend,
}: {
  assignment: BookAssignmentRecord;
  sending: boolean;
  onSend: () => void;
}) {
  const isDelivered = assignment.status === 'completed';
  return (
    <button
      type="button"
      className={`v-pill-btn ${isDelivered ? 'v-pill-btn-success' : 'v-pill-btn-accent'}`}
      disabled={sending}
      onClick={onSend}
      style={{
        padding: '7px 14px',
        minHeight: 34,
        fontSize: 12,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontWeight: 600,
        cursor: sending ? 'wait' : 'pointer',
      }}
      title={
        isDelivered
          ? 'Section already delivered to Telegram. Click to send again.'
          : 'Immediately dispatch this reading section to your Telegram channel regardless of scheduled time'
      }
    >
      {sending ? (
        <>
          <LoaderCircle size={14} style={{ animation: 'sams-action-spin .8s linear infinite' }} />
          <span>Sending to Telegram…</span>
        </>
      ) : isDelivered ? (
        <>
          <CheckCircle2 size={14} />
          <span>Sent to Telegram · Resend</span>
        </>
      ) : (
        <>
          <Send size={14} />
          <span>Send Now</span>
        </>
      )}
    </button>
  );
}

interface BookPlannerScreenProps {
  initialQuizAssignmentId?: string;
}

export function BookPlannerScreen({ initialQuizAssignmentId }: BookPlannerScreenProps = {}) {
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [generatingPlanBookId, setGeneratingPlanBookId] = useState<string | null>(null);
  const [loadingAssignmentsBookId, setLoadingAssignmentsBookId] = useState<string | null>(null);
  const [generatingNotesAssignmentId, setGeneratingNotesAssignmentId] = useState<string | null>(null);
  const [savingNotesAssignmentId, setSavingNotesAssignmentId] = useState<string | null>(null);
  const [savingBookEditId, setSavingBookEditId] = useState<string | null>(null);
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null);
  const [loadingPreviewsBookId, setLoadingPreviewsBookId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [startPage, setStartPage] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [addPostingTime, setAddPostingTime] = useState('08:00');
  const [addTimezone, setAddTimezone] = useState('Africa/Addis_Ababa');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [sendingAssignmentId, setSendingAssignmentId] = useState<string | null>(null);
  const [pagesByBook, setPagesByBook] = useState<Record<string, BookPageRecord[]>>({});
  const [assignmentsByBook, setAssignmentsByBook] = useState<Record<string, BookAssignmentRecord[]>>({});
  const [assignmentDetails, setAssignmentDetails] = useState<Record<string, AssignmentDetail>>({});
  const [notesDrafts, setNotesDrafts] = useState<Record<string, BookStudyNotes>>({});
  const [collapsedBooks, setCollapsedBooks] = useState<Set<string>>(new Set());
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [bookDraft, setBookDraft] = useState<Partial<BookRecord>>({});
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const previewUrlsRef = useRef<Record<string, string>>({});
  const extractAbortRef = useRef<AbortController | null>(null);
  const planAbortRef = useRef<AbortController | null>(null);
  const [baModalBook, setBaModalBook] = useState<BookRecord | null>(null);
  const [baModalTab, setBaModalTab] = useState<'overview' | 'pages' | 'schedule' | 'quiz'>('overview');
  const [targetQuizAssignmentId, setTargetQuizAssignmentId] = useState<string | null>(initialQuizAssignmentId || null);
  const [reviewModalBook, setReviewModalBook] = useState<BookRecord | null>(null);

  // Auto-launch quiz modal when accessed via deep link or Telegram quiz parameter
  useEffect(() => {
    const quizId = targetQuizAssignmentId || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('quiz') : null);
    if (!quizId) return;

    let cancelled = false;
    apiFetch(`/api/books/assignment-lookup?assignmentId=${encodeURIComponent(quizId)}`)
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        if (data.ok && data.book) {
          setBooks(curr => {
            const exists = curr.some(b => b.id === data.book.id);
            return exists ? curr : [data.book, ...curr];
          });
          if (data.assignments) {
            setAssignmentsByBook(curr => ({ ...curr, [data.book.id]: data.assignments }));
          }
          setBaModalBook(data.book);
          setBaModalTab('quiz');
          setTargetQuizAssignmentId(quizId);
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [targetQuizAssignmentId]);

  const openBookAnalytics = useCallback(async (book: BookRecord, tab: 'overview' | 'pages' | 'schedule' | 'quiz' = 'overview') => {
    setBaModalBook(book);
    setBaModalTab(tab);
    if (!assignmentsByBook[book.id]) {
      try {
        const response = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/assignments`);
        const data = await response.json();
        if (response.ok && data.assignments) {
          setAssignmentsByBook(current => ({ ...current, [book.id]: data.assignments }));
        }
      } catch {}
    }
  }, [assignmentsByBook]);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    notifyFeedback('success', msg);
  }, []);

  const showError = useCallback((msg: string) => {
    setError(msg);
    notifyFeedback('error', msg);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => { previewUrlsRef.current = previewUrls; }, [previewUrls]);
  useEffect(() => () => {
    Object.values(previewUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
    extractAbortRef.current?.abort();
    planAbortRef.current?.abort();
  }, []);

  function cancelExtraction() {
    if (extractAbortRef.current) {
      extractAbortRef.current.abort();
      extractAbortRef.current = null;
    }
    setProcessingId(null);
    showNotice('PDF extraction cancelled by user.');
  }

  function cancelPlanGeneration() {
    if (planAbortRef.current) {
      planAbortRef.current.abort();
      planAbortRef.current = null;
    }
    setGeneratingPlanBookId(null);
    showNotice('Plan generation cancelled by user.');
  }

  async function loadPagePreviews(bookId: string, pages: BookPageRecord[]) {
    const entries = await Promise.all(pages.filter(page => page.visualPreview).map(async page => {
      const response = await apiFetch(`/api/books/${encodeURIComponent(bookId)}/pages/${page.pdfPage}/preview`);
      if (!response.ok) return null;
      return [`${bookId}:${page.pdfPage}`, URL.createObjectURL(await response.blob())] as const;
    }));
    const next = Object.fromEntries(entries.filter((item): item is NonNullable<typeof item> => item !== null));
    setPreviewUrls(current => {
      Object.keys(next).forEach(key => { if (current[key]) URL.revokeObjectURL(current[key]); });
      return { ...current, ...next };
    });
  }

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch('/api/books');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load books.');
      const loadedBooks: BookRecord[] = data.books || [];
      setBooks(loadedBooks);
      // Fetch assignments for active/completed books so the countdown timer immediately resolves the next delivery
      for (const b of loadedBooks) {
        if (b.extractionStatus === 'completed' || b.automationStatus === 'ready') {
          void apiFetch(`/api/books/${encodeURIComponent(b.id)}/assignments`)
            .then(res => res.json())
            .then(aData => {
              if (aData.assignments) {
                setAssignmentsByBook(current => ({ ...current, [b.id]: aData.assignments }));
              }
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load books.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const automationPending = books.some(book => book.autoPublish !== false && (book.automationStatus === 'queued' || book.automationStatus === 'processing' || (!book.automationStatus && book.extractionStatus !== 'completed')));
  useEffect(() => {
    if (!automationPending) return;
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [automationPending, refresh]);
  useEffect(() => {
    if (!processingId) return;
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => window.clearInterval(timer);
  }, [processingId, refresh]);

  async function extractBook(book: BookRecord) {
    if (extractAbortRef.current) {
      extractAbortRef.current.abort();
    }
    const controller = new AbortController();
    extractAbortRef.current = controller;
    setError('');
    setNotice('');
    setProcessingId(book.id);
    try {
      let currentBook = book;
      let isComplete = false;
      let batchNum = 1;
      while (!isComplete) {
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        setBooks(current => current.map(item => item.id === book.id ? {
          ...item,
          status: 'processing',
          extractionStatus: 'processing',
          extractionMessage: `Extracting batch ${batchNum}...`,
        } : item));

        const response = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchSize: 25, force: batchNum > 1 }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'PDF extraction failed.');
        currentBook = data.book;
        setBooks(current => current.map(item => item.id === book.id ? currentBook : item));
        setBaModalBook(current => current && current.id === book.id ? currentBook : current);
        setReviewModalBook(current => current && current.id === book.id ? currentBook : current);
        isComplete = Boolean(data.isComplete);
        batchNum++;
      }
      showNotice(currentBook.extractionMessage || 'PDF extraction complete.');
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        showNotice('PDF extraction cancelled.');
      } else {
        showError(err instanceof Error ? err.message : 'PDF extraction failed.');
      }
      await refresh();
    } finally {
      if (extractAbortRef.current === controller) {
        extractAbortRef.current = null;
        setProcessingId(null);
      }
    }
  }

  async function previewPages(book: BookRecord) {
    setError('');
    setLoadingPreviewsBookId(book.id);
    try {
      const response = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/pages?all=true&from=${book.startPage}&to=${book.endPage}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not retrieve extracted pages.');
      setPagesByBook(current => ({ ...current, [book.id]: data.pages || [] }));
      await loadPagePreviews(book.id, data.pages || []);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not retrieve extracted pages.');
    } finally {
      setLoadingPreviewsBookId(null);
    }
  }

  async function markPageReviewed(book: BookRecord, pdfPage: number) {
    setError('');
    try {
      const response = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/pages/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdfPage }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not record the page review.');
      setBooks(current => current.map(item => item.id === book.id ? data.book : item));
      setPagesByBook(current => ({ ...current, [book.id]: (current[book.id] || []).map(page => page.pdfPage === pdfPage ? data.page : page) }));
      showNotice(`Page ${pdfPage} marked as visually reviewed.`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not record the page review.');
    }
  }

  async function loadAssignments(book: BookRecord) {
    setError('');
    setLoadingAssignmentsBookId(book.id);
    try {
      const response = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/assignments`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load the plan.');
      setAssignmentsByBook(current => ({ ...current, [book.id]: data.assignments || [] }));
      showNotice(`Loaded plan with ${data.assignments?.length || 0} assignments.`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not load the plan.');
    } finally {
      setLoadingAssignmentsBookId(null);
    }
  }

  async function generatePlan(book: BookRecord) {
    if (planAbortRef.current) {
      planAbortRef.current.abort();
    }
    const controller = new AbortController();
    planAbortRef.current = controller;
    setError('');
    setNotice('');
    setGeneratingPlanBookId(book.id);
    try {
      const model = localStorage.getItem('np_freellm_selected_model') || 'auto';
      const response = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Reading plan generation failed.');
      setAssignmentsByBook(current => ({ ...current, [book.id]: data.assignments || [] }));
      showNotice(`Draft plan created with ${data.assignments.length} reading assignments using ${data.model} via ${data.provider}.`);
      if (data.issues?.length) showError(data.issues.join(' '));
      await refresh();
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        showNotice('Reading plan generation cancelled.');
      } else {
        showError(err instanceof Error ? err.message : 'Reading plan generation failed.');
      }
    } finally {
      if (planAbortRef.current === controller) {
        planAbortRef.current = null;
        setGeneratingPlanBookId(null);
      }
    }
  }

  async function openAssignment(book: BookRecord, assignment: BookAssignmentRecord) {
    setError('');
    try {
      const response = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/assignments/${encodeURIComponent(assignment.id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load this assignment.');
      const detail = data as AssignmentDetail;
      setAssignmentDetails(current => ({ ...current, [assignment.id]: detail }));
      await loadPagePreviews(book.id, detail.originalPages || []);
      if (detail.assignment.studyNotes) setNotesDrafts(current => ({ ...current, [assignment.id]: detail.assignment.studyNotes! }));
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not load this assignment.');
    }
  }

  function updateAssignmentState(bookId: string, assignment: BookAssignmentRecord) {
    setAssignmentsByBook(current => ({ ...current, [bookId]: (current[bookId] || []).map(item => item.id === assignment.id ? assignment : item) }));
    setAssignmentDetails(current => current[assignment.id] ? { ...current, [assignment.id]: { ...current[assignment.id], assignment } } : current);
    if (assignment.studyNotes) setNotesDrafts(current => ({ ...current, [assignment.id]: assignment.studyNotes! }));
  }

  async function sendAssignmentNow(book: BookRecord, assignment: BookAssignmentRecord) {
    if (sendingAssignmentId !== null) return;
    setSendingAssignmentId(assignment.id);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/assignments/${encodeURIComponent(assignment.id)}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendNow: true, override: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not send this section to Telegram.');

      updateAssignmentState(book.id, { ...assignment, status: 'completed', deliveryStatus: 'sent', deliveredAt: Date.now() });
      if (data.book) {
        setBooks(current => current.map(item => item.id === book.id ? data.book : item));
        setBaModalBook(current => current && current.id === book.id ? data.book : current);
      }
      const channel = data.channel || data.delivery?.channel || 'Telegram channel';
      const msgIds = data.delivery?.telegramMessageIds?.length
        ? ` (Telegram message ID: ${data.delivery.telegramMessageIds.join(', ')})`
        : '';
      showNotice(`🚀 Sent Day ${assignment.dayNumber} section to ${channel}! Original schedule remains unchanged.${msgIds}`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not send this section to Telegram.');
    } finally {
      setSendingAssignmentId(null);
    }
  }

  async function generateNotes(book: BookRecord, assignment: BookAssignmentRecord) {
    setError('');
    setGeneratingNotesAssignmentId(assignment.id);
    try {
      const model = localStorage.getItem('np_freellm_selected_model') || 'auto';
      const response = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/assignments/${encodeURIComponent(assignment.id)}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Study note generation failed.');
      updateAssignmentState(book.id, data.assignment);
      showNotice(`Study notes generated with ${data.model} via ${data.provider}. Original page text was not sent back as generated text.`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Study note generation failed.');
    } finally {
      setGeneratingNotesAssignmentId(null);
    }
  }

  async function saveNotes(book: BookRecord, assignment: BookAssignmentRecord, status: 'draft' | 'approved') {
    const studyNotes = notesDrafts[assignment.id];
    if (!studyNotes) return;
    setError('');
    setSavingNotesAssignmentId(assignment.id);
    try {
      const response = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/assignments/${encodeURIComponent(assignment.id)}/notes`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, studyNotes }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save study notes.');
      updateAssignmentState(book.id, data.assignment);
      showNotice(status === 'approved' ? `Day ${assignment.dayNumber} is approved and queued for Telegram publishing.` : 'Study-note edits saved as a draft.');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not save study notes.');
    } finally {
      setSavingNotesAssignmentId(null);
    }
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError('');
    setNotice('');
    setIsUploading(true);
    try {
      const form = new FormData(formElement);
      const response = await apiFetch('/api/books', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save this book.');
      setBooks(current => [data.book, ...current]);
      setCollapsedBooks(current => { const next = new Set(current); next.delete(data.book.id); return next; });
      showNotice('PDF saved privately. Automatic extraction, daily study posts, and Telegram scheduling are queued.');
      formElement.reset();
      setStartPage(1);
      setCurrentPage(1);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not save this book.');
    } finally {
      setIsUploading(false);
    }
  }

  function beginEdit(book: BookRecord) {
    setEditingBookId(book.id);
    setBookDraft({ title: book.title, author: book.author, metadata: book.metadata, startDate: book.startDate, durationDays: book.durationDays, studyMinutes: book.studyMinutes, postingTime: book.postingTime, timezone: book.timezone, currentPage: book.currentPage });
  }

  async function saveBookEdit(book: BookRecord) {
    setError('');
    setSavingBookEditId(book.id);
    try {
      const response = await apiFetch(`/api/books/${encodeURIComponent(book.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bookDraft) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update this book.');
      setBooks(current => current.map(item => item.id === book.id ? data.book : item));
      setEditingBookId(null);
      showNotice(`Updated “${data.book.title}”.`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not update this book.');
    } finally {
      setSavingBookEditId(null);
    }
  }

  async function removeBook(book: BookRecord) {
    if (!window.confirm(`Delete “${book.title}” and its extracted pages, plans, and saved delivery records? This cannot be undone.`)) return;
    setError('');
    setDeletingBookId(book.id);
    try {
      const response = await apiFetch(`/api/books/${encodeURIComponent(book.id)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not delete this book.');
      setBooks(current => current.filter(item => item.id !== book.id));
      setPagesByBook(current => { const next = { ...current }; delete next[book.id]; return next; });
      setAssignmentsByBook(current => { const next = { ...current }; delete next[book.id]; return next; });
      showNotice(`Deleted “${book.title}”.`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not delete this book.');
    } finally {
      setDeletingBookId(null);
    }
  }

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <header style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <BookOpen size={24} color="var(--accent-color)" />
        <div>
          <h2 style={{ margin: 0 }}>Book Reading Planner</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>Upload a book once; Moon prepares its daily Telegram lessons at your chosen time.</p>
        </div>
      </header>

      {/* Persistent visible feedback banners */}
      {notice && (
        <div className="v-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderColor: 'rgba(74, 222, 128, 0.45)', background: 'rgba(34, 197, 94, 0.12)' }}>
          <span style={{ color: '#86efac', fontSize: 13 }}>{notice}</span>
          <button type="button" onClick={() => setNotice('')} className="v-circle-btn" style={{ width: 24, height: 24 }} aria-label="Dismiss message"><X size={13} /></button>
        </div>
      )}
      {error && (
        <div className="v-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderColor: 'rgba(248, 113, 113, 0.45)', background: 'rgba(239, 68, 68, 0.12)' }}>
          <span style={{ color: '#fca5a5', fontSize: 13 }}>{error}</span>
          <button type="button" onClick={() => setError('')} className="v-circle-btn" style={{ width: 24, height: 24 }} aria-label="Dismiss error"><X size={13} /></button>
        </div>
      )}

      <div className="v-card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-start', borderColor: 'rgba(251,191,36,.45)' }}>
        <TriangleAlert size={19} color="#fbbf24" style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Daily Telegram lessons run automatically.</strong> Each post includes the original reading, a summary, concepts, definitions, an illustrative example, revision questions, and a page image. Scanned or uncertain right-to-left pages pause for a quick visual review before publishing.
        </div>
      </div>

      {/* Live Countdown Timer & Alarm for Next Scheduled Book Delivery */}
      <LiveBookDeliveryCountdown
        books={books}
        assignmentsByBook={assignmentsByBook}
        onAssignmentsUpdated={(bookId, newAssignments) => {
          setAssignmentsByBook(current => ({ ...current, [bookId]: newAssignments }));
        }}
        onBookUpdated={(updatedBook) => {
          setBooks(current => current.map(b => b.id === updatedBook.id ? updatedBook : b));
        }}
        onSendNow={async (assignment, book) => {
          await sendAssignmentNow(book, assignment);
        }}
        onOpenBookAnalytics={(book) => {
          void openBookAnalytics(book);
        }}
      />

      <form className="v-card" onSubmit={handleUpload} style={{ padding: 18, display: 'grid', gap: 14 }}>
        <h3 style={{ margin: 0 }}>Add a book</h3>
        <label style={fieldStyle}>PDF file<input name="pdf" type="file" accept="application/pdf,.pdf" required style={inputStyle} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
          <label style={fieldStyle}>Title<input name="title" required maxLength={240} style={inputStyle} /></label>
          <label style={fieldStyle}>Author<input name="author" required maxLength={240} style={inputStyle} /></label>
        </div>
        <label style={fieldStyle}>Optional metadata<input name="metadata" maxLength={2000} placeholder="Edition, ISBN, notes" style={inputStyle} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12 }}>
          <label style={fieldStyle}>Starting PDF page<input name="startPage" type="number" min={1} value={startPage} onChange={event => { const next = Math.max(1, Number(event.target.value) || 1); setStartPage(next); if (currentPage < next) setCurrentPage(next); }} required style={inputStyle} /></label>
          <label style={fieldStyle}>Ending PDF page<input name="endPage" type="number" min={1} defaultValue={30} required style={inputStyle} /></label>
          <label style={fieldStyle}>Reading days<input name="durationDays" type="number" min={1} max={365} defaultValue={30} required style={inputStyle} /></label>
          <label style={fieldStyle}>Plan start date<input name="startDate" type="date" defaultValue={new Date().toLocaleDateString('en-CA')} required style={inputStyle} /></label>
          <label style={fieldStyle}>Study minutes per day<input name="studyMinutes" type="number" min={5} max={1440} defaultValue={60} required style={inputStyle} /></label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
          <label style={fieldStyle}>Daily posting time<input name="postingTime" type="time" value={addPostingTime} onChange={e => setAddPostingTime(e.target.value)} required style={inputStyle} /></label>
          <label style={fieldStyle}>Timezone<input name="timezone" value={addTimezone} onChange={e => setAddTimezone(e.target.value)} required style={inputStyle} /></label>
          <label style={fieldStyle}>Current PDF page<input name="currentPage" type="number" min={startPage} value={currentPage} onChange={event => setCurrentPage(Math.max(startPage, Number(event.target.value) || startPage))} required style={inputStyle} /></label>
        </div>
        {(() => {
          const preview = describeScheduleRemaining(addPostingTime, null, addTimezone);
          return (
            <div
              style={{
                fontSize: 12,
                padding: '8px 12px',
                borderRadius: 8,
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
                color: '#93c5fd',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Clock3 size={14} style={{ flexShrink: 0 }} />
              <span>
                <strong>Next delivery estimate:</strong> {preview.remainingText} (at {addPostingTime} in {addTimezone})
              </span>
            </div>
          );
        })()}
        <button className="v-pill-btn" type="submit" disabled={isUploading} style={{ minHeight: 44, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 8, cursor: isUploading ? 'wait' : 'pointer' }}>
          <FileUp size={17} /> {isUploading ? 'Saving PDF…' : 'Queue daily Telegram delivery'}
        </button>
        {notice && <p role="status" style={{ margin: 0, color: '#86efac', fontSize: 13 }}>{notice}</p>}
        {error && <p role="alert" style={{ margin: 0, color: '#fca5a5', fontSize: 13 }}>{error}</p>}
      </form>

      <div className="v-card" style={{ padding: 18, display: 'grid', gap: 14 }}>
        <h3 style={{ margin: 0 }}>Saved books</h3>
        {loading ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : books.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No books saved yet.</p> : books.map(book => (
          <article key={book.id} style={{ padding: 16, borderRadius: 16, border: '1px solid var(--v-glass-border)', display: 'grid', gap: 14, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div><strong>{book.title}</strong><div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{book.author}</div></div>
              <span style={{ fontSize: 12, color: book.automationStatus === 'failed' || book.extractionStatus === 'failed' ? '#fca5a5' : book.automationStatus === 'ready' ? '#86efac' : '#fbbf24' }}>{book.automationStatus === 'processing' ? 'Preparing daily posts…' : book.automationStatus === 'needs_review' ? 'Waiting for page review' : book.automationStatus === 'failed' ? 'Automation needs attention' : book.automationStatus === 'ready' ? 'Daily Telegram posts active' : 'Daily Telegram posts queued'}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="v-pill-btn v-pill-btn-accent"
                onClick={() => void openBookAnalytics(book)}
                style={{
                  padding: '7px 12px',
                  display: 'inline-flex',
                  gap: 6,
                  alignItems: 'center',
                  minHeight: 34,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <BarChart3 size={15} />
                <span>BA (Book Analytics)</span>
              </button>
              <button type="button" className="v-pill-btn" aria-expanded={!collapsedBooks.has(book.id)} onClick={() => setCollapsedBooks(current => { const next = new Set(current); if (next.has(book.id)) next.delete(book.id); else next.add(book.id); return next; })} style={{ padding: '7px 10px', display: 'inline-flex', gap: 6, alignItems: 'center' }}>{collapsedBooks.has(book.id) ? <><ChevronDown size={15} /> Expand</> : <><ChevronUp size={15} /> Collapse</>}</button>
              <button type="button" className="v-pill-btn" onClick={() => beginEdit(book)} style={{ padding: '7px 10px', display: 'inline-flex', gap: 6, alignItems: 'center' }}><Pencil size={14} /> Edit</button>
              <button type="button" className="v-pill-btn" disabled={deletingBookId === book.id} onClick={() => void removeBook(book)} style={{ padding: '7px 10px', display: 'inline-flex', gap: 6, alignItems: 'center', color: '#fca5a5', cursor: deletingBookId === book.id ? 'wait' : 'pointer' }}>
                <Trash2 size={14} /> {deletingBookId === book.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>

            {/* Current Reading Status Card */}
            {(() => {
              const bookAssignments = assignmentsByBook[book.id] || [];
              const totalSelected = Math.max(1, book.endPage - book.startPage + 1);
              const pagesRead = Math.max(0, Math.min(totalSelected, (book.currentPage || book.startPage) - book.startPage));
              const progressPct = Math.min(100, Math.round((pagesRead / totalSelected) * 100));
              const remainingPages = Math.max(0, book.endPage - (book.currentPage - 1));
              const nextPending = bookAssignments
                .filter(a => a.status !== 'completed' && a.status !== 'superseded')
                .sort((a, b) => a.startPdfPage - b.startPdfPage)[0];

              return (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: 'var(--v-glass-bg-subtle)',
                    border: '1px solid var(--v-glass-border)',
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 12 }}>
                    <div>
                      <strong style={{ color: 'var(--text-primary)' }}>Reading Position: Page {book.currentPage}</strong>
                      <span style={{ color: 'var(--text-muted)' }}> (pp. {book.startPage}–{book.endPage})</span>
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>
                      <span style={{ color: '#4ade80', fontWeight: 600 }}>{pagesRead} pages sent</span>
                      {' · '}
                      <span>{remainingPages} pages remaining</span>
                      {' · '}
                      <span style={{ color: '#60a5fa', fontWeight: 700 }}>{progressPct}%</span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div style={{ width: '100%', height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${progressPct}%`,
                        borderRadius: 999,
                        background: 'linear-gradient(90deg, #3b82f6, #10b981)',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>

                  {/* Next Pending Section Bar */}
                  {nextPending ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
                      <div style={{ fontSize: 12 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Current Pending: </span>
                        <strong style={{ color: 'var(--text-primary)' }}>
                          Day {nextPending.dayNumber}{nextPending.sectionNumber ? ` · Part ${nextPending.sectionNumber}` : ''}
                        </strong>
                        <span style={{ color: 'var(--accent-color, #60a5fa)' }}> (pp. {nextPending.startPdfPage}–{nextPending.endPdfPage})</span>
                        <span style={{ color: 'var(--text-muted)' }}> · Scheduled: {nextPending.scheduledDate} {nextPending.postingTime || book.postingTime}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            fontSize: 10,
                            padding: '2px 7px',
                            borderRadius: 6,
                            fontWeight: 600,
                            background: nextPending.deliveryStatus === 'failed' ? 'rgba(239, 68, 68, 0.2)' : nextPending.status === 'approved' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                            color: nextPending.deliveryStatus === 'failed' ? '#fca5a5' : nextPending.status === 'approved' ? '#93c5fd' : '#fcd34d',
                          }}
                        >
                          {nextPending.deliveryStatus === 'failed' ? 'Failed' : nextPending.status === 'approved' ? 'Scheduled' : 'Draft'}
                        </span>
                        <SendNowButton
                          assignment={nextPending}
                          sending={sendingAssignmentId === nextPending.id}
                          onSend={() => void sendAssignmentNow(book, nextPending)}
                        />
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>
                      ✓ All scheduled sections for this book have been completed and delivered to Telegram.
                    </div>
                  )}
                </div>
              );
            })()}

            {!collapsedBooks.has(book.id) && <>
            {editingBookId === book.id && <section style={{ display: 'grid', gap: 12, padding: 14, borderRadius: 12, background: 'var(--v-glass-bg-subtle)', border: '1px solid var(--v-glass-border)' }}>
              <strong>Edit this book</strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
                {(['title', 'author', 'metadata'] as const).map(key => <label key={key} style={fieldStyle}>{key === 'metadata' ? 'Optional metadata' : key === 'title' ? 'Title' : 'Author'}<input style={inputStyle} value={String(bookDraft[key] ?? '')} onChange={event => setBookDraft(current => ({ ...current, [key]: event.target.value }))} /></label>)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12 }}>
                <label style={fieldStyle}>Plan start date<input type="date" style={inputStyle} value={String(bookDraft.startDate || '')} onChange={event => setBookDraft(current => ({ ...current, startDate: event.target.value }))} /></label>
                <label style={fieldStyle}>Reading days<input type="number" min={1} max={365} style={inputStyle} value={Number(bookDraft.durationDays || 1)} onChange={event => setBookDraft(current => ({ ...current, durationDays: Number(event.target.value) }))} /></label>
                <label style={fieldStyle}>Study minutes/day<input type="number" min={5} max={1440} style={inputStyle} value={Number(bookDraft.studyMinutes || 60)} onChange={event => setBookDraft(current => ({ ...current, studyMinutes: Number(event.target.value) }))} /></label>
                <label style={fieldStyle}>Posting time<input type="time" style={inputStyle} value={String(bookDraft.postingTime || '08:00')} onChange={event => setBookDraft(current => ({ ...current, postingTime: event.target.value }))} /></label>
                <label style={fieldStyle}>Timezone<input style={inputStyle} value={String(bookDraft.timezone || '')} onChange={event => setBookDraft(current => ({ ...current, timezone: event.target.value }))} /></label>
                <label style={fieldStyle}>Current PDF page<input type="number" min={book.startPage} max={book.endPage} style={inputStyle} value={Number(bookDraft.currentPage || book.startPage)} onChange={event => setBookDraft(current => ({ ...current, currentPage: Number(event.target.value) }))} /></label>
              </div>
              {(() => {
                const pTime = String(bookDraft.postingTime || '08:00');
                const tz = String(bookDraft.timezone || 'Africa/Addis_Ababa');
                const pDate = bookDraft.startDate ? String(bookDraft.startDate) : null;
                const preview = describeScheduleRemaining(pTime, pDate, tz);
                return (
                  <div
                    style={{
                      fontSize: 12,
                      padding: '7px 11px',
                      borderRadius: 8,
                      background: 'rgba(59, 130, 246, 0.1)',
                      border: '1px solid rgba(59, 130, 246, 0.25)',
                      color: '#93c5fd',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Clock3 size={13} style={{ flexShrink: 0 }} />
                    <span>
                      <strong>Next delivery estimate:</strong> {preview.remainingText} (at {pTime} in {tz})
                    </span>
                  </div>
                );
              })()}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="v-pill-btn" disabled={savingBookEditId === book.id} onClick={() => void saveBookEdit(book)} style={{ padding: '8px 12px', display: 'inline-flex', gap: 6, alignItems: 'center', cursor: savingBookEditId === book.id ? 'wait' : 'pointer' }}>
                  <Save size={14} /> {savingBookEditId === book.id ? 'Saving changes…' : 'Save changes'}
                </button>
                <button type="button" className="v-pill-btn" onClick={() => setEditingBookId(null)} style={{ padding: '8px 12px', display: 'inline-flex', gap: 6, alignItems: 'center' }}><X size={14} /> Cancel</button>
              </div>
            </section>}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', color: 'var(--text-secondary)', fontSize: 12 }}>
              <span>PDF pages {book.startPage}–{book.endPage}</span><span>Current page {book.currentPage}</span><span>{book.durationDays} days</span><span><Clock3 size={13} style={{ verticalAlign: 'middle' }} /> {book.postingTime} · {book.timezone}</span><span><LockKeyhole size={13} style={{ verticalAlign: 'middle' }} /> Private server file</span>
            </div>
            {book.extractionProgress && <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 12 }}>Progress: {book.extractionProgress.completedPages} / {book.extractionProgress.totalPages} selected pages</p>}
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 }}>{book.extractionMessage}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="v-pill-btn" disabled={processingId !== null} onClick={() => void extractBook(book)} style={{ padding: '8px 12px', cursor: processingId !== null ? 'wait' : 'pointer' }}>{processingId === book.id ? 'Extracting…' : book.extractionStatus === 'pending' ? 'Extract PDF text / OCR' : book.extractionStatus === 'processing' ? 'Resume / retry extraction' : 'Re-extract PDF pages'}</button>
              {processingId === book.id && (
                <button
                  type="button"
                  className="v-pill-btn"
                  onClick={cancelExtraction}
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(239, 68, 68, 0.2)',
                    borderColor: 'rgba(239, 68, 68, 0.45)',
                    color: '#fca5a5',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <X size={14} /> Cancel Extraction
                </button>
              )}
              {book.extractionStatus !== 'pending' && (
                <button
                  type="button"
                  className="v-pill-btn v-pill-btn-accent"
                  onClick={() => setReviewModalBook(book)}
                  style={{ padding: '8px 14px', display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 600 }}
                >
                  <FileText size={14} /> Review Extracted Text
                </button>
              )}
              {book.extractionStatus === 'needs_review' && (
                <button
                  type="button"
                  className="v-pill-btn"
                  onClick={async () => {
                    try {
                      const res = await apiFetch(`/api/books/${encodeURIComponent(book.id)}/pages/review`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ approveAll: true }),
                      });
                      const data = await res.json();
                      if (data.book) {
                        setBooks(prev => prev.map(b => b.id === book.id ? data.book : b));
                        notifyFeedback('success', 'Extracted content approved! You can now generate or load your plan.');
                      }
                    } catch (err: any) {
                      setError(err?.message || 'Failed to approve pages.');
                    }
                  }}
                  style={{ padding: '8px 14px', display: 'inline-flex', gap: 6, alignItems: 'center', fontWeight: 600, color: '#86efac', borderColor: '#4ade80' }}
                  title="Approve all extracted pages and enable reading plan generation / loading"
                >
                  <CheckCircle2 size={14} /> Approve Extracted Content
                </button>
              )}
              <button type="button" className="v-pill-btn" onClick={() => void openBookAnalytics(book)} style={{ padding: '8px 12px', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <Eye size={14} /> Inspect Extracted Pages in BA
              </button>
            </div>
            {(book.extractionStatus === 'completed' || book.extractionStatus === 'needs_review' || (assignmentsByBook[book.id] && assignmentsByBook[book.id].length > 0)) && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  className="v-pill-btn"
                  disabled={generatingPlanBookId === book.id}
                  onClick={() => void generatePlan(book)}
                  style={{ padding: '8px 12px', cursor: generatingPlanBookId === book.id ? 'wait' : 'pointer' }}
                >
                  {generatingPlanBookId === book.id ? 'Generating plan…' : 'Generate concept-based plan'}
                </button>
                {generatingPlanBookId === book.id && (
                  <button
                    type="button"
                    className="v-pill-btn"
                    onClick={cancelPlanGeneration}
                    style={{
                      padding: '8px 12px',
                      background: 'rgba(239, 68, 68, 0.2)',
                      borderColor: 'rgba(239, 68, 68, 0.45)',
                      color: '#fca5a5',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <X size={14} /> Cancel Plan Generation
                  </button>
                )}
                <button
                  type="button"
                  className="v-pill-btn"
                  disabled={loadingAssignmentsBookId === book.id}
                  onClick={() => void loadAssignments(book)}
                  style={{ padding: '8px 12px', cursor: loadingAssignmentsBookId === book.id ? 'wait' : 'pointer' }}
                >
                  {loadingAssignmentsBookId === book.id ? 'Loading plan…' : 'Load saved plan'}
                </button>
              </div>
            )}
            {assignmentsByBook[book.id]?.map(assignment => (
              <section key={assignment.id} style={{ border: '1px solid var(--v-glass-border)', borderRadius: 12, padding: 12, display: 'grid', gap: 8 }}>
                <strong>Day {assignment.dayNumber}{assignment.sectionNumber ? ` · Part ${assignment.sectionNumber}` : ''} · {assignment.scheduledDate} · PDF pages {assignment.startPdfPage}–{assignment.endPdfPage}</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{assignment.status} · estimated {assignment.estimatedMinutes} minutes · original text remains in extracted pages</span>
                <div style={{ display: 'grid', gap: 5 }}>{assignment.concepts.map((concept, index) => <div key={`${assignment.id}-${index}`} style={{ fontSize: 13 }}><strong>{concept.title}</strong><div style={{ color: 'var(--text-secondary)' }}>{concept.concept}</div></div>)}</div>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12 }}>Why this section: {assignment.rationale}</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button type="button" className="v-pill-btn" onClick={() => void openAssignment(book, assignment)} style={{ padding: '8px 12px' }}>Review original reading and notes</button>
                  <button
                    type="button"
                    className="v-pill-btn"
                    onClick={() => void openBookAnalytics(book)}
                    style={{ padding: '8px 12px', display: 'inline-flex', gap: 6, alignItems: 'center' }}
                    title="Open Book Analytics and Interactive Quiz"
                  >
                    <HelpCircle size={14} />
                    <span>Interactive Quiz</span>
                  </button>
                  <SendNowButton
                    assignment={assignment}
                    sending={sendingAssignmentId === assignment.id}
                    onSend={() => void sendAssignmentNow(book, assignment)}
                  />
                </div>
                {assignmentDetails[assignment.id] && (() => {
                  const detail = assignmentDetails[assignment.id];
                  const draft = notesDrafts[assignment.id] || detail.assignment.studyNotes;
                  return <div style={{ display: 'grid', gap: 12, paddingTop: 8 }}>
                    <h4 style={{ margin: 0 }}>Complete original reading · PDF pages {assignment.startPdfPage}–{assignment.endPdfPage}</h4>
                    {detail.originalPages.map(page => <section key={page.pdfPage} style={{ border: '1px solid var(--v-glass-border)', borderRadius: 10, padding: 10 }}>
                      <strong style={{ fontSize: 12 }}>Original PDF page {page.pdfPage}{page.method === 'ocr' ? ' · OCR, visually reviewed' : ''}</strong>
                      {previewUrls[`${book.id}:${page.pdfPage}`] && <img src={previewUrls[`${book.id}:${page.pdfPage}`]} alt={`Visual preview of original PDF page ${page.pdfPage}`} style={{ display: 'block', width: '100%', maxHeight: 600, objectFit: 'contain', marginTop: 8, borderRadius: 8, background: '#fff' }} />}
                      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 420, overflow: 'auto', margin: '8px 0 0', font: '13px/1.6 ui-monospace,Consolas,monospace' }}>{page.text}</pre>
                    </section>)}
                    <h4 style={{ margin: '8px 0 0' }}>AI-generated supplementary study notes</h4>
                    {draft ? <div style={{ display: 'grid', gap: 10 }}>
                      <label style={fieldStyle}>Concept summary<textarea style={{ ...inputStyle, minHeight: 90 }} value={draft.summary} onChange={event => setNotesDrafts(current => ({ ...current, [assignment.id]: { ...draft, summary: event.target.value } }))} /></label>
                      <label style={fieldStyle}>Key concepts, one per line<textarea style={{ ...inputStyle, minHeight: 90 }} value={draft.keyConcepts.join('\n')} onChange={event => setNotesDrafts(current => ({ ...current, [assignment.id]: { ...draft, keyConcepts: event.target.value.split('\n') } }))} /></label>
                      <div className="v-card" style={{ padding: 12, display: 'grid', gap: 8 }}>
                        <strong>{draft.example.kind === 'source' ? `Real-world example · PDF page ${draft.example.pdfPage}` : 'Practical application · illustrative'}</strong>
                        <label style={fieldStyle}>Situation<textarea style={{ ...inputStyle, minHeight: 60 }} value={draft.example.situation} onChange={event => setNotesDrafts(current => ({ ...current, [assignment.id]: { ...draft, example: { ...draft.example, situation: event.target.value } } }))} /></label>
                        <label style={fieldStyle}>Concept in action<textarea style={{ ...inputStyle, minHeight: 60 }} value={draft.example.conceptInAction} onChange={event => setNotesDrafts(current => ({ ...current, [assignment.id]: { ...draft, example: { ...draft.example, conceptInAction: event.target.value } } }))} /></label>
                        <label style={fieldStyle}>Lesson<textarea style={{ ...inputStyle, minHeight: 60 }} value={draft.example.lesson} onChange={event => setNotesDrafts(current => ({ ...current, [assignment.id]: { ...draft, example: { ...draft.example, lesson: event.target.value } } }))} /></label>
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{draft.example.sourceDisclosure}</span>
                      </div>
                      <div style={{ display: 'grid', gap: 8 }}><strong>Definitions</strong>{draft.definitions.map((definition, index) => <p key={`${definition.term}-${index}`} style={{ margin: 0, fontSize: 13 }}><b>{definition.term}</b> — {definition.explanation} <span style={{ color: 'var(--text-muted)' }}>(PDF p. {definition.pdfPage})</span></p>)}</div>
                      <div style={{ display: 'grid', gap: 8 }}><strong>Review questions and answers</strong>{draft.questions.map((item, index) => <div key={index} style={{ fontSize: 13 }}><p style={{ margin: '2px 0' }}><b>Q:</b> {item.question}</p><p style={{ margin: '2px 0' }}><b>A:</b> {item.answer} <span style={{ color: 'var(--text-muted)' }}>(PDF pp. {item.pdfPages.join(', ')})</span></p></div>)}</div>
                      <label style={fieldStyle}>Study notes<textarea style={{ ...inputStyle, minHeight: 120 }} value={draft.notes} onChange={event => setNotesDrafts(current => ({ ...current, [assignment.id]: { ...draft, notes: event.target.value } }))} /></label>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Generated by {draft.generatedByModel}. {assignment.status === 'approved' ? 'Approved; change status to draft before editing.' : 'Review and edit this supplement before approval.'}</span>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button type="button" className="v-pill-btn" disabled={generatingNotesAssignmentId === assignment.id || assignment.status === 'approved'} onClick={() => void generateNotes(book, assignment)} style={{ padding: '8px 12px', cursor: generatingNotesAssignmentId === assignment.id ? 'wait' : 'pointer' }}>
                          {generatingNotesAssignmentId === assignment.id ? 'Generating…' : assignment.studyNotes ? 'Regenerate notes' : 'Generate study notes'}
                        </button>
                        <button type="button" className="v-pill-btn" disabled={savingNotesAssignmentId === assignment.id || assignment.status === 'approved'} onClick={() => void saveNotes(book, assignment, 'draft')} style={{ padding: '8px 12px', cursor: savingNotesAssignmentId === assignment.id ? 'wait' : 'pointer' }}>
                          {savingNotesAssignmentId === assignment.id ? 'Saving…' : 'Save edits'}
                        </button>
                        <button type="button" className="v-pill-btn" disabled={savingNotesAssignmentId === assignment.id || assignment.status === 'approved'} onClick={() => void saveNotes(book, assignment, 'approved')} style={{ padding: '8px 12px', cursor: savingNotesAssignmentId === assignment.id ? 'wait' : 'pointer' }}>
                          {savingNotesAssignmentId === assignment.id ? 'Approving…' : 'Approve assignment'}
                        </button>
                        <SendNowButton
                          assignment={assignment}
                          sending={sendingAssignmentId === assignment.id}
                          onSend={() => void sendAssignmentNow(book, assignment)}
                        />
                      </div>
                    </div> : <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button type="button" className="v-pill-btn" disabled={generatingNotesAssignmentId === assignment.id} onClick={() => void generateNotes(book, assignment)} style={{ justifySelf: 'start', padding: '8px 12px', cursor: generatingNotesAssignmentId === assignment.id ? 'wait' : 'pointer' }}>
                        {generatingNotesAssignmentId === assignment.id ? 'Generating…' : 'Generate study notes'}
                      </button>
                      <SendNowButton
                        assignment={assignment}
                        sending={sendingAssignmentId === assignment.id}
                        onSend={() => void sendAssignmentNow(book, assignment)}
                      />
                    </div>}
                  </div>;
                })()}
              </section>
            ))}
            </>}
          </article>
        ))}
      </div>

      {/* Book Analytics Modal */}
      {baModalBook && (
        <BookAnalyticsModal
          isOpen={Boolean(baModalBook)}
          onClose={() => {
            setBaModalBook(null);
            setBaModalTab('overview');
            setTargetQuizAssignmentId(null);
          }}
          book={baModalBook}
          assignments={assignmentsByBook[baModalBook.id] || []}
          initialTab={baModalTab}
          initialQuizAssignmentId={targetQuizAssignmentId || undefined}
          onBookUpdated={(updated) => {
            setBooks(current => current.map(b => b.id === updated.id ? updated : b));
            setBaModalBook(updated);
          }}
          onAssignmentsUpdated={(updatedList) => {
            setAssignmentsByBook(current => ({ ...current, [baModalBook.id]: updatedList }));
          }}
          onSendNow={async (assignment) => {
            await sendAssignmentNow(baModalBook, assignment);
          }}
        />
      )}

      {/* Dedicated Book Review Modal */}
      {reviewModalBook && (
        <BookReviewModal
          isOpen={Boolean(reviewModalBook)}
          book={reviewModalBook}
          onClose={() => setReviewModalBook(null)}
          onBookUpdated={(updated) => {
            setBooks(current => current.map(b => b.id === updated.id ? updated : b));
            setReviewModalBook(updated);
          }}
        />
      )}
    </section>
  );
}
