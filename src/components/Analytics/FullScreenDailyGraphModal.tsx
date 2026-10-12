'use client';

import React, { useEffect } from 'react';
import {
  X, ChevronLeft, ChevronRight, Clock, CheckCircle2,
  Flame, Target, TrendingUp, RotateCcw, Calendar, Maximize2, Minimize2
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';
import type { WeekOption } from '@/lib/plan/weeklyPlanUtils';

interface DayBreakdown {
  date: string;
  dayName: string;
  hours: number;
  completedTasks: number;
  totalTasks: number;
  pomodoros: number;
  peakTaskName: string;
  peakTaskMinutes: number;
  taskTitles: { title: string; completed: boolean }[];
}

interface FullScreenDailyGraphModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedWeekStart: string;
  onSelectWeekStart: (startDate: string) => void;
  availableWeeks: WeekOption[];
  chartData: any[];
  weekDaysBreakdowns: DayBreakdown[];
  summary: {
    hours: number;
    tasks: number;
    pomodoros: number;
    completion: number;
    peakHours: number;
    peakLabel: string;
  };
  isPhone: boolean;
}

const FullScreenTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'var(--v-glass-bg-card)',
        backdropFilter: 'blur(20px)',
        border: '1.5px solid var(--v-glass-border)',
        borderRadius: 14,
        padding: '14px 18px',
        boxShadow: 'var(--v-shadow-spatial)',
        color: 'var(--text-primary)',
        minWidth: 180,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 8 }}>
        {label}
      </div>
      {payload.map((p: any, i: number) => (
        <div
          key={i}
          style={{
            fontSize: 13,
            fontWeight: 700,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 14,
            marginTop: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.color }} />
            <span style={{ color: '#cbd5e1' }}>{p.name}:</span>
          </div>
          <span style={{ color: p.color, fontFamily: 'monospace', fontSize: 15, fontWeight: 800 }}>
            {p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

export function FullScreenDailyGraphModal({
  isOpen,
  onClose,
  selectedWeekStart,
  onSelectWeekStart,
  availableWeeks,
  chartData,
  weekDaysBreakdowns,
  summary,
  isPhone,
}: FullScreenDailyGraphModalProps) {
  // Listen for Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentWeekIdx = availableWeeks.findIndex(w => w.startDate === selectedWeekStart);
  const currentWeek = availableWeeks[currentWeekIdx] || availableWeeks[0];
  const canGoPrevious = currentWeekIdx < availableWeeks.length - 1;
  const canGoNext = currentWeekIdx > 0;

  const handlePrev = () => {
    if (canGoPrevious) {
      onSelectWeekStart(availableWeeks[currentWeekIdx + 1].startDate);
    }
  };

  const handleNext = () => {
    if (canGoNext) {
      onSelectWeekStart(availableWeeks[currentWeekIdx - 1].startDate);
    }
  };

  const handleCurrentWeek = () => {
    if (availableWeeks[0]) {
      onSelectWeekStart(availableWeeks[0].startDate);
    }
  };

  const hasData = summary.hours > 0 || summary.tasks > 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(9, 10, 16, 0.98)',
        backdropFilter: 'blur(32px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: '#fff',
      }}
    >
      {/* ── 1. Full Screen Top Header Bar ── */}
      <div
        style={{
          padding: isPhone ? '14px 16px' : '18px 28px',
          borderBottom: '1px solid var(--v-glass-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          background: 'rgba(15, 17, 26, 0.8)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              overflow: 'hidden',
              border: '1.5px solid rgba(168, 85, 247, 0.5)',
              boxShadow: '0 0 15px rgba(168, 85, 247, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <img
              src="/icons/icon-192.png"
              alt="Night Planner"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2
                className="font-bloody"
                style={{ fontSize: isPhone ? 18 : 24, margin: 0, letterSpacing: '0.03em' }}
              >
                FULL-SCREEN DAILY GRAPH
              </h2>
              {currentWeek?.isCurrentWeek ? (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: 'rgba(34, 197, 94, 0.18)',
                    color: '#22c55e',
                    border: '1px solid rgba(34, 197, 94, 0.35)',
                  }}
                >
                  CURRENT WEEK
                </span>
              ) : (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: 'rgba(245, 158, 11, 0.18)',
                    color: '#f59e0b',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                  }}
                >
                  HISTORICAL WEEK
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {currentWeek?.weekLabel || 'Selected Week'} (7 Days)
            </div>
          </div>
        </div>

        {/* Close / Back to Dashboard button */}
        <button
          type="button"
          onClick={onClose}
          className="v-pill-btn v-pill-btn-primary"
          style={{
            padding: isPhone ? '8px 14px' : '10px 20px',
            fontSize: isPhone ? 12 : 13,
            fontWeight: 700,
            gap: 6,
          }}
          title="Return to normal dashboard (Esc)"
        >
          <X size={15} />
          <span>Back to Dashboard</span>
        </button>
      </div>

      {/* ── 2. Scrollable Body Content ── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: isPhone ? '16px 14px 90px' : '24px 28px 100px',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          maxWidth: 1280,
          width: '100%',
          margin: '0 auto',
        }}
      >
        {/* 4 Summary Metric Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: 12,
          }}
        >
          <div className="v-card" style={{ padding: '14px 18px', borderLeft: '4px solid #38bdf8' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#38bdf8' }}>
              <Clock size={16} />
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>HOURS TAKEN</span>
            </div>
            <div className="font-bloody" style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: '#fff' }}>
              {summary.hours}h
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Total focus in week</div>
          </div>

          <div className="v-card" style={{ padding: '14px 18px', borderLeft: '4px solid #22c55e' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#22c55e' }}>
              <CheckCircle2 size={16} />
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>TASKS COMPLETED</span>
            </div>
            <div className="font-bloody" style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: '#fff' }}>
              {summary.tasks}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{summary.completion}% completion rate</div>
          </div>

          <div className="v-card" style={{ padding: '14px 18px', borderLeft: '4px solid #f59e0b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f59e0b' }}>
              <Flame size={16} />
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>POMODOROS</span>
            </div>
            <div className="font-bloody" style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: '#fff' }}>
              {summary.pomodoros} 🍅
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>25m focus blocks</div>
          </div>

          <div className="v-card" style={{ padding: '14px 18px', borderLeft: '4px solid #a855f7' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#a855f7' }}>
              <Target size={16} />
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>PEAK FOCUS DAY</span>
            </div>
            <div className="font-bloody" style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: '#fff' }}>
              {summary.peakHours}h
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{summary.peakLabel || 'No logs yet'}</div>
          </div>
        </div>

        {/* Empty state alert if no data recorded for this week */}
        {!hasData && (
          <div
            className="v-card"
            style={{
              padding: '24px',
              textAlign: 'center',
              borderColor: 'rgba(245, 158, 11, 0.4)',
              background: 'rgba(245, 158, 11, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Calendar size={28} style={{ color: '#f59e0b' }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
              No focus hours or tasks recorded for this week
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 450 }}>
              {currentWeek?.isCurrentWeek
                ? 'Start a timer or create tasks in the to-do list today to populate this week’s graph.'
                : 'This historical week has no stored records in your on-device database.'}
            </div>
            {!currentWeek?.isCurrentWeek && (
              <button
                type="button"
                onClick={handleCurrentWeek}
                className="v-pill-btn v-pill-btn-primary"
                style={{ marginTop: 8, padding: '6px 16px', fontSize: 12, gap: 6 }}
              >
                <RotateCcw size={13} />
                <span>Jump to Current Week</span>
              </button>
            )}
          </div>
        )}

        {/* Graph 1: Focus Hours Area Chart (Extra Large) */}
        <div className="v-card" style={{ padding: isPhone ? '18px 14px' : '24px 28px', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TrendingUp size={20} style={{ color: '#38bdf8' }} />
              <div>
                <h3 className="font-bloody" style={{ fontSize: 20, margin: 0, letterSpacing: '0.02em' }}>
                  FOCUS HOURS TAKEN BY DAY
                </h3>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Seven days in {currentWeek?.weekLabel}
                </div>
              </div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace' }}>
              Total: {summary.hours}h
            </span>
          </div>

          <div style={{ width: '100%', height: isPhone ? 280 : 360 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 15, right: 15, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="fullScreenFocusGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.65} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.08)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}
                  stroke="rgba(255, 255, 255, 0.12)"
                />
                <YAxis
                  tick={{ fill: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}
                  stroke="rgba(255, 255, 255, 0.12)"
                  unit="h"
                />
                <Tooltip content={<FullScreenTooltip />} />
                <Area
                  type="monotone"
                  dataKey="hours"
                  name="Hours Taken"
                  stroke="#38bdf8"
                  strokeWidth={3.5}
                  fill="url(#fullScreenFocusGlow)"
                  activeDot={{ r: 7, fill: '#38bdf8', stroke: '#fff', strokeWidth: 2.5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Graph 2: Tasks Completed Bar Chart (Extra Large) */}
        <div className="v-card" style={{ padding: isPhone ? '18px 14px' : '24px 28px', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle2 size={20} style={{ color: '#22c55e' }} />
              <div>
                <h3 className="font-bloody" style={{ fontSize: 20, margin: 0, letterSpacing: '0.02em' }}>
                  TASKS COMPLETED BY DAY
                </h3>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Finished tasks compared across the week
                </div>
              </div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#22c55e', fontFamily: 'monospace' }}>
              Completed: {summary.tasks}
            </span>
          </div>

          <div style={{ width: '100%', height: isPhone ? 240 : 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 15, right: 15, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.08)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}
                  stroke="rgba(255, 255, 255, 0.12)"
                />
                <YAxis
                  tick={{ fill: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}
                  stroke="rgba(255, 255, 255, 0.12)"
                  allowDecimals={false}
                />
                <Tooltip content={<FullScreenTooltip />} />
                <Bar
                  dataKey="tasks"
                  name="Tasks Completed"
                  fill="#22c55e"
                  radius={[8, 8, 0, 0]}
                  maxBarSize={48}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 7-Day Detailed Breakdown Grid */}
        <div className="v-card" style={{ padding: isPhone ? '16px 14px' : '22px 24px', gap: 14 }}>
          <h3 className="font-bloody" style={{ fontSize: 18, margin: 0, letterSpacing: '0.03em' }}>
            DAILY DETAIL CARDS FOR THIS WEEK
          </h3>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isPhone ? '1fr' : 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 10,
            }}
          >
            {weekDaysBreakdowns.map((day) => {
              const completion = day.totalTasks > 0 ? Math.round((day.completedTasks / day.totalTasks) * 100) : 0;
              return (
                <div
                  key={day.date}
                  style={{
                    padding: '12px 16px',
                    borderRadius: 12,
                    background: 'var(--v-glass-bg-subtle)',
                    border: '1px solid var(--v-glass-border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>
                      {day.dayName}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {day.date}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <span style={{ fontSize: 12, color: '#38bdf8', fontWeight: 700 }}>
                      ⏱️ {day.hours}h focus
                    </span>
                    <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 700 }}>
                      ✓ {day.completedTasks}/{day.totalTasks} ({completion}%)
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    <span>🍅 {day.pomodoros} sessions</span>
                    <span>Peak: {day.peakTaskName}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── 3. Bottom Week-Navigation Bar (Accessible, Pinned, Never Obscuring Content) ── */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 110,
          padding: isPhone ? '10px 14px' : '14px 28px',
          background: 'rgba(15, 17, 26, 0.95)',
          backdropFilter: 'blur(20px)',
          borderTop: '1px solid var(--v-glass-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        {/* Left: Previous Week */}
        <button
          type="button"
          onClick={handlePrev}
          disabled={!canGoPrevious}
          className="v-pill-btn"
          style={{
            padding: '8px 14px',
            fontSize: 12,
            fontWeight: 700,
            gap: 6,
            opacity: canGoPrevious ? 1 : 0.4,
            cursor: canGoPrevious ? 'pointer' : 'not-allowed',
          }}
          title="Navigate to earlier historical week"
        >
          <ChevronLeft size={16} />
          <span>Previous Week</span>
        </button>

        {/* Center: Week Selector & Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <select
            value={selectedWeekStart}
            onChange={(e) => onSelectWeekStart(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: 10,
              background: 'var(--v-glass-bg-card)',
              color: 'var(--text-primary)',
              border: '1.5px solid var(--accent-color)',
              fontSize: 13,
              fontWeight: 700,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {availableWeeks.map((w) => (
              <option key={w.startDate} value={w.startDate} style={{ background: 'var(--v-app-bg)', color: 'var(--text-primary)' }}>
                {w.isCurrentWeek ? `⭐ Current: ${w.weekLabel}` : w.weekLabel}
              </option>
            ))}
          </select>
        </div>

        {/* Right: Next Week & Current Week Jump */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!currentWeek?.isCurrentWeek && (
            <button
              type="button"
              onClick={handleCurrentWeek}
              className="v-pill-btn"
              style={{
                padding: '8px 12px',
                fontSize: 12,
                gap: 5,
                borderColor: 'var(--accent-color)',
                color: 'var(--accent-color)',
              }}
              title="Jump to current week"
            >
              <RotateCcw size={13} />
              <span>Current</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleNext}
            disabled={!canGoNext}
            className="v-pill-btn"
            style={{
              padding: '8px 14px',
              fontSize: 12,
              fontWeight: 700,
              gap: 6,
              opacity: canGoNext ? 1 : 0.4,
              cursor: canGoNext ? 'pointer' : 'not-allowed',
            }}
            title="Navigate to newer week"
          >
            <span>Next Week</span>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
