'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Clock3, FileUp, LockKeyhole, TriangleAlert } from 'lucide-react';
import { apiFetch } from '@/lib/api/apiClient';
import type { BookRecord } from '@/lib/books/types';

const fieldStyle: React.CSSProperties = { display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 13 };
const inputStyle: React.CSSProperties = { width: '100%', minHeight: 42, borderRadius: 12, border: '1px solid var(--v-glass-border)', padding: '9px 12px', background: 'var(--v-glass-bg-subtle)', color: 'var(--text-primary)' };

export function BookPlannerScreen() {
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [startPage, setStartPage] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch('/api/books');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load books.');
      setBooks(data.books || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load books.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const form = new FormData(formElement);
      const response = await apiFetch('/api/books', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save this book.');
      setBooks(current => [data.book, ...current]);
      setNotice('PDF saved privately as a draft. It has not been extracted or scheduled.');
      formElement.reset();
      setStartPage(1);
      setCurrentPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this book.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <header style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <BookOpen size={24} color="var(--accent-color)" />
        <div>
          <h2 style={{ margin: 0 }}>Book Reading Planner</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>Save a book and configure its intended reading window.</p>
        </div>
      </header>

      <div className="v-card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-start', borderColor: 'rgba(251,191,36,.45)' }}>
        <TriangleAlert size={19} color="#fbbf24" style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Exact text extraction is not configured.</strong> The PDF is kept as an original source file, but this app has no PDF text/OCR or image extraction engine. It will not create assignments, summaries, or Telegram posts from unverified text.
        </div>
      </div>

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
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
          <label style={fieldStyle}>Daily posting time<input name="postingTime" type="time" defaultValue="08:00" required style={inputStyle} /></label>
          <label style={fieldStyle}>Timezone<input name="timezone" defaultValue="Africa/Nairobi" required style={inputStyle} /></label>
          <label style={fieldStyle}>Current PDF page<input name="currentPage" type="number" min={startPage} value={currentPage} onChange={event => setCurrentPage(Math.max(startPage, Number(event.target.value) || startPage))} required style={inputStyle} /></label>
        </div>
        <button className="v-pill-btn" type="submit" disabled={busy} style={{ minHeight: 44, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 8, cursor: busy ? 'wait' : 'pointer' }}>
          <FileUp size={17} /> {busy ? 'Saving PDF…' : 'Save book as draft'}
        </button>
        {notice && <p role="status" style={{ margin: 0, color: '#86efac', fontSize: 13 }}>{notice}</p>}
        {error && <p role="alert" style={{ margin: 0, color: '#fca5a5', fontSize: 13 }}>{error}</p>}
      </form>

      <div className="v-card" style={{ padding: 18, display: 'grid', gap: 14 }}>
        <h3 style={{ margin: 0 }}>Saved books</h3>
        {loading ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : books.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No books saved yet.</p> : books.map(book => (
          <article key={book.id} style={{ padding: 14, borderRadius: 14, border: '1px solid var(--v-glass-border)', display: 'grid', gap: 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div><strong>{book.title}</strong><div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{book.author}</div></div>
              <span style={{ fontSize: 12, color: '#fbbf24' }}>Draft · extraction pending</span>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', color: 'var(--text-secondary)', fontSize: 12 }}>
              <span>PDF pages {book.startPage}–{book.endPage}</span><span>Current page {book.currentPage}</span><span>{book.durationDays} days</span><span><Clock3 size={13} style={{ verticalAlign: 'middle' }} /> {book.postingTime} · {book.timezone}</span><span><LockKeyhole size={13} style={{ verticalAlign: 'middle' }} /> Private server file</span>
            </div>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 }}>{book.extractionMessage}</p>
          </article>
        ))}
      </div>
      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 }}>Telegram bot/channel, Mind Improves, and book image extraction are not connected in this project. No credentials or API documentation for those services were found. Existing generic AI/image features are not used to reproduce source text.</p>
    </section>
  );
}
