'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';
import {
  Clock, CheckCircle2, Flame, Target, TrendingUp,
  Maximize2, Minimize2, Calendar, ChevronDown, ChevronUp,
  Trophy, Medal, Award, Star, BarChart3, Layers
} from 'lucide-react';

export type TimeframeMode = 'days' | 'weeks' | 'months' | 'year' | 'ranking';

interface AnalyticsScreenProps {
  isPhone: boolean;
}

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

const GlassTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'var(--v-glass-bg-card)',
        backdropFilter: 'blur(20px)',
        border: '1.5px solid var(--v-glass-border-bright)',
        borderRadius: 12,
        padding: '12px 16px',
        boxShadow: 'var(--v-shadow-spatial)',
        color: 'var(--text-primary)',
        minWidth: 150,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
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
            gap: 12,
            marginTop: 3,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
            <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          </div>
          <span style={{ color: p.color, fontFamily: 'monospace', fontSize: 14 }}>
            {p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

export function AnalyticsScreen({ isPhone }: AnalyticsScreenProps) {
  // Active timeframe selection
  const [activeTab, setActiveTab] = useState<TimeframeMode>('days');
  // Controls expansion of the section for the active tab (clicking tab again compresses it)
  const [isSectionOpen, setIsSectionOpen] = useState<boolean>(true);
  const [isExpandedGraphs, setIsExpandedGraphs] = useState<boolean>(true);

  // Expanded state for individual days in the daily list
  const [expandedDayId, setExpandedDayId] = useState<string | null>(null);

  const [chartData, setChartData] = useState<any[]>([]);
  const [dailyBreakdowns, setDailyBreakdowns] = useState<DayBreakdown[]>([]);
  const [summary, setSummary] = useState({
    hours: 0,
    tasks: 0,
    pomodoros: 0,
    completion: 0,
    peakHours: 0,
    peakLabel: '',
  });

  const loadAnalyticsData = async () => {
    const allLogs = await db.timeLogs.filter(l => !l.deleted).toArray();
    const allTasks = await db.tasks.filter(t => !t.deleted).toArray();

    const now = new Date();

    // 1. Generate Daily Breakdowns for last 14 days
    const daysList: DayBreakdown[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const iso = d.toLocaleDateString('en-CA');
      const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
      const shortDisplay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      const dayLogs = allLogs.filter(l => l.date === iso);
      const dayTasks = allTasks.filter(t => t.date === iso);

      const mins = dayLogs.reduce((sum, l) => sum + (l.minutes || 0), 0);
      const hours = Math.round((mins / 60) * 10) / 10;
      const completed = dayTasks.filter(t => t.isCompleted).length;
      const pomodoros = Math.round(mins / 25);

      // Find task with peak minutes for this day
      const taskMinutesMap: Record<string, number> = {};
      for (const log of dayLogs) {
        taskMinutesMap[log.taskId] = (taskMinutesMap[log.taskId] || 0) + (log.minutes || 0);
      }
      let topTaskId = '';
      let topMins = 0;
      for (const [tId, tMins] of Object.entries(taskMinutesMap)) {
        if (tMins > topMins) {
          topMins = tMins;
          topTaskId = tId;
        }
      }
      const topTask = dayTasks.find(t => t.id === topTaskId);
      const peakTaskName = topTask ? topTask.title : topMins > 0 ? 'Logged Focus' : 'None';

      daysList.push({
        date: iso,
        dayName: `${dayName} (${shortDisplay})`,
        hours,
        completedTasks: completed,
        totalTasks: dayTasks.length,
        pomodoros,
        peakTaskName,
        peakTaskMinutes: topMins,
        taskTitles: dayTasks.map(t => ({ title: t.title, completed: t.isCompleted })),
      });
    }

    setDailyBreakdowns(daysList);

    // 2. Aggregate chart data depending on activeTab
    let points: { label: string; dateKeys: string[] }[] = [];

    if (activeTab === 'days') {
      points = daysList.map(d => ({ label: d.dayName.split(' ')[0].slice(0, 3) + ' ' + d.date.slice(5), dateKeys: [d.date] }));
    } else if (activeTab === 'weeks' || activeTab === 'ranking') {
      for (let i = 7; i >= 0; i--) {
        const weekDates: string[] = [];
        const start = new Date(now);
        start.setDate(start.getDate() - (i * 7 + 6));
        for (let day = 0; day < 7; day++) {
          const curr = new Date(start);
          curr.setDate(curr.getDate() + day);
          weekDates.push(curr.toLocaleDateString('en-CA'));
        }
        points.push({ label: `W${8 - i}`, dateKeys: weekDates });
      }
    } else if (activeTab === 'months') {
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthStr = d.toLocaleDateString('en-US', { month: 'short' });
        const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const daysInMonth: string[] = [];
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        for (let day = 1; day <= lastDay; day++) {
          daysInMonth.push(`${prefix}-${String(day).padStart(2, '0')}`);
        }
        points.push({ label: monthStr, dateKeys: daysInMonth });
      }
    } else {
      // Year view
      for (let i = 2; i >= 0; i--) {
        const year = now.getFullYear() - i;
        const yearDays: string[] = [];
        const start = new Date(year, 0, 1);
        const end = new Date(year, 11, 31);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          yearDays.push(d.toLocaleDateString('en-CA'));
        }
        points.push({ label: `${year}`, dateKeys: yearDays });
      }
    }

    let totalMins = 0;
    let totalCompleted = 0;
    let totalAllTasks = 0;
    let peakH = 0;
    let peakLbl = '';

    const aggregated = points.map(pt => {
      const logs = allLogs.filter(l => pt.dateKeys.includes(l.date));
      const tasks = allTasks.filter(t => pt.dateKeys.includes(t.date));
      const completed = tasks.filter(t => t.isCompleted).length;

      const mins = logs.reduce((acc, l) => acc + (l.minutes || 0), 0);
      const hours = Math.round((mins / 60) * 10) / 10;
      const pomodoros = Math.round(mins / 25);

      totalMins += mins;
      totalCompleted += completed;
      totalAllTasks += tasks.length;

      if (hours > peakH) {
        peakH = hours;
        peakLbl = pt.label;
      }

      return {
        label: pt.label,
        hours,
        tasks: completed,
        totalTasks: tasks.length,
        pomodoros,
      };
    });

    const hoursTotal = Math.round((totalMins / 60) * 10) / 10;
    const completionRate = totalAllTasks > 0 ? Math.round((totalCompleted / totalAllTasks) * 100) : 0;

    setChartData(aggregated);
    setSummary({
      hours: hoursTotal,
      tasks: totalCompleted,
      pomodoros: Math.round(totalMins / 25),
      completion: completionRate,
      peakHours: peakH,
      peakLabel: peakLbl || 'None',
    });
  };

  useEffect(() => {
    loadAnalyticsData();
    const unsubscribe = syncEngine.subscribe(() => {
      loadAnalyticsData();
    });
    return () => unsubscribe();
  }, [activeTab]);

  // Tab click handler: clicking active tab compresses it; clicking another expands it
  const handleTabClick = (tab: TimeframeMode) => {
    if (activeTab === tab) {
      setIsSectionOpen(prev => !prev);
    } else {
      setActiveTab(tab);
      setIsSectionOpen(true);
    }
  };

  // Weekly Ranking calculation (Top productive days in the past 7 days)
  const weeklyRanking = useMemo(() => {
    const last7Days = dailyBreakdowns.slice(-7);
    const sorted = [...last7Days].sort((a, b) => b.hours - a.hours || b.completedTasks - a.completedTasks);
    return sorted;
  }, [dailyBreakdowns]);

  const cards = [
    {
      label: 'HOURS TAKEN',
      value: `${summary.hours}h`,
      sub: 'Total focused work',
      icon: <Clock size={20} />,
      color: '#38bdf8',
    },
    {
      label: 'TASKS COMPLETED',
      value: summary.tasks,
      sub: `${summary.completion}% completion rate`,
      icon: <CheckCircle2 size={20} />,
      color: '#22c55e',
    },
    {
      label: 'POMODORO SESSIONS',
      value: `${summary.pomodoros} 🍅`,
      sub: '25m Focus blocks',
      icon: <Flame size={20} />,
      color: '#f59e0b',
    },
    {
      label: 'PEAK FOCUS',
      value: `${summary.peakHours}h`,
      sub: summary.peakLabel ? `On ${summary.peakLabel}` : 'Best period',
      icon: <Target size={20} />,
      color: '#a855f7',
    },
  ];

  const chartHeightPrimary = isExpandedGraphs ? (isPhone ? 280 : 360) : (isPhone ? 180 : 220);
  const chartHeightSecondary = isExpandedGraphs ? (isPhone ? 240 : 300) : (isPhone ? 160 : 200);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%' }}>

      {/* ── 1. HEADER & CONTROLS ── */}
      <div
        className="v-card"
        style={{
          padding: isPhone ? '18px 16px' : '24px 28px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1
              className="font-bloody"
              style={{
                fontSize: isPhone ? 28 : 38,
                margin: 0,
                lineHeight: 1,
                color: 'var(--text-primary)',
              }}
            >
              ANALYTICS
            </h1>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: 999,
                background: 'rgba(56, 189, 248, 0.15)',
                color: 'var(--accent-color)',
                border: '1px solid var(--accent-glow)',
              }}
            >
              LIVE SYNC
            </span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Track hours taken, completed tasks, Pomodoro sessions, and peak focus
          </p>
        </div>

        {/* Graphs toggle */}
        <button
          type="button"
          onClick={() => setIsExpandedGraphs(prev => !prev)}
          className="v-pill-btn"
          style={{ padding: '8px 16px', fontSize: 13, gap: 8 }}
          title={isExpandedGraphs ? 'Compress Graphs' : 'Expand Graphs'}
        >
          {isExpandedGraphs ? (
            <>
              <Minimize2 size={15} style={{ color: 'var(--accent-color)' }} />
              <span>Compress Graphs</span>
            </>
          ) : (
            <>
              <Maximize2 size={15} style={{ color: 'var(--accent-color)' }} />
              <span>Expand Graphs</span>
            </>
          )}
        </button>
      </div>

      {/* ── 2. EXPANDABLE BUTTONS (Days, Weeks, Months, Year, and Weekly Ranking at the end) ── */}
      <div
        className="v-card"
        style={{
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          EXPANDABLE ANALYTICS VIEWS
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {/* Days button */}
          <button
            type="button"
            onClick={() => handleTabClick('days')}
            className={`v-pill-btn${activeTab === 'days' && isSectionOpen ? ' v-pill-btn-primary' : ''}`}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, gap: 6 }}
          >
            <Calendar size={14} />
            <span>Days</span>
            {activeTab === 'days' && (isSectionOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
          </button>

          {/* Weeks button */}
          <button
            type="button"
            onClick={() => handleTabClick('weeks')}
            className={`v-pill-btn${activeTab === 'weeks' && isSectionOpen ? ' v-pill-btn-primary' : ''}`}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, gap: 6 }}
          >
            <Layers size={14} />
            <span>Weeks</span>
            {activeTab === 'weeks' && (isSectionOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
          </button>

          {/* Months button */}
          <button
            type="button"
            onClick={() => handleTabClick('months')}
            className={`v-pill-btn${activeTab === 'months' && isSectionOpen ? ' v-pill-btn-primary' : ''}`}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, gap: 6 }}
          >
            <BarChart3 size={14} />
            <span>Months</span>
            {activeTab === 'months' && (isSectionOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
          </button>

          {/* Year button */}
          <button
            type="button"
            onClick={() => handleTabClick('year')}
            className={`v-pill-btn${activeTab === 'year' && isSectionOpen ? ' v-pill-btn-primary' : ''}`}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, gap: 6 }}
          >
            <Award size={14} />
            <span>Year</span>
            {activeTab === 'year' && (isSectionOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
          </button>

          {/* ── AT THE END: WEEKLY RANKING BUTTON ── */}
          <button
            type="button"
            onClick={() => handleTabClick('ranking')}
            className={`v-pill-btn${activeTab === 'ranking' && isSectionOpen ? ' v-pill-btn-primary' : ''}`}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 700,
              gap: 6,
              borderColor: '#f59e0b',
              color: activeTab === 'ranking' && isSectionOpen ? '#000' : '#f59e0b',
              marginLeft: 'auto',
            }}
          >
            <Trophy size={15} />
            <span>Weekly Ranking</span>
            {activeTab === 'ranking' && (isSectionOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
          </button>
        </div>
      </div>

      {/* ── 3. FOUR SUMMARY METRIC CARDS ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
          gap: 14,
        }}
      >
        {cards.map(c => (
          <div
            key={c.label}
            className="v-card"
            style={{
              padding: isPhone ? '16px 14px' : '20px 22px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              borderLeft: `4px solid ${c.color}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: c.color }}>
              {c.icon}
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                {c.label}
              </span>
            </div>
            <div
              className="font-bloody"
              style={{
                fontSize: isPhone ? 26 : 32,
                fontWeight: 700,
                color: 'var(--text-primary)',
                lineHeight: 1.1,
              }}
            >
              {c.value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {c.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ── 4. EXPANDABLE SECTION (COMPRESSED WHEN BUTTON CLICKED AGAIN) ── */}
      {isSectionOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* ── IF "RANKING" SELECTED: WEEKLY RANKING DASHBOARD ── */}
          {activeTab === 'ranking' && (
            <div
              className="v-card"
              style={{
                padding: isPhone ? '20px 16px' : '28px 32px',
                display: 'flex',
                flexDirection: 'column',
                gap: 18,
                border: '2px solid #f59e0b',
                boxShadow: '0 0 35px rgba(245, 158, 11, 0.25)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Trophy size={24} style={{ color: '#f59e0b' }} />
                <div>
                  <h2
                    className="font-bloody"
                    style={{
                      fontSize: isPhone ? 22 : 28,
                      margin: 0,
                      color: 'var(--text-primary)',
                      letterSpacing: '0.02em',
                    }}
                  >
                    WEEKLY PRODUCTIVITY RANKING
                  </h2>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                    Leaderboard of your most focused days in the past 7 days
                  </div>
                </div>
              </div>

              {/* Ranking Leaderboard */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
                {weeklyRanking.map((day, idx) => {
                  const rankIcons = ['🥇', '🥈', '🥉', '#4', '#5', '#6', '#7'];
                  const isTop3 = idx < 3;

                  return (
                    <div
                      key={day.date}
                      style={{
                        padding: '14px 18px',
                        borderRadius: 14,
                        background: isTop3 ? 'rgba(245, 158, 11, 0.1)' : 'var(--v-glass-bg-subtle)',
                        border: `1.5px solid ${isTop3 ? '#f59e0b' : 'var(--v-glass-border-subtle)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>
                          {rankIcons[idx]}
                        </span>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                            {day.dayName}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            Peak Task: <strong>{day.peakTaskName}</strong> {day.peakTaskMinutes > 0 ? `(${day.peakTaskMinutes}m)` : ''}
                          </div>
                        </div>
                      </div>

                      {/* Rank Metrics */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace' }}>
                            {day.hours}h
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Hours Taken</div>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#22c55e', fontFamily: 'monospace' }}>
                            {day.completedTasks} / {day.totalTasks}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Tasks Done</div>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#f59e0b', fontFamily: 'monospace' }}>
                            {day.pomodoros} 🍅
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sessions</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── IF "DAYS" SELECTED: DAILY ANALYTICS BARS (EXPANDABLE PER DAY) ── */}
          {activeTab === 'days' && (
            <div
              className="v-card"
              style={{
                padding: isPhone ? '18px 16px' : '24px 28px',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h2
                    className="font-bloody"
                    style={{
                      fontSize: isPhone ? 20 : 24,
                      margin: 0,
                      color: 'var(--text-primary)',
                    }}
                  >
                    DAILY ANALYTICS BREAKDOWN (CLICK TO EXPAND/COMPRESS EACH DAY)
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Shows Hours Taken, Tasks Completed, Pomodoro Sessions, and Peak Focus for each day
                  </div>
                </div>
              </div>

              {/* Day-by-Day Expandable List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {dailyBreakdowns.map(day => {
                  const isDayExpanded = expandedDayId === day.date;

                  return (
                    <div
                      key={day.date}
                      style={{
                        borderRadius: 14,
                        background: isDayExpanded ? 'var(--v-glass-bg-hover)' : 'var(--v-glass-bg-subtle)',
                        border: `1.5px solid ${isDayExpanded ? 'var(--accent-color)' : 'var(--v-glass-border-subtle)'}`,
                        overflow: 'hidden',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      {/* Main Bar / Header for this day */}
                      <div
                        onClick={() => setExpandedDayId(isDayExpanded ? null : day.date)}
                        style={{
                          padding: isPhone ? '14px 14px' : '16px 20px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          userSelect: 'none',
                          flexWrap: 'wrap',
                          gap: 10,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                            {day.dayName}
                          </span>
                          {day.hours > 0 && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 6,
                                background: 'rgba(56, 189, 248, 0.15)',
                                color: '#38bdf8',
                              }}
                            >
                              {day.hours}h focus
                            </span>
                          )}
                        </div>

                        {/* Four Key Metrics Pills in Bar */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, color: '#38bdf8', fontWeight: 700 }}>
                            ⏱️ {day.hours}h
                          </span>
                          <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 700 }}>
                            ✓ {day.completedTasks}/{day.totalTasks}
                          </span>
                          <span style={{ fontSize: 13, color: '#f59e0b', fontWeight: 700 }}>
                            🍅 {day.pomodoros}
                          </span>
                          <span style={{ fontSize: 13, color: '#a855f7', fontWeight: 700 }}>
                            🎯 {day.peakTaskName}
                          </span>

                          <button
                            type="button"
                            className="v-circle-btn"
                            style={{ width: 28, height: 28 }}
                            aria-label="Expand day"
                          >
                            {isDayExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </div>
                      </div>

                      {/* Expanded View for this single day */}
                      {isDayExpanded && (
                        <div
                          style={{
                            padding: isPhone ? '14px' : '16px 20px',
                            borderTop: '1px solid var(--v-glass-border-subtle)',
                            background: 'rgba(0, 0, 0, 0.2)',
                            display: 'grid',
                            gridTemplateColumns: isPhone ? '1fr' : 'repeat(4, 1fr)',
                            gap: 12,
                          }}
                        >
                          {/* 1. Hours Taken */}
                          <div style={{ padding: '12px', borderRadius: 10, background: 'var(--v-glass-bg-subtle)' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8' }}>HOURS TAKEN</div>
                            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, fontFamily: 'monospace' }}>
                              {day.hours} hours
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                              Actual focus recorded
                            </div>
                          </div>

                          {/* 2. Tasks Completed */}
                          <div style={{ padding: '12px', borderRadius: 10, background: 'var(--v-glass-bg-subtle)' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#22c55e' }}>TASKS COMPLETED</div>
                            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, fontFamily: 'monospace' }}>
                              {day.completedTasks} of {day.totalTasks}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                              {day.totalTasks > 0 ? Math.round((day.completedTasks / day.totalTasks) * 100) : 0}% completion
                            </div>
                          </div>

                          {/* 3. Pomodoro Sessions */}
                          <div style={{ padding: '12px', borderRadius: 10, background: 'var(--v-glass-bg-subtle)' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>POMODORO SESSIONS</div>
                            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, fontFamily: 'monospace' }}>
                              {day.pomodoros} blocks
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                              25m focus + 5m break
                            </div>
                          </div>

                          {/* 4. Peak Focus */}
                          <div style={{ padding: '12px', borderRadius: 10, background: 'var(--v-glass-bg-subtle)' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#a855f7' }}>PEAK FOCUS TASK</div>
                            <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, color: 'var(--text-primary)' }}>
                              {day.peakTaskName}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                              {day.peakTaskMinutes > 0 ? `${day.peakTaskMinutes}m invested` : 'No task logs'}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── CHARTS (LARGE, CLEAR, RESPONSIVE, EXPANDABLE / COMPRESSIBLE) ── */}
          {/* Chart 1: Focus Hours (Area Chart) */}
          <div
            className="v-card"
            style={{
              padding: isPhone ? '20px 14px' : '28px 32px',
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <TrendingUp size={20} style={{ color: 'var(--accent-color)' }} />
                <div>
                  <h2
                    className="font-bloody"
                    style={{
                      fontSize: isPhone ? 20 : 24,
                      margin: 0,
                      color: 'var(--text-primary)',
                      letterSpacing: '0.02em',
                    }}
                  >
                    FOCUS HOURS TAKEN ({activeTab.toUpperCase()})
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Focus duration graph with readable labels
                  </div>
                </div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-color)', fontFamily: 'monospace' }}>
                Total: {summary.hours}h
              </span>
            </div>

            <div style={{ width: '100%', height: chartHeightPrimary }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="focusHoursGlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.6} />
                      <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--v-glass-border-subtle)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}
                    stroke="var(--v-glass-border-subtle)"
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}
                    stroke="var(--v-glass-border-subtle)"
                    unit="h"
                  />
                  <Tooltip content={<GlassTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="hours"
                    name="Hours Taken"
                    stroke="#38bdf8"
                    strokeWidth={3}
                    fill="url(#focusHoursGlow)"
                    activeDot={{ r: 6, fill: '#38bdf8', stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Tasks Completed (Bar Chart) */}
          <div
            className="v-card"
            style={{
              padding: isPhone ? '20px 14px' : '28px 32px',
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CheckCircle2 size={20} style={{ color: '#22c55e' }} />
                <div>
                  <h2
                    className="font-bloody"
                    style={{
                      fontSize: isPhone ? 20 : 24,
                      margin: 0,
                      color: 'var(--text-primary)',
                      letterSpacing: '0.02em',
                    }}
                  >
                    TASKS COMPLETED ({activeTab.toUpperCase()})
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Finished tasks vs planned tasks
                  </div>
                </div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', fontFamily: 'monospace' }}>
                Completed: {summary.tasks}
              </span>
            </div>

            <div style={{ width: '100%', height: chartHeightSecondary }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--v-glass-border-subtle)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}
                    stroke="var(--v-glass-border-subtle)"
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}
                    stroke="var(--v-glass-border-subtle)"
                    allowDecimals={false}
                  />
                  <Tooltip content={<GlassTooltip />} />
                  <Bar
                    dataKey="tasks"
                    name="Completed Tasks"
                    fill="#22c55e"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={48}
                  />
                  <Bar
                    dataKey="totalTasks"
                    name="Total Planned Tasks"
                    fill="rgba(255, 255, 255, 0.18)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={48}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
