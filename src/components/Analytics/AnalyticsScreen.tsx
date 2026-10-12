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
  Trophy, Medal, Award, Star, BarChart3, Layers, ChevronLeft, ChevronRight,
  RotateCcw
} from 'lucide-react';
import {
  getWeekBounds, getDaysInWeek, getAvailableWeeks, type WeekOption
} from '@/lib/plan/weeklyPlanUtils';
import { FullScreenDailyGraphModal } from './FullScreenDailyGraphModal';

export type TimeframeMode = 'days' | 'weeks' | 'months' | 'year' | 'ranking';

interface AnalyticsScreenProps {
  isPhone: boolean;
}

export interface DayBreakdown {
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

export interface RankedDay extends DayBreakdown {
  rank: number;
  isTie: boolean;
  hasData: boolean;
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
  const [isSectionOpen, setIsSectionOpen] = useState<boolean>(true);
  const [isExpandedGraphs, setIsExpandedGraphs] = useState<boolean>(true);

  // Week navigation state for daily graph & daily ranking
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const initialMonday = useMemo(() => getWeekBounds(todayStr).startDate, [todayStr]);
  const [selectedWeekStart, setSelectedWeekStart] = useState<string>(initialMonday);
  const [availableWeeks, setAvailableWeeks] = useState<WeekOption[]>([]);
  const [isFullScreenGraph, setIsFullScreenGraph] = useState<boolean>(false);

  // Ranking sub-tab: 'weekly' or 'daily'
  const [rankingSubTab, setRankingSubTab] = useState<'weekly' | 'daily'>('weekly');
  const [dailyRankingScope, setDailyRankingScope] = useState<'week' | 'all_time'>('week');
  const [dailyRankingWeekStart, setDailyRankingWeekStart] = useState<string>(initialMonday);

  // Expanded state for individual days in the daily list
  const [expandedDayId, setExpandedDayId] = useState<string | null>(null);

  const [chartData, setChartData] = useState<any[]>([]);
  const [dailyBreakdowns, setDailyBreakdowns] = useState<DayBreakdown[]>([]);
  const [allTimeTopDays, setAllTimeTopDays] = useState<RankedDay[]>([]);
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

    // 1. Compute available weeks from all actual stored dates
    const recordedDates = Array.from(
      new Set([...allLogs.map(l => l.date), ...allTasks.map(t => t.date), todayStr])
    ).filter(Boolean);
    const weeks = getAvailableWeeks(recordedDates);
    setAvailableWeeks(weeks);

    const now = new Date();

    // 2. Compute All-Time Top Days (across entire stored history)
    const allUniqueDates = Array.from(new Set([...allLogs.map(l => l.date), ...allTasks.map(t => t.date)])).filter(Boolean);
    const historicalDays: DayBreakdown[] = allUniqueDates.map(iso => {
      const dayLogs = allLogs.filter(l => l.date === iso);
      const dayTasks = allTasks.filter(t => t.date === iso);
      const mins = dayLogs.reduce((sum, l) => sum + (l.minutes || 0), 0);
      const hours = Math.round((mins / 60) * 10) / 10;
      const completed = dayTasks.filter(t => t.isCompleted).length;
      const pomodoros = Math.round(mins / 25);

      const [y, m, d] = iso.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      const dayName = dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toUpperCase();
      const shortDisplay = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

      let topTaskId = '';
      let topMins = 0;
      const taskMinutesMap: Record<string, number> = {};
      for (const log of dayLogs) {
        taskMinutesMap[log.taskId] = (taskMinutesMap[log.taskId] || 0) + (log.minutes || 0);
      }
      for (const [tId, tMins] of Object.entries(taskMinutesMap)) {
        if (tMins > topMins) {
          topMins = tMins;
          topTaskId = tId;
        }
      }
      const topTask = dayTasks.find(t => t.id === topTaskId);
      const peakTaskName = topTask ? topTask.title : topMins > 0 ? 'Logged Focus' : 'None';

      return {
        date: iso,
        dayName: `${dayName} (${shortDisplay})`,
        hours,
        completedTasks: completed,
        totalTasks: dayTasks.length,
        pomodoros,
        peakTaskName,
        peakTaskMinutes: topMins,
        taskTitles: dayTasks.map(t => ({ title: t.title, completed: t.isCompleted })),
      };
    }).filter(d => d.hours > 0 || d.completedTasks > 0);

    const sortedAllTime = [...historicalDays].sort((a, b) => b.hours - a.hours || b.completedTasks - a.completedTasks).slice(0, 10);
    let allTimeRank = 1;
    const rankedAllTime: RankedDay[] = sortedAllTime.map((day, idx, arr) => {
      if (idx > 0) {
        const prev = arr[idx - 1];
        if (prev.hours !== day.hours || prev.completedTasks !== day.completedTasks) {
          allTimeRank = idx + 1;
        }
      }
      return {
        ...day,
        rank: allTimeRank,
        isTie: idx > 0 && arr[idx - 1].hours === day.hours && arr[idx - 1].completedTasks === day.completedTasks,
        hasData: true,
      };
    });
    setAllTimeTopDays(rankedAllTime);

    // 3. Generate Daily Breakdowns for the selected week
    const currentWeekStart = activeTab === 'days' ? selectedWeekStart : initialMonday;
    const weekDates = getDaysInWeek(currentWeekStart);

    const weekDaysList: DayBreakdown[] = weekDates.map(iso => {
      const dayLogs = allLogs.filter(l => l.date === iso);
      const dayTasks = allTasks.filter(t => t.date === iso);

      const mins = dayLogs.reduce((sum, l) => sum + (l.minutes || 0), 0);
      const hours = Math.round((mins / 60) * 10) / 10;
      const completed = dayTasks.filter(t => t.isCompleted).length;
      const pomodoros = Math.round(mins / 25);

      const [y, m, d] = iso.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      const dayName = dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toUpperCase();
      const shortDisplay = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

      let topTaskId = '';
      let topMins = 0;
      const taskMinutesMap: Record<string, number> = {};
      for (const log of dayLogs) {
        taskMinutesMap[log.taskId] = (taskMinutesMap[log.taskId] || 0) + (log.minutes || 0);
      }
      for (const [tId, tMins] of Object.entries(taskMinutesMap)) {
        if (tMins > topMins) {
          topMins = tMins;
          topTaskId = tId;
        }
      }
      const topTask = dayTasks.find(t => t.id === topTaskId);
      const peakTaskName = topTask ? topTask.title : topMins > 0 ? 'Logged Focus' : 'None';

      return {
        date: iso,
        dayName: `${dayName} (${shortDisplay})`,
        hours,
        completedTasks: completed,
        totalTasks: dayTasks.length,
        pomodoros,
        peakTaskName,
        peakTaskMinutes: topMins,
        taskTitles: dayTasks.map(t => ({ title: t.title, completed: t.isCompleted })),
      };
    });

    // Requirement 1 & 2: order should be current/latest day FIRST for display list
    const orderedForDisplay = [...weekDaysList].sort((a, b) => b.date.localeCompare(a.date));
    setDailyBreakdowns(orderedForDisplay);

    // 4. Aggregate chart data depending on activeTab
    let points: { label: string; dateKeys: string[] }[] = [];

    if (activeTab === 'days') {
      // 7 days of the selected week in chronological order for graph (Mon -> Sun)
      points = weekDaysList.map(d => {
        const parts = d.dayName.split(' ');
        const dayShort = parts[0]?.slice(0, 3) || 'DAY';
        const dateShort = d.date.slice(5); // MM-DD
        return {
          label: `${dayShort} (${dateShort})`,
          dateKeys: [d.date],
        };
      });
    } else if (activeTab === 'weeks' || activeTab === 'ranking') {
      for (let i = 7; i >= 0; i--) {
        const weekDatesArr: string[] = [];
        const start = new Date(now);
        start.setDate(start.getDate() - (i * 7 + 6));
        for (let day = 0; day < 7; day++) {
          const curr = new Date(start);
          curr.setDate(curr.getDate() + day);
          weekDatesArr.push(curr.toLocaleDateString('en-CA'));
        }
        points.push({ label: `W${8 - i}`, dateKeys: weekDatesArr });
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
  }, [activeTab, selectedWeekStart]);

  // Tab click handler
  const handleTabClick = (tab: TimeframeMode | 'daily_ranking') => {
    if (tab === 'daily_ranking') {
      setActiveTab('ranking');
      setRankingSubTab('daily');
      setIsSectionOpen(true);
      return;
    }
    if (tab === 'ranking') {
      if (activeTab === 'ranking' && rankingSubTab === 'weekly') {
        setIsSectionOpen(prev => !prev);
      } else {
        setActiveTab('ranking');
        setRankingSubTab('weekly');
        setIsSectionOpen(true);
      }
      return;
    }
    if (activeTab === tab) {
      setIsSectionOpen(prev => !prev);
    } else {
      setActiveTab(tab);
      setIsSectionOpen(true);
    }
  };

  // Weekly Ranking calculation (Top productive days in the past 7 days)
  const weeklyRanking = useMemo(() => {
    // Take past 7 days, sorted by hours then tasks
    const last7 = dailyBreakdowns.slice(0, 7);
    return [...last7].sort((a, b) => b.hours - a.hours || b.completedTasks - a.completedTasks);
  }, [dailyBreakdowns]);

  // Daily Ranking calculation for the selected week
  const [dailyRankingDays, setDailyRankingDays] = useState<RankedDay[]>([]);
  useEffect(() => {
    async function loadDailyRankingWeek() {
      const allLogs = await db.timeLogs.filter(l => !l.deleted).toArray();
      const allTasks = await db.tasks.filter(t => !t.deleted).toArray();

      const weekDates = getDaysInWeek(dailyRankingWeekStart);
      const daysList: DayBreakdown[] = weekDates.map(iso => {
        const dayLogs = allLogs.filter(l => l.date === iso);
        const dayTasks = allTasks.filter(t => t.date === iso);
        const mins = dayLogs.reduce((sum, l) => sum + (l.minutes || 0), 0);
        const hours = Math.round((mins / 60) * 10) / 10;
        const completed = dayTasks.filter(t => t.isCompleted).length;
        const pomodoros = Math.round(mins / 25);

        const [y, m, d] = iso.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        const dayName = dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toUpperCase();
        const shortDisplay = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

        let topTaskId = '';
        let topMins = 0;
        const taskMinutesMap: Record<string, number> = {};
        for (const log of dayLogs) {
          taskMinutesMap[log.taskId] = (taskMinutesMap[log.taskId] || 0) + (log.minutes || 0);
        }
        for (const [tId, tMins] of Object.entries(taskMinutesMap)) {
          if (tMins > topMins) {
            topMins = tMins;
            topTaskId = tId;
          }
        }
        const topTask = dayTasks.find(t => t.id === topTaskId);
        const peakTaskName = topTask ? topTask.title : topMins > 0 ? 'Logged Focus' : 'None';

        return {
          date: iso,
          dayName: `${dayName} (${shortDisplay})`,
          hours,
          completedTasks: completed,
          totalTasks: dayTasks.length,
          pomodoros,
          peakTaskName,
          peakTaskMinutes: topMins,
          taskTitles: dayTasks.map(t => ({ title: t.title, completed: t.isCompleted })),
        };
      });

      // Sort descending by hours, then completed tasks
      const sorted = [...daysList].sort((a, b) => b.hours - a.hours || b.completedTasks - a.completedTasks);
      let rank = 1;
      const ranked: RankedDay[] = sorted.map((day, idx, arr) => {
        if (idx > 0) {
          const prev = arr[idx - 1];
          if (prev.hours !== day.hours || prev.completedTasks !== day.completedTasks) {
            rank = idx + 1;
          }
        }
        return {
          ...day,
          rank,
          isTie: idx > 0 && arr[idx - 1].hours === day.hours && arr[idx - 1].completedTasks === day.completedTasks,
          hasData: day.hours > 0 || day.totalTasks > 0,
        };
      });

      setDailyRankingDays(ranked);
    }

    loadDailyRankingWeek();
  }, [dailyRankingWeekStart]);

  // Week navigation index calculations
  const currentWeekIdx = availableWeeks.findIndex(w => w.startDate === selectedWeekStart);
  const canGoPrevWeek = currentWeekIdx < availableWeeks.length - 1;
  const canGoNextWeek = currentWeekIdx > 0;

  const handleShiftWeek = (delta: number) => {
    const nextIdx = currentWeekIdx - delta;
    if (nextIdx >= 0 && nextIdx < availableWeeks.length) {
      setSelectedWeekStart(availableWeeks[nextIdx].startDate);
    }
  };

  const dailyRankIdx = availableWeeks.findIndex(w => w.startDate === dailyRankingWeekStart);
  const canGoPrevDailyRank = dailyRankIdx < availableWeeks.length - 1;
  const canGoNextDailyRank = dailyRankIdx > 0;

  const handleDailyRankingShift = (delta: number) => {
    const nextIdx = dailyRankIdx - delta;
    if (nextIdx >= 0 && nextIdx < availableWeeks.length) {
      setDailyRankingWeekStart(availableWeeks[nextIdx].startDate);
    }
  };

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

  const selectedWeekObj = availableWeeks.find(w => w.startDate === selectedWeekStart) || availableWeeks[0];
  const dailyRankWeekObj = availableWeeks.find(w => w.startDate === dailyRankingWeekStart) || availableWeeks[0];

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

        {/* Top Action Buttons: Fullscreen Daily Graph & Compress/Expand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setIsFullScreenGraph(true)}
            className="v-pill-btn v-pill-btn-primary"
            style={{ padding: '8px 16px', fontSize: 13, gap: 7, fontWeight: 700 }}
            title="Open Dedicated Full-Screen Daily Graph with Week Navigation"
          >
            <Maximize2 size={14} />
            <span>Full-Screen Daily Graph</span>
          </button>

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
                <span>Compress</span>
              </>
            ) : (
              <>
                <Maximize2 size={15} style={{ color: 'var(--accent-color)' }} />
                <span>Expand</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── 2. EXPANDABLE BUTTONS (Days, Weeks, Months, Year, Weekly Ranking, Daily Ranking) ── */}
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

          {/* ── WEEKLY & DAILY RANKING BUTTONS ── */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => handleTabClick('ranking')}
              className={`v-pill-btn${activeTab === 'ranking' && rankingSubTab === 'weekly' && isSectionOpen ? ' v-pill-btn-primary' : ''}`}
              style={{
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 700,
                gap: 6,
                borderColor: '#f59e0b',
                color: activeTab === 'ranking' && rankingSubTab === 'weekly' && isSectionOpen ? '#000' : '#f59e0b',
              }}
            >
              <Trophy size={14} />
              <span>Weekly Ranking</span>
              {activeTab === 'ranking' && rankingSubTab === 'weekly' && (isSectionOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
            </button>

            <button
              type="button"
              onClick={() => handleTabClick('daily_ranking')}
              className={`v-pill-btn${activeTab === 'ranking' && rankingSubTab === 'daily' && isSectionOpen ? ' v-pill-btn-primary' : ''}`}
              style={{
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 700,
                gap: 6,
                borderColor: '#38bdf8',
                color: activeTab === 'ranking' && rankingSubTab === 'daily' && isSectionOpen ? '#000' : '#38bdf8',
              }}
            >
              <Medal size={14} />
              <span>Daily Ranking</span>
              {activeTab === 'ranking' && rankingSubTab === 'daily' && (isSectionOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
            </button>
          </div>
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

          {/* ── RANKING DASHBOARD (WEEKLY & DAILY RANKING TOGGLE) ── */}
          {activeTab === 'ranking' && (
            <div
              className="v-card"
              style={{
                padding: isPhone ? '20px 16px' : '28px 32px',
                display: 'flex',
                flexDirection: 'column',
                gap: 18,
                border: `2px solid ${rankingSubTab === 'weekly' ? '#f59e0b' : '#38bdf8'}`,
                boxShadow: rankingSubTab === 'weekly'
                  ? '0 0 35px rgba(245, 158, 11, 0.25)'
                  : '0 0 35px rgba(56, 189, 248, 0.25)',
              }}
            >
              {/* Ranking Header with Sub-Tabs */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {rankingSubTab === 'weekly' ? (
                    <Trophy size={26} style={{ color: '#f59e0b' }} />
                  ) : (
                    <Medal size={26} style={{ color: '#38bdf8' }} />
                  )}
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
                      {rankingSubTab === 'weekly' ? 'WEEKLY PRODUCTIVITY RANKING' : 'DAILY PRODUCTIVITY RANKING'}
                    </h2>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                      {rankingSubTab === 'weekly'
                        ? 'Leaderboard of your most focused days in the past 7 days'
                        : 'Leaderboard of individual days across weeks with tie-breaking and historical navigation'}
                    </div>
                  </div>
                </div>

                {/* Sub-tab switcher */}
                <div style={{ display: 'flex', gap: 6, background: 'rgba(0, 0, 0, 0.3)', padding: 4, borderRadius: 12 }}>
                  <button
                    type="button"
                    onClick={() => setRankingSubTab('weekly')}
                    className={`v-pill-btn${rankingSubTab === 'weekly' ? ' v-pill-btn-primary' : ''}`}
                    style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, gap: 5 }}
                  >
                    <Trophy size={13} />
                    <span>Weekly</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRankingSubTab('daily')}
                    className={`v-pill-btn${rankingSubTab === 'daily' ? ' v-pill-btn-primary' : ''}`}
                    style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, gap: 5 }}
                  >
                    <Medal size={13} />
                    <span>Daily</span>
                  </button>
                </div>
              </div>

              {/* ── DAILY RANKING CONTROLS (Week selector & All-Time toggle) ── */}
              {rankingSubTab === 'daily' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 10,
                    padding: '12px 16px',
                    borderRadius: 12,
                    background: 'var(--v-glass-bg-subtle)',
                    border: '1px solid var(--v-glass-border-subtle)',
                  }}
                >
                  {/* Left: Scope Selector */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setDailyRankingScope('week')}
                      className={`v-pill-btn${dailyRankingScope === 'week' ? ' v-pill-btn-primary' : ''}`}
                      style={{ padding: '5px 12px', fontSize: 12 }}
                    >
                      Selected Week
                    </button>
                    <button
                      type="button"
                      onClick={() => setDailyRankingScope('all_time')}
                      className={`v-pill-btn${dailyRankingScope === 'all_time' ? ' v-pill-btn-primary' : ''}`}
                      style={{ padding: '5px 12px', fontSize: 12 }}
                    >
                      All-Time Top 10 Days
                    </button>
                  </div>

                  {/* Right: Week Navigator (when scope is 'week') */}
                  {dailyRankingScope === 'week' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => handleDailyRankingShift(-1)}
                        disabled={!canGoPrevDailyRank}
                        className="v-pill-btn"
                        style={{ padding: '5px 10px', fontSize: 11, gap: 4, opacity: canGoPrevDailyRank ? 1 : 0.4 }}
                      >
                        <ChevronLeft size={13} />
                        <span>Prev</span>
                      </button>

                      <select
                        value={dailyRankingWeekStart}
                        onChange={e => setDailyRankingWeekStart(e.target.value)}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 8,
                          background: 'var(--v-glass-bg-card)',
                          color: 'var(--text-primary)',
                          border: '1.5px solid #38bdf8',
                          fontSize: 12,
                          fontWeight: 700,
                          outline: 'none',
                        }}
                      >
                        {availableWeeks.map(w => (
                          <option key={w.startDate} value={w.startDate} style={{ background: 'var(--v-app-bg)', color: 'var(--text-primary)' }}>
                            {w.isCurrentWeek ? `⭐ Current: ${w.weekLabel}` : w.weekLabel}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => handleDailyRankingShift(1)}
                        disabled={!canGoNextDailyRank}
                        className="v-pill-btn"
                        style={{ padding: '5px 10px', fontSize: 11, gap: 4, opacity: canGoNextDailyRank ? 1 : 0.4 }}
                      >
                        <span>Next</span>
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Leaderboard Items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                {rankingSubTab === 'weekly' ? (
                  // Weekly Ranking list
                  weeklyRanking.map((day, idx) => {
                    const rankIcons = ['🥇', '🥈', '🥉', '#4', '#5', '#6', '#7'];
                    const isTop3 = idx < 3;
                    const completionPct = day.totalTasks > 0 ? Math.round((day.completedTasks / day.totalTasks) * 100) : 0;

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
                            {rankIcons[idx] || `#${idx + 1}`}
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
                              {day.completedTasks} / {day.totalTasks} ({completionPct}%)
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
                  })
                ) : (
                  // Daily Ranking List
                  (() => {
                    const listToRender = dailyRankingScope === 'week' ? dailyRankingDays : allTimeTopDays;
                    if (listToRender.length === 0 || !listToRender.some(d => d.hours > 0 || d.completedTasks > 0)) {
                      return (
                        <div
                          style={{
                            padding: '24px',
                            textAlign: 'center',
                            color: 'var(--text-muted)',
                            background: 'var(--v-glass-bg-subtle)',
                            borderRadius: 12,
                          }}
                        >
                          <Calendar size={28} style={{ color: '#38bdf8', margin: '0 auto 8px' }} />
                          <div style={{ fontSize: 14, fontWeight: 700 }}>
                            No activity recorded to rank for this week
                          </div>
                          <div style={{ fontSize: 12, marginTop: 4 }}>
                            Complete tasks or log focus timer blocks to see daily leaderboard rankings.
                          </div>
                        </div>
                      );
                    }

                    return listToRender.map((day) => {
                      const rankBadge =
                        day.rank === 1 ? '🥇' : day.rank === 2 ? '🥈' : day.rank === 3 ? '🥉' : `#${day.rank}`;
                      const isTop3 = day.rank <= 3;
                      const completionPct = day.totalTasks > 0 ? Math.round((day.completedTasks / day.totalTasks) * 100) : 0;

                      return (
                        <div
                          key={day.date}
                          style={{
                            padding: '14px 18px',
                            borderRadius: 14,
                            background: isTop3 ? 'rgba(56, 189, 248, 0.1)' : 'var(--v-glass-bg-subtle)',
                            border: `1.5px solid ${isTop3 ? '#38bdf8' : 'var(--v-glass-border-subtle)'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 12,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: 20, width: 32, textAlign: 'center', fontWeight: 800 }}>
                              {rankBadge}
                            </span>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                                  {day.dayName}
                                </span>
                                {day.isTie && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 800,
                                      padding: '1px 6px',
                                      borderRadius: 4,
                                      background: 'rgba(255, 255, 255, 0.1)',
                                      color: 'var(--text-muted)',
                                    }}
                                  >
                                    Tie
                                  </span>
                                )}
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
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Focus Time</div>
                            </div>

                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 16, fontWeight: 800, color: '#22c55e', fontFamily: 'monospace' }}>
                                {day.completedTasks} / {day.totalTasks} ({completionPct}%)
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
                    });
                  })()
                )}
              </div>
            </div>
          )}

          {/* ── IF "DAYS" SELECTED: DAILY ANALYTICS BARS WITH WEEK NAVIGATION ── */}
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
              {/* Header and Week Navigation Bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <h2
                    className="font-bloody"
                    style={{
                      fontSize: isPhone ? 20 : 24,
                      margin: 0,
                      color: 'var(--text-primary)',
                    }}
                  >
                    DAILY ANALYTICS BREAKDOWN ({selectedWeekObj?.weekLabel || 'Current Week'})
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Current day displayed first with task counts, percentage, focus hours, and peak tasks
                  </div>
                </div>

                {/* Week Navigator Controls Bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => handleShiftWeek(-1)}
                    disabled={!canGoPrevWeek}
                    className="v-pill-btn"
                    style={{ padding: '6px 12px', fontSize: 12, gap: 4, opacity: canGoPrevWeek ? 1 : 0.4 }}
                    title="Navigate to earlier historical week"
                  >
                    <ChevronLeft size={14} />
                    <span>Prev Week</span>
                  </button>

                  <select
                    value={selectedWeekStart}
                    onChange={e => setSelectedWeekStart(e.target.value)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      background: 'var(--v-glass-bg-card)',
                      color: 'var(--text-primary)',
                      border: '1.5px solid var(--accent-color)',
                      fontSize: 12,
                      fontWeight: 700,
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {availableWeeks.map(w => (
                      <option key={w.startDate} value={w.startDate} style={{ background: 'var(--v-app-bg)', color: 'var(--text-primary)' }}>
                        {w.isCurrentWeek ? `⭐ Current: ${w.weekLabel}` : w.weekLabel}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => handleShiftWeek(1)}
                    disabled={!canGoNextWeek}
                    className="v-pill-btn"
                    style={{ padding: '6px 12px', fontSize: 12, gap: 4, opacity: canGoNextWeek ? 1 : 0.4 }}
                    title="Navigate to newer week"
                  >
                    <span>Next Week</span>
                    <ChevronRight size={14} />
                  </button>

                  {!selectedWeekObj?.isCurrentWeek && (
                    <button
                      type="button"
                      onClick={() => setSelectedWeekStart(initialMonday)}
                      className="v-pill-btn"
                      style={{ padding: '6px 10px', fontSize: 11, borderColor: 'var(--accent-color)', color: 'var(--accent-color)' }}
                      title="Jump to current week"
                    >
                      <RotateCcw size={12} />
                      <span>Current</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Day-by-Day Expandable List (ORDER: Current day first) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {dailyBreakdowns.map(day => {
                  const isDayExpanded = expandedDayId === day.date;
                  const completionPct = day.totalTasks > 0 ? Math.round((day.completedTasks / day.totalTasks) * 100) : 0;

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

                        {/* Four Key Metrics Pills in Bar: shows completed/total task count and % */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, color: '#38bdf8', fontWeight: 700 }}>
                            ⏱️ {day.hours}h
                          </span>
                          <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 700 }}>
                            ✓ {day.completedTasks}/{day.totalTasks} ({completionPct}%)
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
                              {completionPct}% completion rate
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
                    FOCUS HOURS TAKEN ({activeTab === 'days' ? `${selectedWeekObj?.weekLabel || 'WEEK'}` : activeTab.toUpperCase()})
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Focus duration graph with readable labels and tooltips
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-color)', fontFamily: 'monospace' }}>
                  Total: {summary.hours}h
                </span>
                <button
                  type="button"
                  onClick={() => setIsFullScreenGraph(true)}
                  className="v-circle-btn"
                  style={{ width: 32, height: 32 }}
                  title="Open Full Screen Graph"
                >
                  <Maximize2 size={14} />
                </button>
              </div>
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
                    TASKS COMPLETED ({activeTab === 'days' ? `${selectedWeekObj?.weekLabel || 'WEEK'}` : activeTab.toUpperCase()})
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
                    name="Tasks Completed"
                    fill="#22c55e"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={44}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ── 5. FULL-SCREEN DEDICATED GRAPH MODAL ── */}
      <FullScreenDailyGraphModal
        isOpen={isFullScreenGraph}
        onClose={() => setIsFullScreenGraph(false)}
        selectedWeekStart={selectedWeekStart}
        onSelectWeekStart={(start) => setSelectedWeekStart(start)}
        availableWeeks={availableWeeks}
        chartData={chartData}
        weekDaysBreakdowns={dailyBreakdowns}
        summary={summary}
        isPhone={isPhone}
      />
    </div>
  );
}
