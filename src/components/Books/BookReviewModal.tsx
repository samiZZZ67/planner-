'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileText,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { apiFetch } from '@/lib/api/apiClient';
import type { BookPageRecord, BookRecord } from '@/lib/books/types';
import type { BookPagesStats } from '@/lib/server/books';

interface BookReviewModalProps {
  book: BookRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onBookUpdated?: (updatedBook: BookRecord) => void;
}

export function BookReviewModal({ book, isOpen, onClose, onBookUpdated }: BookReviewModalProps) {
  const [currentBook, setCurrentBook] = useState<BookRecord | null>(book);
  const [summaries, setSummaries] = useState<BookPageRecord[]>([]);
  const [stats, setStats] = useState<BookPagesStats | null>(null);
  const [selectedPageNum, setSelectedPageNum] = useState<number>(book?.startPage || 1);
  const [currentPage, setCurrentPage] = useState<BookPageRecord | null>(null);
  const [editedText, setEditedText] = useState<string>('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingSummaries, setLoadingSummaries] = useState<boolean>(false);
  const [loadingPage, setLoadingPage] = useState<boolean>(false);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [savingText, setSavingText] = useState<boolean>(false);
  const [reviewingPage, setReviewingPage] = useState<boolean>(false);
  const [approvingAll, setApprovingAll] = useState<boolean>(false);
  const [extractingBatch, setExtractingBatch] = useState<boolean>(false);
  const [filter, setFilter] = useState<'all' | 'needs_review' | 'ocr' | 'empty'>('all');
  const [jumpInput, setJumpInput] = useState<string>('');
  const [viewMode, setViewMode] = useState<'split' | 'text' | 'preview'>('split');
  const [imageFit, setImageFit] = useState<'contain' | 'full'>('contain');
  const [notice, setNotice] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [pageWindowIndex, setPageWindowIndex] = useState<number>(0);
  const PAGE_WINDOW_SIZE = 50;

  const extractionAbortRef = useRef<AbortController | null>(null);
  const pageAbortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);

  // Sync state with incoming prop
  useEffect(() => {
    if (book) {
      setCurrentBook(book);
      setSelectedPageNum(book.startPage);
    }
  }, [book]);

  // Clean up all pending requests on unmount or close
  useEffect(() => {
    return () => {
      extractionAbortRef.current?.abort();
      pageAbortRef.current?.abort();
      previewAbortRef.current?.abort();
    };
  }, []);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    setError('');
  }, []);

  const showError = useCallback((msg: string) => {
    setError(msg);
    setNotice('');
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  // Load page summaries and extraction stats
  const loadSummariesAndStats = useCallback(async () => {
    if (!isOpen || !currentBook) return;
    setLoadingSummaries(true);
    try {
      const [sumRes, statsRes] = await Promise.all([
        apiFetch(`/api/books/${encodeURIComponent(currentBook.id)}/pages?summaryOnly=true&from=${currentBook.startPage}&to=${currentBook.endPage}`),
        apiFetch(`/api/books/${encodeURIComponent(currentBook.id)}/pages?stats=true`),
      ]);

      if (sumRes.ok) {
        const sumData = await sumRes.json();
        const pageList: BookPageRecord[] = sumData.pages || [];
        setSummaries(pageList);

        // Select the first unreviewed page if available, otherwise start page
        const unreviewed = pageList.find(p => p.requiresReview && !p.reviewedByUser);
        if (unreviewed) {
          setSelectedPageNum(unreviewed.pdfPage);
        } else if (pageList.length > 0 && !pageList.some(p => p.pdfPage === selectedPageNum)) {
          setSelectedPageNum(pageList[0].pdfPage);
        }
      }

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        if (statsData.stats) setStats(statsData.stats);
        if (statsData.book) {
          setCurrentBook(statsData.book);
          onBookUpdated?.(statsData.book);
        }
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not load page summaries.');
    } finally {
      setLoadingSummaries(false);
    }
  }, [isOpen, currentBook?.id, currentBook?.startPage, currentBook?.endPage, onBookUpdated, showError]);

  useEffect(() => {
    if (isOpen && currentBook) {
      void loadSummariesAndStats();
    }
  }, [isOpen, currentBook?.id, loadSummariesAndStats]);

  // Load single page full text with request cancellation
  const loadSinglePage = useCallback(async (pageNum: number) => {
    if (!currentBook) return;
    pageAbortRef.current?.abort();
    const controller = new AbortController();
    pageAbortRef.current = controller;
    setLoadingPage(true);
    try {
      const res = await apiFetch(`/api/books/${encodeURIComponent(currentBook.id)}/pages?pageNumber=${pageNum}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load page text.');
      const page: BookPageRecord = data.page;
      setCurrentPage(page);
      setEditedText(page ? page.text : '');
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === 'AbortError') return;
      showError(err instanceof Error ? err.message : `Failed to load page ${pageNum}.`);
    } finally {
      if (!controller.signal.aborted) {
        setLoadingPage(false);
      }
    }
  }, [currentBook, showError]);

  useEffect(() => {
    if (isOpen && currentBook && selectedPageNum) {
      void loadSinglePage(selectedPageNum);
    }
  }, [isOpen, currentBook?.id, selectedPageNum, loadSinglePage]);

  // Load visual page preview with abort controller and cleanup
  const loadPagePreview = useCallback((pageNum: number) => {
    if (!isOpen || !currentBook || !pageNum) {
      setPreviewUrl(null);
      return;
    }

    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;

    let objectUrl: string | null = null;
    setLoadingPreview(true);

    void apiFetch(`/api/books/${encodeURIComponent(currentBook.id)}/pages/${pageNum}/preview`, {
      signal: controller.signal,
    })
      .then(async res => {
        if (controller.signal.aborted) return;
        if (res.ok) {
          const blob = await res.blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setPreviewUrl(objectUrl);
        } else {
          setPreviewUrl(null);
        }
      })
      .catch((err: any) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        setPreviewUrl(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingPreview(false);
        }
      });
  }, [isOpen, currentBook]);

  useEffect(() => {
    loadPagePreview(selectedPageNum);
  }, [selectedPageNum, loadPagePreview]);

  // Filtered pages list for navigation
  const filteredSummaries = useMemo(() => {
    switch (filter) {
      case 'needs_review':
        return summaries.filter(p => p.requiresReview && !p.reviewedByUser);
      case 'ocr':
        return summaries.filter(p => p.method === 'ocr');
      case 'empty':
        return summaries.filter(p => p.method === 'empty');
      default:
        return summaries;
    }
  }, [summaries, filter]);

  const currentIndex = filteredSummaries.findIndex(p => p.pdfPage === selectedPageNum);

  // Sync window index when selected page changes
  useEffect(() => {
    const idx = filteredSummaries.findIndex(p => p.pdfPage === selectedPageNum);
    if (idx >= 0) {
      setPageWindowIndex(Math.floor(idx / PAGE_WINDOW_SIZE));
    }
  }, [selectedPageNum, filteredSummaries, PAGE_WINDOW_SIZE]);

  const totalWindows = Math.max(1, Math.ceil(filteredSummaries.length / PAGE_WINDOW_SIZE));
  const windowedSummaries = useMemo(() => {
    if (filteredSummaries.length <= PAGE_WINDOW_SIZE) return filteredSummaries;
    const start = pageWindowIndex * PAGE_WINDOW_SIZE;
    return filteredSummaries.slice(start, start + PAGE_WINDOW_SIZE);
  }, [filteredSummaries, pageWindowIndex, PAGE_WINDOW_SIZE]);

  const goToNextPage = () => {
    if (currentIndex >= 0 && currentIndex < filteredSummaries.length - 1) {
      setSelectedPageNum(filteredSummaries[currentIndex + 1].pdfPage);
    } else if (selectedPageNum < (currentBook?.endPage || 1)) {
      setSelectedPageNum(selectedPageNum + 1);
    }
  };

  const goToPrevPage = () => {
    if (currentIndex > 0) {
      setSelectedPageNum(filteredSummaries[currentIndex - 1].pdfPage);
    } else if (selectedPageNum > (currentBook?.startPage || 1)) {
      setSelectedPageNum(selectedPageNum - 1);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in a text field
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          void savePageText();
        }
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNextPage();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrevPage();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Save edited page text
  const savePageText = async () => {
    if (!currentBook || savingText) return;
    setSavingText(true);
    setError('');
    try {
      const res = await apiFetch(`/api/books/${encodeURIComponent(currentBook.id)}/pages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfPage: selectedPageNum, text: editedText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save page text.');

      setCurrentPage(data.page);
      setEditedText(data.page.text);
      setSummaries(prev => prev.map(p => p.pdfPage === selectedPageNum ? { ...p, ...data.page, text: '' } : p));
      if (data.stats) setStats(data.stats);
      if (data.book) {
        setCurrentBook(data.book);
        onBookUpdated?.(data.book);
      }
      showNotice(`Page ${selectedPageNum} text saved successfully.`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to save page text.');
    } finally {
      setSavingText(false);
    }
  };

  // Mark page reviewed
  const markReviewed = async () => {
    if (!currentBook || reviewingPage) return;
    setReviewingPage(true);
    setError('');
    try {
      const res = await apiFetch(`/api/books/${encodeURIComponent(currentBook.id)}/pages/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfPage: selectedPageNum }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to mark page reviewed.');

      setCurrentPage(data.page);
      setSummaries(prev => prev.map(p => p.pdfPage === selectedPageNum ? { ...p, ...data.page, text: '' } : p));
      if (data.stats) setStats(data.stats);
      if (data.book) {
        setCurrentBook(data.book);
        onBookUpdated?.(data.book);
      }
      showNotice(`Page ${selectedPageNum} marked as visually reviewed.`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to mark page reviewed.');
    } finally {
      setReviewingPage(false);
    }
  };

  // Approve all extracted pages for the book
  const approveAllContent = async () => {
    if (!currentBook || approvingAll) return;
    setApprovingAll(true);
    setError('');
    try {
      const res = await apiFetch(`/api/books/${encodeURIComponent(currentBook.id)}/pages/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approveAll: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve extracted pages.');

      if (data.stats) setStats(data.stats);
      if (data.book) {
        setCurrentBook(data.book);
        onBookUpdated?.(data.book);
      }
      setSummaries(prev => prev.map(p => ({ ...p, reviewedByUser: true, requiresReview: false })));
      if (currentPage) {
        setCurrentPage({ ...currentPage, reviewedByUser: true, requiresReview: false });
      }
      showNotice('Extracted content approved! You can now load or generate your reading plan.');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to approve extracted pages.');
    } finally {
      setApprovingAll(false);
    }
  };

  const cancelBatchExtraction = () => {
    if (extractionAbortRef.current) {
      extractionAbortRef.current.abort();
      extractionAbortRef.current = null;
      setExtractingBatch(false);
      showNotice('Batch extraction cancelled by user. Already extracted pages have been preserved.');
    }
  };

  // Resume / batch extraction from modal with cancellation support
  const resumeBatchExtraction = async () => {
    if (!currentBook || extractingBatch) return;
    setExtractingBatch(true);
    setError('');
    const controller = new AbortController();
    extractionAbortRef.current = controller;

    try {
      let isDone = false;
      let bCount = 1;
      while (!isDone) {
        if (controller.signal.aborted) break;
        showNotice(`Extracting batch ${bCount}...`);
        const res = await apiFetch(`/api/books/${encodeURIComponent(currentBook.id)}/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchSize: 25, force: true }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) break;
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Batch extraction failed.');
        setCurrentBook(data.book);
        onBookUpdated?.(data.book);
        isDone = Boolean(data.isComplete);
        bCount++;
        // Refresh summaries and stats after each batch
        await loadSummariesAndStats();
      }
      if (!controller.signal.aborted) {
        showNotice('Extraction fully completed! All pages are now available for review.');
      }
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === 'AbortError') {
        showNotice('Batch extraction stopped by user. Progress is preserved.');
      } else {
        showError(err instanceof Error ? err.message : 'Batch extraction failed.');
      }
      await loadSummariesAndStats();
    } finally {
      extractionAbortRef.current = null;
      setExtractingBatch(false);
    }
  };

  const copyTextToClipboard = () => {
    if (!editedText) return;
    navigator.clipboard.writeText(editedText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseInt(jumpInput.trim(), 10);
    if (!isNaN(p) && currentBook && p >= currentBook.startPage && p <= currentBook.endPage) {
      setSelectedPageNum(p);
      setJumpInput('');
    } else {
      showError(`Please enter a valid page number between ${currentBook?.startPage} and ${currentBook?.endPage}.`);
    }
  };

  if (!isOpen || !currentBook) return null;

  const totalPages = currentBook.endPage - currentBook.startPage + 1;
  const extractedCount = summaries.length;
  const isPartiallyExtracted = extractedCount < totalPages;
  const needsReviewCount = summaries.filter(p => p.requiresReview && !p.reviewedByUser).length;
  const ocrCount = summaries.filter(p => p.method === 'ocr').length;
  const emptyCount = summaries.filter(p => p.method === 'empty').length;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--v-glass-bg, #090d16)',
          border: '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.12))',
          borderRadius: 16,
          width: '98vw',
          maxWidth: 1380,
          height: '94vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.7)',
          color: 'var(--text-primary, #f1f5f9)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.1))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
            background: 'rgba(15, 23, 42, 0.6)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.2))',
                border: '1px solid rgba(168, 85, 247, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#c084fc',
              }}
            >
              <FileText size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  Review Extracted Text: {currentBook.title}
                </h3>
                {/* Extraction status badges */}
                {currentBook.extractionStatus === 'completed' && (
                  <span
                    style={{
                      background: 'rgba(34, 197, 94, 0.15)',
                      color: '#4ade80',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      borderRadius: 12,
                      padding: '2px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    ✓ Extraction Complete
                  </span>
                )}
                {currentBook.extractionStatus === 'needs_review' && (
                  <span
                    style={{
                      background: 'rgba(234, 179, 8, 0.15)',
                      color: '#facc15',
                      border: '1px solid rgba(234, 179, 8, 0.3)',
                      borderRadius: 12,
                      padding: '2px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    ⚠ Needs Review ({needsReviewCount})
                  </span>
                )}
                {currentBook.extractionStatus === 'processing' && (
                  <span
                    style={{
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      borderRadius: 12,
                      padding: '2px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    Processing ({extractedCount} / {totalPages})
                  </span>
                )}
                {currentBook.extractionStatus === 'failed' && (
                  <span
                    style={{
                      background: 'rgba(239, 68, 68, 0.15)',
                      color: '#f87171',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: 12,
                      padding: '2px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    Failed ({extractedCount} / {totalPages} saved)
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #94a3b8)' }}>
                PDF Pages {currentBook.startPage}–{currentBook.endPage} ({totalPages} pages total) · Author: {currentBook.author || 'Unknown'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* If partially extracted, allow resume or cancel from header */}
            {isPartiallyExtracted && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  type="button"
                  className="v-pill-btn v-pill-btn-accent"
                  disabled={extractingBatch}
                  onClick={() => void resumeBatchExtraction()}
                  style={{ padding: '6px 12px', fontSize: 12, display: 'inline-flex', gap: 6, alignItems: 'center' }}
                >
                  {extractingBatch ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  {extractingBatch ? 'Extracting Remaining...' : `Resume Extraction (${totalPages - extractedCount} left)`}
                </button>
                {extractingBatch && (
                  <button
                    type="button"
                    className="v-pill-btn"
                    onClick={cancelBatchExtraction}
                    style={{ padding: '6px 12px', fontSize: 12, display: 'inline-flex', gap: 6, alignItems: 'center', color: '#fca5a5', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                    title="Cancel active extraction batch"
                  >
                    <X size={13} />
                    <span>Cancel</span>
                  </button>
                )}
              </div>
            )}

            {/* Approve Extracted Content button */}
            <button
              type="button"
              className="v-pill-btn v-pill-btn-accent"
              disabled={approvingAll || extractingBatch}
              onClick={() => void approveAllContent()}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                display: 'inline-flex',
                gap: 6,
                alignItems: 'center',
                background: currentBook?.extractionStatus === 'completed' ? 'rgba(34, 197, 94, 0.2)' : undefined,
                borderColor: currentBook?.extractionStatus === 'completed' ? '#4ade80' : undefined,
                color: currentBook?.extractionStatus === 'completed' ? '#86efac' : undefined,
              }}
              title="Approve all extracted pages to enable reading plan generation and loading"
            >
              {approvingAll ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              <span>{currentBook?.extractionStatus === 'completed' ? 'Plan Approved ✓' : 'Approve Extracted Plan'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.15))',
                borderRadius: 8,
                padding: '6px 10px',
                color: 'var(--text-secondary, #cbd5e1)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Partial extraction warning banner */}
        {isPartiallyExtracted && (
          <div
            style={{
              padding: '8px 20px',
              background: 'rgba(234, 179, 8, 0.12)',
              borderBottom: '1px solid rgba(234, 179, 8, 0.25)',
              color: '#fde047',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <span>
              ℹ️ <b>Partial Extraction:</b> {extractedCount} of {totalPages} pages are currently extracted and saved. You can review available pages or resume batch extraction anytime.
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                disabled={extractingBatch}
                onClick={() => void resumeBatchExtraction()}
                style={{
                  background: 'rgba(234, 179, 8, 0.25)',
                  border: '1px solid rgba(234, 179, 8, 0.4)',
                  borderRadius: 6,
                  padding: '3px 8px',
                  color: '#fff',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {extractingBatch ? 'Processing...' : 'Extract Next Batch'}
              </button>
              {extractingBatch && (
                <button
                  type="button"
                  onClick={cancelBatchExtraction}
                  style={{
                    background: 'rgba(239, 68, 68, 0.25)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    borderRadius: 6,
                    padding: '3px 8px',
                    color: '#fca5a5',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {/* Notice & Error Messages */}
        {notice && (
          <div
            style={{
              padding: '8px 20px',
              background: 'rgba(34, 197, 94, 0.14)',
              borderBottom: '1px solid rgba(34, 197, 94, 0.3)',
              color: '#86efac',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice('')}
              style={{ background: 'none', border: 'none', color: '#86efac', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {error && (
          <div
            style={{
              padding: '8px 20px',
              background: 'rgba(239, 68, 68, 0.14)',
              borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fca5a5',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Toolbar & Filter Bar */}
        <div
          style={{
            padding: '10px 20px',
            borderBottom: '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.08))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            background: 'rgba(15, 23, 42, 0.3)',
          }}
        >
          {/* Filter Pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted, #94a3b8)', marginRight: 4 }}>Filter:</span>
            <button
              type="button"
              onClick={() => setFilter('all')}
              style={{
                padding: '4px 10px',
                borderRadius: 8,
                fontSize: 12,
                cursor: 'pointer',
                border: filter === 'all' ? '1px solid #6366f1' : '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.1))',
                background: filter === 'all' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                color: filter === 'all' ? '#a5b4fc' : 'var(--text-secondary, #cbd5e1)',
              }}
            >
              All Pages ({summaries.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('needs_review')}
              style={{
                padding: '4px 10px',
                borderRadius: 8,
                fontSize: 12,
                cursor: 'pointer',
                border: filter === 'needs_review' ? '1px solid #eab308' : '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.1))',
                background: filter === 'needs_review' ? 'rgba(234, 179, 8, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                color: filter === 'needs_review' ? '#fde047' : 'var(--text-secondary, #cbd5e1)',
              }}
            >
              Needs Review ({needsReviewCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('ocr')}
              style={{
                padding: '4px 10px',
                borderRadius: 8,
                fontSize: 12,
                cursor: 'pointer',
                border: filter === 'ocr' ? '1px solid #38bdf8' : '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.1))',
                background: filter === 'ocr' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                color: filter === 'ocr' ? '#7dd3fc' : 'var(--text-secondary, #cbd5e1)',
              }}
            >
              OCR Pages ({ocrCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('empty')}
              style={{
                padding: '4px 10px',
                borderRadius: 8,
                fontSize: 12,
                cursor: 'pointer',
                border: filter === 'empty' ? '1px solid #f87171' : '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.1))',
                background: filter === 'empty' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                color: filter === 'empty' ? '#fca5a5' : 'var(--text-secondary, #cbd5e1)',
              }}
            >
              Empty ({emptyCount})
            </button>
          </div>

          {/* Page Navigation & Jump */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={goToPrevPage}
              disabled={selectedPageNum <= (currentBook?.startPage || 1)}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.12))',
                borderRadius: 8,
                padding: '5px 8px',
                color: 'var(--text-primary, #f1f5f9)',
                cursor: selectedPageNum <= (currentBook?.startPage || 1) ? 'not-allowed' : 'pointer',
                opacity: selectedPageNum <= (currentBook?.startPage || 1) ? 0.4 : 1,
                display: 'inline-flex',
                alignItems: 'center',
              }}
              title="Previous Page (Left Arrow)"
            >
              <ArrowLeft size={14} />
            </button>

            {/* Jump to page form */}
            <form onSubmit={handleJumpSubmit} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary, #cbd5e1)' }}>Page</span>
              <input
                type="number"
                min={currentBook.startPage}
                max={currentBook.endPage}
                placeholder={String(selectedPageNum)}
                value={jumpInput}
                onChange={e => setJumpInput(e.target.value)}
                style={{
                  width: 58,
                  padding: '4px 6px',
                  borderRadius: 6,
                  border: '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.15))',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: '#fff',
                  fontSize: 12,
                  textAlign: 'center',
                }}
              />
              <span style={{ fontSize: 13, color: 'var(--text-muted, #94a3b8)' }}>of {currentBook.endPage}</span>
            </form>

            <button
              type="button"
              onClick={goToNextPage}
              disabled={selectedPageNum >= (currentBook?.endPage || 1)}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.12))',
                borderRadius: 8,
                padding: '5px 8px',
                color: 'var(--text-primary, #f1f5f9)',
                cursor: selectedPageNum >= (currentBook?.endPage || 1) ? 'not-allowed' : 'pointer',
                opacity: selectedPageNum >= (currentBook?.endPage || 1) ? 0.4 : 1,
                display: 'inline-flex',
                alignItems: 'center',
              }}
              title="Next Page (Right Arrow)"
            >
              <ArrowRight size={14} />
            </button>

            {/* View Mode Toggle */}
            <div style={{ display: 'inline-flex', border: '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.15))', borderRadius: 8, overflow: 'hidden', marginLeft: 8 }}>
              <button
                type="button"
                onClick={() => setViewMode('split')}
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  background: viewMode === 'split' ? 'rgba(99, 102, 241, 0.25)' : 'none',
                  color: viewMode === 'split' ? '#a5b4fc' : 'var(--text-secondary, #cbd5e1)',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Split
              </button>
              <button
                type="button"
                onClick={() => setViewMode('text')}
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  background: viewMode === 'text' ? 'rgba(99, 102, 241, 0.25)' : 'none',
                  color: viewMode === 'text' ? '#a5b4fc' : 'var(--text-secondary, #cbd5e1)',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Text
              </button>
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  background: viewMode === 'preview' ? 'rgba(99, 102, 241, 0.25)' : 'none',
                  color: viewMode === 'preview' ? '#a5b4fc' : 'var(--text-secondary, #cbd5e1)',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Preview
              </button>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Quick Page Picker Sidebar (for fast jump across hundreds of pages) */}
          <div
            style={{
              width: 140,
              borderRight: '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.08))',
              background: 'rgba(10, 15, 28, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-muted, #94a3b8)', borderBottom: '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.05))', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>PAGES ({filteredSummaries.length})</span>
              {totalWindows > 1 && (
                <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  <button
                    type="button"
                    disabled={pageWindowIndex === 0}
                    onClick={() => setPageWindowIndex(w => Math.max(0, w - 1))}
                    style={{ background: 'none', border: 'none', color: pageWindowIndex === 0 ? '#475569' : '#94a3b8', cursor: pageWindowIndex === 0 ? 'not-allowed' : 'pointer', padding: '0 2px' }}
                    title="Previous 50 pages"
                  >
                    ◀
                  </button>
                  <span style={{ fontSize: 9 }}>{pageWindowIndex + 1}/{totalWindows}</span>
                  <button
                    type="button"
                    disabled={pageWindowIndex >= totalWindows - 1}
                    onClick={() => setPageWindowIndex(w => Math.min(totalWindows - 1, w + 1))}
                    style={{ background: 'none', border: 'none', color: pageWindowIndex >= totalWindows - 1 ? '#475569' : '#94a3b8', cursor: pageWindowIndex >= totalWindows - 1 ? 'not-allowed' : 'pointer', padding: '0 2px' }}
                    title="Next 50 pages"
                  >
                    ▶
                  </button>
                </div>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, alignContent: 'start' }}>
              {windowedSummaries.map(p => {
                const isSelected = p.pdfPage === selectedPageNum;
                const isUnreviewed = p.requiresReview && !p.reviewedByUser;
                const isOcr = p.method === 'ocr';
                const isEmpty = p.method === 'empty';

                let badgeColor = 'rgba(255, 255, 255, 0.05)';
                let textColor = '#cbd5e1';
                let border = '1px solid transparent';

                if (isSelected) {
                  badgeColor = 'rgba(99, 102, 241, 0.3)';
                  textColor = '#fff';
                  border = '1px solid #818cf8';
                } else if (isUnreviewed) {
                  badgeColor = 'rgba(234, 179, 8, 0.12)';
                  textColor = '#fde047';
                  border = '1px solid rgba(234, 179, 8, 0.25)';
                } else if (isEmpty) {
                  badgeColor = 'rgba(239, 68, 68, 0.12)';
                  textColor = '#fca5a5';
                }

                return (
                  <button
                    key={p.pdfPage}
                    type="button"
                    onClick={() => setSelectedPageNum(p.pdfPage)}
                    style={{
                      padding: '5px 4px',
                      borderRadius: 6,
                      fontSize: 11,
                      textAlign: 'center',
                      background: badgeColor,
                      color: textColor,
                      border,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                    }}
                    title={`Page ${p.pdfPage} (${p.method})${p.requiresReview && !p.reviewedByUser ? ' - Needs Review' : ''}`}
                  >
                    <span>p. {p.pdfPage}</span>
                    <span style={{ fontSize: 9, opacity: 0.7 }}>
                      {isUnreviewed ? '⚠ review' : p.method === 'ocr' ? 'ocr' : p.method === 'empty' ? 'empty' : 'clean'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Left / Top: Visual Page Preview Pane */}
          {(viewMode === 'split' || viewMode === 'preview') && (
            <div
              style={{
                flex: viewMode === 'split' ? '1 1 50%' : '1 1 100%',
                borderRight: viewMode === 'split' ? '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.08))' : 'none',
                background: '#070a12',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {/* Preview Toolbar */}
              <div
                style={{
                  padding: '8px 16px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  color: 'var(--text-muted, #94a3b8)',
                }}
              >
                <span>Original PDF Rendering — Page {selectedPageNum}</span>
                <button
                  type="button"
                  onClick={() => setImageFit(current => (current === 'contain' ? 'full' : 'contain'))}
                  style={{
                    background: 'none',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 6,
                    padding: '2px 8px',
                    color: 'var(--text-secondary, #cbd5e1)',
                    fontSize: 11,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {imageFit === 'contain' ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
                  {imageFit === 'contain' ? 'Full Width' : 'Fit View'}
                </button>
              </div>

              {/* Preview Image Container */}
              <div
                style={{
                  flex: 1,
                  overflow: 'auto',
                  display: 'flex',
                  alignItems: imageFit === 'contain' ? 'center' : 'flex-start',
                  justifyContent: 'center',
                  padding: 16,
                  background: '#020617',
                }}
              >
                {loadingPreview ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--text-muted, #94a3b8)' }}>
                    <Loader2 size={24} className="animate-spin" />
                    <span style={{ fontSize: 13 }}>Loading page preview...</span>
                  </div>
                ) : previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={`Preview of PDF page ${selectedPageNum}`}
                    style={{
                      display: 'block',
                      maxWidth: imageFit === 'contain' ? '100%' : 'none',
                      maxHeight: imageFit === 'contain' ? '100%' : 'none',
                      width: imageFit === 'full' ? '100%' : 'auto',
                      objectFit: 'contain',
                      borderRadius: 8,
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                      background: '#fff',
                    }}
                  />
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted, #94a3b8)', padding: 32 }}>
                    <p style={{ margin: '0 0 6px', fontSize: 14 }}>Page {selectedPageNum} preview is not rendered yet.</p>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>Click below to render the original PDF page view on-demand.</span>
                    <div style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        className="v-pill-btn v-pill-btn-accent"
                        onClick={() => loadPagePreview(selectedPageNum)}
                        style={{ padding: '6px 14px', fontSize: 12, display: 'inline-flex', gap: 6, alignItems: 'center' }}
                      >
                        <Eye size={13} />
                        <span>Render Page {selectedPageNum} View</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Right / Bottom: Extracted Text Editor Pane */}
          {(viewMode === 'split' || viewMode === 'text') && (
            <div
              style={{
                flex: viewMode === 'split' ? '1 1 50%' : '1 1 100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                background: 'rgba(15, 23, 42, 0.4)',
              }}
            >
              {/* Page Status Header */}
              <div
                style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                  background: 'rgba(15, 23, 42, 0.5)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>PDF Page {selectedPageNum}</strong>
                  {currentPage && (
                    <>
                      <span
                        style={{
                          background: currentPage.method === 'native' ? 'rgba(34, 197, 94, 0.15)' : currentPage.method === 'ocr' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: currentPage.method === 'native' ? '#86efac' : currentPage.method === 'ocr' ? '#7dd3fc' : '#fca5a5',
                          borderRadius: 6,
                          padding: '2px 8px',
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {currentPage.method === 'native' ? 'Native text' : currentPage.method === 'ocr' ? `OCR (${currentPage.confidence ? `${currentPage.confidence.toFixed(0)}%` : 'est'})` : 'Empty / Unreadable'}
                      </span>
                      {currentPage.reviewedByUser ? (
                        <span style={{ color: '#4ade80', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 600 }}>
                          <CheckCircle2 size={12} /> Visually Reviewed
                        </span>
                      ) : currentPage.requiresReview ? (
                        <span style={{ color: '#facc15', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 600 }}>
                          <AlertTriangle size={12} /> Needs Visual Review
                        </span>
                      ) : (
                        <span style={{ color: '#86efac', fontSize: 11 }}>Clean</span>
                      )}
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={copyTextToClipboard}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: 6,
                      padding: '4px 8px',
                      color: 'var(--text-secondary, #cbd5e1)',
                      fontSize: 11,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                    title="Copy full page text"
                  >
                    {copied ? <Check size={12} color="#4ade80" /> : <Copy size={12} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)' }}>
                    {editedText.length} chars · {editedText.trim() ? editedText.trim().split(/\s+/).length : 0} words
                  </span>
                </div>
              </div>

              {/* Warnings callout */}
              {currentPage && currentPage.warnings && currentPage.warnings.length > 0 && (
                <div
                  style={{
                    padding: '8px 16px',
                    background: 'rgba(234, 179, 8, 0.1)',
                    borderBottom: '1px solid rgba(234, 179, 8, 0.2)',
                    color: '#fef08a',
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                  }}
                >
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1, color: '#facc15' }} />
                  <div>
                    {currentPage.warnings.map((w, idx) => (
                      <div key={idx}>{w}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Text Editor Area */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                {loadingPage ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted, #94a3b8)' }}>
                    <Loader2 size={24} className="animate-spin" />
                  </div>
                ) : (
                  <textarea
                    value={editedText}
                    onChange={e => setEditedText(e.target.value)}
                    placeholder="No extracted text on this page. You can type or paste corrected text here..."
                    style={{
                      flex: 1,
                      width: '100%',
                      padding: '16px 20px',
                      background: 'rgba(0, 0, 0, 0.25)',
                      border: 'none',
                      color: 'var(--text-primary, #f1f5f9)',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      fontSize: 13,
                      lineHeight: 1.6,
                      resize: 'none',
                      outline: 'none',
                    }}
                  />
                )}
              </div>

              {/* Bottom Action Bar */}
              <div
                style={{
                  padding: '12px 16px',
                  borderTop: '1px solid var(--v-glass-border, rgba(255, 255, 255, 0.08))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  background: 'rgba(15, 23, 42, 0.5)',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="v-pill-btn v-pill-btn-accent"
                    disabled={savingText || loadingPage}
                    onClick={() => void savePageText()}
                    style={{ padding: '7px 14px', fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center', cursor: savingText ? 'wait' : 'pointer' }}
                  >
                    {savingText ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {savingText ? 'Saving...' : 'Save Text Changes'}
                  </button>

                  <button
                    type="button"
                    className="v-pill-btn"
                    disabled={reviewingPage || loadingPage}
                    onClick={() => void markReviewed()}
                    style={{
                      padding: '7px 14px',
                      fontSize: 13,
                      display: 'inline-flex',
                      gap: 6,
                      alignItems: 'center',
                      cursor: reviewingPage ? 'wait' : 'pointer',
                      border: currentPage?.reviewedByUser ? '1px solid #4ade80' : undefined,
                      color: currentPage?.reviewedByUser ? '#4ade80' : undefined,
                    }}
                    title={!editedText.trim() ? 'Approve this blank or skipped page' : 'Approve this page against the visual PDF'}
                  >
                    {reviewingPage ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    {currentPage?.reviewedByUser ? 'Reviewed ✓' : (!editedText.trim() ? 'Approve Blank Page' : 'Mark as Visually Reviewed')}
                  </button>

                  <button
                    type="button"
                    className="v-pill-btn v-pill-btn-accent"
                    disabled={approvingAll || loadingPage}
                    onClick={() => void approveAllContent()}
                    style={{
                      padding: '7px 14px',
                      fontSize: 13,
                      display: 'inline-flex',
                      gap: 6,
                      alignItems: 'center',
                      cursor: approvingAll ? 'wait' : 'pointer',
                      background: currentBook?.extractionStatus === 'completed' ? 'rgba(34, 197, 94, 0.2)' : undefined,
                      borderColor: currentBook?.extractionStatus === 'completed' ? '#4ade80' : undefined,
                      color: currentBook?.extractionStatus === 'completed' ? '#86efac' : undefined,
                    }}
                    title="Approve all extracted pages to load or generate the study plan"
                  >
                    {approvingAll ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    {currentBook?.extractionStatus === 'completed' ? 'Plan Approved ✓' : 'Approve Plan & Finish'}
                  </button>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="v-pill-btn"
                    onClick={goToPrevPage}
                    disabled={selectedPageNum <= (currentBook?.startPage || 1)}
                    style={{ padding: '7px 12px', fontSize: 13 }}
                  >
                    ← Prev Page
                  </button>
                  <button
                    type="button"
                    className="v-pill-btn"
                    onClick={goToNextPage}
                    disabled={selectedPageNum >= (currentBook?.endPage || 1)}
                    style={{ padding: '7px 12px', fontSize: 13 }}
                  >
                    Next Page →
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
