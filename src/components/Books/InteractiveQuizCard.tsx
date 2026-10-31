'use client';

import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
  Award,
  Sparkles,
  BookOpen,
  Check,
  AlertCircle,
  Brain,
} from 'lucide-react';
import type { QuizQuestionItem } from '@/lib/books/types';

interface InteractiveQuizCardProps {
  questions: QuizQuestionItem[];
  bookTitle: string;
  assignmentTitle: string;
  onFinish?: (score: number, total: number, answers: Record<string, number>) => void;
  onRegenerateQuiz?: () => Promise<void>;
  isRegenerating?: boolean;
}

export function InteractiveQuizCard({
  questions,
  bookTitle,
  assignmentTitle,
  onFinish,
  onRegenerateQuiz,
  isRegenerating = false,
}: InteractiveQuizCardProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, { selected: number; isCorrect: boolean }>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;

  // Sync state when moving between questions
  useEffect(() => {
    if (currentQuestion && answers[currentQuestion.id]) {
      setSelectedOption(answers[currentQuestion.id].selected);
      setIsSubmitted(true);
    } else {
      setSelectedOption(null);
      setIsSubmitted(false);
    }
  }, [currentIndex, currentQuestion, answers]);

  if (!questions || questions.length === 0) {
    return (
      <div
        className="v-card"
        style={{
          padding: 24,
          borderRadius: 16,
          border: '1px solid var(--v-glass-border)',
          background: 'var(--v-glass-bg-subtle)',
          textAlign: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        <Brain size={36} style={{ margin: '0 auto 12px auto', opacity: 0.5, color: 'var(--text-secondary)' }} />
        <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-primary)' }}>No Quiz Questions Available</h4>
        <p style={{ margin: '0 0 16px 0', fontSize: 13 }}>
          Quiz questions for this reading section have not been generated yet or pages were empty.
        </p>
        {onRegenerateQuiz && (
          <button
            type="button"
            className="v-pill-btn v-pill-btn-accent"
            onClick={onRegenerateQuiz}
            disabled={isRegenerating}
            style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600 }}
          >
            {isRegenerating ? 'Generating Quiz Questions…' : 'Generate Interactive Quiz'}
          </button>
        )}
      </div>
    );
  }

  // Calculate score
  const correctCount = Object.values(answers).filter(a => a.isCorrect).length;
  const scorePercent = Math.round((correctCount / totalQuestions) * 100);

  const handleSelectOption = (index: number) => {
    if (isSubmitted) return; // Locked once submitted
    setSelectedOption(index);
  };

  const handleSubmit = () => {
    if (selectedOption === null || !currentQuestion) return;
    const isCorrect = selectedOption === currentQuestion.correctOptionIndex;
    const updated = {
      ...answers,
      [currentQuestion.id]: { selected: selectedOption, isCorrect },
    };
    setAnswers(updated);
    setIsSubmitted(true);

    // If on last question, check if all answered
    if (Object.keys(updated).length === totalQuestions) {
      const finalScore = Object.values(updated).filter(a => a.isCorrect).length;
      const simpleAnswers: Record<string, number> = {};
      Object.entries(updated).forEach(([k, v]) => {
        simpleAnswers[k] = v.selected;
      });
      onFinish?.(finalScore, totalQuestions, simpleAnswers);
    }
  };

  const handleNext = () => {
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setIsCompleted(true);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleRetry = () => {
    setAnswers({});
    setCurrentIndex(0);
    setSelectedOption(null);
    setIsSubmitted(false);
    setIsCompleted(false);
  };

  // --- Final Results Screen ---
  if (isCompleted) {
    const missedQuestions = questions.filter(q => answers[q.id] && !answers[q.id].isCorrect);
    const masteredConcepts = Array.from(
      new Set(
        questions
          .filter(q => answers[q.id]?.isCorrect)
          .map(q => q.conceptTested || 'Grounded Reading Principle')
      )
    );
    const revisionConcepts = Array.from(
      new Set(
        missedQuestions.map(q => q.conceptTested || `PDF Page ${q.sourcePdfPages[0] || '?'}`)
      )
    );

    return (
      <div
        className="v-card"
        style={{
          padding: 28,
          borderRadius: 16,
          border: '1px solid var(--v-glass-border)',
          background: 'var(--v-glass-bg-subtle)',
          display: 'grid',
          gap: 20,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              margin: '0 auto 12px auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
            }}
          >
            <Award size={30} />
          </div>
          <h3 style={{ margin: '0 0 6px 0', color: 'var(--text-primary)' }}>Quiz Completed!</h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            {bookTitle} · {assignmentTitle}
          </p>
        </div>

        {/* Score Banner */}
        <div
          style={{
            padding: 18,
            borderRadius: 12,
            background: scorePercent >= 70 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(59, 130, 246, 0.1)',
            border: `1px solid ${scorePercent >= 70 ? 'rgba(34, 197, 94, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            textAlign: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)' }}>
              {correctCount} / {totalQuestions}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Correct Answers</div>
          </div>
          <div style={{ width: 1, height: 40, background: 'var(--v-glass-border)' }} />
          <div>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)' }}>
              {scorePercent}%
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Comprehension Score</div>
          </div>
        </div>

        {/* Concepts Mastered & Revision Needed */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          {masteredConcepts.length > 0 && (
            <div
              style={{
                padding: 14,
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
                <CheckCircle2 size={15} />
                <span>Concepts Mastered ({masteredConcepts.length})</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)' }}>
                {masteredConcepts.map((c, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {revisionConcepts.length > 0 ? (
            <div
              style={{
                padding: 14,
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--v-glass-border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>
                <AlertCircle size={15} />
                <span>Concepts to Revise ({revisionConcepts.length})</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)' }}>
                {revisionConcepts.map((c, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{c}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div
              style={{
                padding: 14,
                borderRadius: 12,
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--text-primary)',
                fontSize: 13,
              }}
            >
              <Sparkles size={16} />
              <span>Flawless execution! All concepts answered correctly.</span>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, flexWrap: 'wrap', gap: 10 }}>
          <button
            type="button"
            className="v-pill-btn"
            onClick={handleRetry}
            style={{
              padding: '8px 18px',
              fontSize: 12,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <RotateCcw size={14} />
            <span>Retry Quiz</span>
          </button>

          <button
            type="button"
            className="v-pill-btn v-pill-btn-accent"
            onClick={() => {
              setIsCompleted(false);
              setCurrentIndex(0);
            }}
            style={{
              padding: '8px 18px',
              fontSize: 12,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <BookOpen size={14} />
            <span>Review Answers</span>
          </button>
        </div>
      </div>
    );
  }

  // --- Active Question Screen ---
  const optionLetters = ['A', 'B', 'C', 'D'];
  const isAnswered = Boolean(answers[currentQuestion.id]);
  const currentAnswer = answers[currentQuestion.id];
  const isCurrentCorrect = currentAnswer?.isCorrect;

  const difficultyColor =
    currentQuestion.difficulty === 'hard'
      ? '#ffffff'
      : currentQuestion.difficulty === 'medium'
      ? '#d4d4d8'
      : '#a1a1aa';

  const difficultyBg =
    currentQuestion.difficulty === 'hard'
      ? 'rgba(255, 255, 255, 0.15)'
      : currentQuestion.difficulty === 'medium'
      ? 'rgba(255, 255, 255, 0.1)'
      : 'rgba(255, 255, 255, 0.06)';

  return (
    <div
      className="v-card"
      style={{
        padding: 22,
        borderRadius: 16,
        border: '1px solid var(--v-glass-border)',
        background: 'var(--v-glass-bg-subtle)',
        display: 'grid',
        gap: 16,
      }}
    >
      {/* Top Header: Progress, Badges & Score */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            Question {currentIndex + 1} of {totalQuestions}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 6,
              background: difficultyBg,
              color: difficultyColor,
              textTransform: 'uppercase',
            }}
          >
            {currentQuestion.difficulty || 'MEDIUM'}
          </span>
          {currentQuestion.sourcePdfPages?.length > 0 && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                background: 'rgba(255,255,255,0.06)',
                padding: '2px 8px',
                borderRadius: 6,
              }}
            >
              PDF p. {currentQuestion.sourcePdfPages.join(', ')}
            </span>
          )}
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>Score: </span>
          <strong style={{ color: 'var(--text-primary)' }}>
            {correctCount} / {Object.keys(answers).length}
          </strong>
        </div>
      </div>

      {/* Progress Bar */}
      <div
        style={{
          width: '100%',
          height: 6,
          background: 'rgba(255, 255, 255, 0.08)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${((currentIndex + 1) / totalQuestions) * 100}%`,
            background: 'var(--text-primary, #ffffff)',
            transition: 'width 0.25s ease',
          }}
        />
      </div>

      {/* Question Text */}
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--text-primary)',
          lineHeight: 1.5,
          padding: '4px 0',
        }}
      >
        {currentQuestion.question}
      </div>

      {/* Options List */}
      <div style={{ display: 'grid', gap: 10 }}>
        {currentQuestion.options.map((option, optIdx) => {
          const letter = optionLetters[optIdx] || `#${optIdx + 1}`;
          const isSelected = selectedOption === optIdx;
          const isCorrectOption = optIdx === currentQuestion.correctOptionIndex;

          let optionBorder = 'var(--v-glass-border)';
          let optionBg = 'var(--v-glass-bg-subtle)';
          let optionTextColor = 'var(--text-primary)';

          if (isSubmitted) {
            if (isCorrectOption) {
              optionBorder = '#ffffff';
              optionBg = 'rgba(255, 255, 255, 0.16)';
              optionTextColor = '#ffffff';
            } else if (isSelected && !isCorrectOption) {
              optionBorder = 'var(--v-glass-border)';
              optionBg = 'rgba(255, 255, 255, 0.05)';
              optionTextColor = 'var(--text-muted)';
            } else {
              optionBg = 'rgba(255, 255, 255, 0.02)';
              optionTextColor = 'var(--text-muted)';
            }
          } else if (isSelected) {
            optionBorder = 'var(--text-primary, #ffffff)';
            optionBg = 'rgba(255, 255, 255, 0.14)';
          }

          return (
            <button
              key={optIdx}
              type="button"
              disabled={isSubmitted}
              onClick={() => handleSelectOption(optIdx)}
              style={{
                padding: '12px 16px',
                borderRadius: 12,
                border: `1px solid ${optionBorder}`,
                background: optionBg,
                color: optionTextColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                textAlign: 'left',
                cursor: isSubmitted ? 'default' : 'pointer',
                transition: 'all 0.15s ease',
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 11,
                    background: isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.08)',
                    color: isSelected ? '#000000' : 'var(--text-secondary)',
                    flexShrink: 0,
                  }}
                >
                  {letter}
                </span>
                <span>{option}</span>
              </div>

              {isSubmitted && isCorrectOption && (
                <CheckCircle2 size={18} style={{ color: '#ffffff', flexShrink: 0 }} />
              )}
              {isSubmitted && isSelected && !isCorrectOption && (
                <XCircle size={18} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Immediate Feedback Card after Submission */}
      {isSubmitted && (
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isCurrentCorrect ? (
              <CheckCircle2 size={18} style={{ color: '#ffffff' }} />
            ) : (
              <XCircle size={18} style={{ color: 'var(--text-secondary)' }} />
            )}
            <strong style={{ fontSize: 13, color: '#ffffff' }}>
              {isCurrentCorrect ? 'Correct Answer! Excellent recall.' : 'Incorrect Response.'}
            </strong>
          </div>

          <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.45 }}>
            {currentQuestion.explanation}
          </div>

          {!isCurrentCorrect && currentQuestion.conceptTested && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingTop: 4 }}>
              <strong>Underlying Principle: </strong>
              <span>{currentQuestion.conceptTested}</span>
            </div>
          )}
        </div>
      )}

      {/* Navigation & Submission Controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 6,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <button
          type="button"
          className="v-pill-btn"
          disabled={currentIndex === 0}
          onClick={handlePrevious}
          style={{
            padding: '7px 14px',
            fontSize: 12,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            opacity: currentIndex === 0 ? 0.4 : 1,
            cursor: currentIndex === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          <ArrowLeft size={14} />
          <span>Previous</span>
        </button>

        <div style={{ display: 'flex', gap: 10 }}>
          {!isSubmitted ? (
            <button
              type="button"
              className="v-pill-btn v-pill-btn-accent"
              disabled={selectedOption === null}
              onClick={handleSubmit}
              style={{
                padding: '8px 20px',
                fontSize: 12,
                fontWeight: 600,
                cursor: selectedOption === null ? 'not-allowed' : 'pointer',
                opacity: selectedOption === null ? 0.5 : 1,
              }}
            >
              Submit Answer
            </button>
          ) : (
            <button
              type="button"
              className="v-pill-btn v-pill-btn-accent"
              onClick={handleNext}
              style={{
                padding: '8px 20px',
                fontSize: 12,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>{currentIndex === totalQuestions - 1 ? 'Finish Quiz' : 'Next Question'}</span>
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
