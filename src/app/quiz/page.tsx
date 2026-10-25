'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  BookOpen,
  CheckCircle2,
  XCircle,
  Award,
  RotateCcw,
  ArrowLeft,
  ChevronRight,
  AlertCircle,
  HelpCircle,
  Loader2,
  BookMarked,
  FileText,
  Sparkles,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  sourcePdfPages: number[];
  definition?: { term: string; explanation: string; pdfPage?: number };
  practicalExample?: { kind: string; situation: string; lesson: string; sourceDisclosure?: string; pdfPage?: number };
}

interface QuizBook {
  id: string;
  title: string;
  author: string;
}

interface QuizAssignment {
  id: string;
  dayNumber: number;
  startPdfPage: number;
  endPdfPage: number;
  scheduledDate: string;
  concepts?: Array<{ title: string; concept?: string }>;
}

interface SubmissionResult {
  score: number;
  totalQuestions: number;
  correctCount: number;
  passed: boolean;
  results: Array<{
    questionId: string;
    question: string;
    options: string[];
    selectedOptionIndex: number;
    correctOptionIndex: number;
    isCorrect: boolean;
    explanation: string;
    sourcePdfPages: number[];
  }>;
}

function QuizContent() {
  const searchParams = useSearchParams();
  const assignmentId = searchParams.get('assignmentId') || searchParams.get('quiz') || '';
  const sessionId = searchParams.get('sessionId') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [book, setBook] = useState<QuizBook | null>(null);
  const [assignment, setAssignment] = useState<QuizAssignment | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);

  // Selected answers: questionId -> optionIndex
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  // Submitted state
  const [submitted, setSubmitted] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Storage keys for refresh resilience
  const storageKey = assignmentId ? `np_quiz_${assignmentId}` : sessionId ? `np_quiz_sess_${sessionId}` : '';

  // 1. Fetch quiz data
  useEffect(() => {
    if (!assignmentId && !sessionId) {
      setError('No assignment or quiz ID provided in the link. Please check your Telegram message or reading plan.');
      setLoading(false);
      return;
    }

    let isCancelled = false;

    async function loadQuiz() {
      setLoading(true);
      setError(null);
      try {
        const query = assignmentId ? `assignmentId=${encodeURIComponent(assignmentId)}` : `sessionId=${encodeURIComponent(sessionId)}`;
        const res = await fetch(`/api/quiz?${query}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to load quiz (HTTP ${res.status})`);
        }
        const data = await res.json();
        if (isCancelled) return;

        setBook(data.book);
        setAssignment(data.assignment);
        setQuestions(data.questions || []);

        // Restore saved answers and submission from localStorage if available
        if (storageKey && typeof window !== 'undefined') {
          try {
            const savedState = localStorage.getItem(storageKey);
            if (savedState) {
              const parsed = JSON.parse(savedState);
              if (parsed.answers) setSelectedAnswers(parsed.answers);
              if (parsed.submissionResult) {
                setSubmissionResult(parsed.submissionResult);
                setSubmitted(true);
              }
            }
          } catch {}
        }
      } catch (err: any) {
        if (!isCancelled) {
          setError(err.message || 'Could not load quiz questions.');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadQuiz();

    return () => {
      isCancelled = true;
    };
  }, [assignmentId, sessionId, storageKey]);

  // Persist state to localStorage whenever answers change
  useEffect(() => {
    if (storageKey && typeof window !== 'undefined' && !loading && questions.length > 0) {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            answers: selectedAnswers,
            submissionResult,
            submitted,
            updatedAt: Date.now(),
          })
        );
      } catch {}
    }
  }, [selectedAnswers, submitted, submissionResult, storageKey, loading, questions.length]);

  const handleSelectOption = (questionId: string, optionIndex: number) => {
    if (submitted) return; // Do not allow changing answers after submit unless retrying
    setSelectedAnswers(prev => ({
      ...prev,
      [questionId]: optionIndex,
    }));
  };

  const answeredCount = Object.keys(selectedAnswers).length;
  const totalCount = questions.length;
  const progressPercent = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;

  const handleSubmit = async () => {
    if (questions.length === 0 || submitting) return;

    if (answeredCount < totalCount) {
      const confirmSubmit = window.confirm(
        `You have answered ${answeredCount} of ${totalCount} questions. Submit anyway?`
      );
      if (!confirmSubmit) return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId: assignment?.id || assignmentId,
          answers: selectedAnswers,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to submit quiz.');
      }

      const result: SubmissionResult = await res.json();
      setSubmissionResult(result);
      setSubmitted(true);

      if (result.score >= 80) {
        try {
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
          });
        } catch {}
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      alert(err.message || 'Error submitting quiz answers.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetake = () => {
    const confirmRetake = window.confirm('Are you sure you want to retake this quiz? Your previous answers will be cleared.');
    if (!confirmRetake) return;

    setSelectedAnswers({});
    setSubmitted(false);
    setSubmissionResult(null);
    if (storageKey && typeof window !== 'undefined') {
      try {
        localStorage.removeItem(storageKey);
      } catch {}
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0b12] text-white flex flex-col items-center justify-center p-6">
        <div className="w-16 h-16 rounded-2xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center mb-4 animate-pulse">
          <BookOpen className="w-8 h-8 text-purple-400" />
        </div>
        <h2 className="text-xl font-bold mb-2">Loading Practice Quiz...</h2>
        <p className="text-sm text-gray-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
          Retrieving book pages and questions
        </p>
      </div>
    );
  }

  if (error || !book || !assignment || questions.length === 0) {
    return (
      <div className="min-h-screen bg-[#0a0b12] text-white flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-gray-900/80 border border-red-500/30 rounded-2xl p-6 text-center shadow-xl">
          <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-7 h-7 text-red-400" />
          </div>
          <h2 className="text-lg font-bold text-red-400 mb-2">Quiz Unavailable</h2>
          <p className="text-sm text-gray-300 mb-6">
            {error || 'No practice questions are available for this section yet.'}
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => window.location.reload()}
              className="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium transition"
            >
              Try Reloading
            </button>
            <Link
              href="/"
              className="w-full py-2.5 px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-medium transition text-center"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0b12] text-gray-100 selection:bg-purple-600 selection:text-white pb-24">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-[#0e101b]/90 backdrop-blur-md border-b border-gray-800 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-xs font-semibold text-gray-400 hover:text-white transition py-1 px-2 rounded-lg hover:bg-gray-800/60"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>NightPlanner</span>
          </Link>

          <div className="flex items-center gap-2">
            <span className="text-xs px-2.5 py-1 rounded-full bg-purple-900/40 border border-purple-500/30 text-purple-300 font-medium">
              Day {assignment.dayNumber} Practice
            </span>
            <span className="text-xs px-2.5 py-1 rounded-full bg-blue-900/40 border border-blue-500/30 text-blue-300 font-medium">
              PDF pp. {assignment.startPdfPage}–{assignment.endPdfPage}
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-3xl mx-auto px-4 pt-6">
        {/* Book & Assignment Overview Card */}
        <div className="bg-gradient-to-br from-gray-900/90 to-purple-950/20 border border-purple-900/40 rounded-2xl p-5 mb-6 shadow-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-purple-400 mb-1">
                <BookMarked className="w-3.5 h-3.5" />
                <span>Reading Assignment Quiz</span>
                <span className="text-gray-500">·</span>
                <span>{assignment.scheduledDate}</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-snug">
                {book.title}
              </h1>
              {book.author && (
                <p className="text-sm text-gray-400 mt-0.5">by {book.author}</p>
              )}
            </div>
          </div>

          {assignment.concepts && assignment.concepts.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-800/80 flex flex-wrap gap-2">
              <span className="text-xs font-semibold text-gray-400 self-center mr-1">Concepts:</span>
              {assignment.concepts.map((c, i) => (
                <span
                  key={i}
                  className="text-xs px-2.5 py-1 rounded-md bg-gray-800/90 border border-gray-700/60 text-gray-200"
                >
                  {c.title}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Score Hero Banner (when submitted) */}
        {submitted && submissionResult && (
          <div className="bg-gradient-to-br from-gray-900 via-gray-900/95 to-purple-950/40 border-2 border-purple-500/50 rounded-2xl p-6 mb-8 shadow-2xl text-center">
            <div className="w-16 h-16 rounded-full bg-purple-500/20 border-2 border-purple-400 flex items-center justify-center mx-auto mb-3 shadow-inner">
              <Award className="w-8 h-8 text-purple-300" />
            </div>

            <div className="text-4xl sm:text-5xl font-black text-white tracking-tight mb-1">
              {submissionResult.score}%
            </div>
            <p className="text-sm font-medium text-purple-300 mb-2">
              {submissionResult.correctCount} of {submissionResult.totalQuestions} Questions Correct
            </p>

            <div className="inline-block px-3 py-1 rounded-full text-xs font-semibold mb-4 bg-purple-950/60 border border-purple-500/30 text-purple-200">
              {submissionResult.score >= 80
                ? '🌟 Outstanding Mastery!'
                : submissionResult.score >= 60
                ? '👍 Good Effort! Review the explanations below.'
                : '📖 Recommended: Re-read the assigned PDF pages.'}
            </div>

            <div className="flex items-center justify-center gap-3 mt-2">
              <button
                onClick={handleRetake}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 text-sm font-medium text-gray-200 transition"
              >
                <RotateCcw className="w-4 h-4 text-purple-400" />
                <span>Retake Quiz</span>
              </button>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-sm font-medium text-white transition shadow-lg shadow-purple-900/30"
              >
                <span>Done</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        )}

        {/* Progress Tracker (when not submitted) */}
        {!submitted && (
          <div className="bg-gray-900/70 border border-gray-800/80 rounded-xl p-4 mb-6">
            <div className="flex items-center justify-between text-xs font-medium text-gray-400 mb-2">
              <span>Your Progress</span>
              <span>
                {answeredCount} of {totalCount} Answered ({progressPercent}%)
              </span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-purple-500 to-indigo-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Questions List */}
        <div className="space-y-6">
          {questions.map((q, qIndex) => {
            const isAnswered = selectedAnswers[q.id] !== undefined;
            const selectedOption = selectedAnswers[q.id];
            const resultItem = submissionResult?.results?.find(r => r.questionId === q.id);

            return (
              <div
                key={q.id || qIndex}
                className={`bg-gray-900/70 rounded-2xl p-5 sm:p-6 border transition-all ${
                  submitted
                    ? resultItem?.isCorrect
                      ? 'border-emerald-500/40 bg-emerald-950/10'
                      : 'border-red-500/40 bg-red-950/10'
                    : isAnswered
                    ? 'border-purple-600/40 bg-gray-900/90'
                    : 'border-gray-800 hover:border-gray-700'
                }`}
              >
                {/* Question Header Badges */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-md bg-gray-800 text-gray-200">
                      Question {qIndex + 1}
                    </span>
                    <span
                      className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded ${
                        q.difficulty === 'hard'
                          ? 'bg-red-950/50 text-red-300 border border-red-800/40'
                          : q.difficulty === 'medium'
                          ? 'bg-amber-950/50 text-amber-300 border border-amber-800/40'
                          : 'bg-emerald-950/50 text-emerald-300 border border-emerald-800/40'
                      }`}
                    >
                      {q.difficulty}
                    </span>
                  </div>

                  {q.sourcePdfPages && q.sourcePdfPages.length > 0 && (
                    <span className="text-[11px] font-medium text-gray-400 flex items-center gap-1 bg-gray-800/60 px-2 py-0.5 rounded border border-gray-700/40">
                      <FileText className="w-3 h-3 text-purple-400" />
                      <span>PDF p. {q.sourcePdfPages.join(', ')}</span>
                    </span>
                  )}
                </div>

                {/* Question Prompt */}
                <h3 className="text-base sm:text-lg font-semibold text-white mb-4 leading-relaxed">
                  {q.question}
                </h3>

                {/* Options List */}
                <div className="space-y-2.5">
                  {q.options.map((opt, optIndex) => {
                    const isSelected = selectedOption === optIndex;
                    const letter = String.fromCharCode(65 + optIndex);
                    const isCorrectChoice = optIndex === q.correctOptionIndex;

                    let optionBorder = 'border-gray-800 hover:border-gray-700 bg-gray-800/40';
                    let badgeClass = 'bg-gray-800 text-gray-400 border-gray-700';

                    if (submitted) {
                      if (isCorrectChoice) {
                        optionBorder = 'border-emerald-500 bg-emerald-950/30 text-emerald-200';
                        badgeClass = 'bg-emerald-600 text-white border-emerald-500';
                      } else if (isSelected && !isCorrectChoice) {
                        optionBorder = 'border-red-500 bg-red-950/30 text-red-200';
                        badgeClass = 'bg-red-600 text-white border-red-500';
                      } else {
                        optionBorder = 'border-gray-800/60 opacity-60 bg-gray-900/30';
                      }
                    } else if (isSelected) {
                      optionBorder = 'border-purple-500 bg-purple-950/30 text-white shadow-md shadow-purple-950/30';
                      badgeClass = 'bg-purple-600 text-white border-purple-500';
                    }

                    return (
                      <button
                        key={optIndex}
                        type="button"
                        disabled={submitted}
                        onClick={() => handleSelectOption(q.id, optIndex)}
                        className={`w-full text-left p-3.5 rounded-xl border flex items-start gap-3 transition-all ${optionBorder}`}
                      >
                        <span
                          className={`w-6 h-6 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 border mt-0.5 transition ${badgeClass}`}
                        >
                          {letter}
                        </span>

                        <span className="text-sm font-medium leading-snug grow self-center">
                          {opt}
                        </span>

                        {submitted && isCorrectChoice && (
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 self-center" />
                        )}
                        {submitted && isSelected && !isCorrectChoice && (
                          <XCircle className="w-5 h-5 text-red-400 shrink-0 self-center" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Grounded Explanation Box (After submission) */}
                {submitted && (
                  <div className="mt-4 pt-4 border-t border-gray-800">
                    <div className="bg-gray-800/60 rounded-xl p-4 border border-gray-700/60">
                      <div className="flex items-center gap-2 text-xs font-semibold text-purple-300 mb-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                        <span>Book Explanation & Verification:</span>
                      </div>
                      <p className="text-sm text-gray-300 leading-relaxed mb-2">
                        {q.explanation}
                      </p>

                      {q.definition && (
                        <div className="mt-2 text-xs bg-gray-900/60 p-2.5 rounded-lg border border-gray-800">
                          <span className="font-semibold text-purple-300">
                            {q.definition.term}:
                          </span>{' '}
                          <span className="text-gray-300">{q.definition.explanation}</span>
                        </div>
                      )}

                      {q.sourcePdfPages && q.sourcePdfPages.length > 0 && (
                        <div className="text-[11px] text-gray-400 mt-2 flex items-center gap-1">
                          <span>Verified against source:</span>
                          <span className="text-purple-300 font-medium">
                            {book.title} (PDF p. {q.sourcePdfPages.join(', ')})
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Submit Action Bar */}
        {!submitted && (
          <div className="sticky bottom-4 mt-8 bg-gray-900/95 backdrop-blur-md border border-purple-500/30 rounded-2xl p-4 shadow-2xl flex items-center justify-between gap-4">
            <div className="text-xs text-gray-400">
              <span className="font-semibold text-white">{answeredCount}</span> of {totalCount} completed
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="py-2.5 px-6 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-gray-800 text-white font-semibold text-sm transition shadow-lg shadow-purple-900/30 flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <span>Submit Quiz</span>
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default function DedicatedQuizPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0b12] text-white flex items-center justify-center p-6">
          <div className="flex items-center gap-3 text-sm text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
            <span>Loading quiz interface...</span>
          </div>
        </div>
      }
    >
      <QuizContent />
    </Suspense>
  );
}
