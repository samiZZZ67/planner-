'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts';
import {
  Clock, CheckCircle2, Flame, Target, TrendingUp,
  Maximize2, Minimize2, Calendar, ChevronDown, ChevronUp, BarChart3, Layers
} from 'lucide-react';

export type TimeframeMode = 'days' | 'weeks' | 'months' | 'year';

interface AnalyticsScreenProps {
  isPhone: boolean;
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
  const [timeframe, setTimeframe] = useState<TimeframeMode>('days');
  const [isExpandedView, setIsExpandedView] = useState<boolean>(true);
  const [isSectionOpen, setIsSectionOpen] = useState<boolean>(true);
  const [chartData, setChartData] = useState<any[]>([]);
  const [summary, setSummary] = useState({
    hours: 0,
    tasks: 0,
    pomodoros: 0,
    completion: 0,
    avgDailyHours: 0,
    peakValue: 0,
    peakLabel: '',
  });

  const loadAnalyticsData = async () => {
    const allLogs = await db.timeLogs.filter(l => !l.deleted).toArray();
    const allTasks = await db.tasks.filter(t => !t.deleted).toArray();

    const now = new Date();
    let points: { label: string; dateKeys: string[] }[] = [];

    if (timeframe === 'days') {
      // Last 14 days
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const iso = d.toLocaleDateString('en-CA');
        const shortName = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
        points.push({ label: shortName, dateKeys: [iso] });
      }
    } else if (timeframe === 'weeks') {
      // Last 8 weeks
      for (let i = 7; i >= 0; i--) {
        const weekDates: string[] = [];
        const start = new Date(now);
        start.setDate(start.getDate() - (i * 7 + 6));
        for (let day = 0; day < 7; day++) {
          const curr = new Date(start);
          curr.setDate(curr.getDate() + day);
          weekDates.push(curr.toLocaleDateString('en-CA'));
        }
        points.push({ label: `Week ${8 - i}`, dateKeys: weekDates });
      }
    } else if (timeframe === 'months') {
      // Last 6 months
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthStr = d.toLocaleDateString('en-US', { month: 'short' });
        const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        // Gather all date keys matching prefix
        const daysInMonth: string[] = [];
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        for (let day = 1; day <= lastDay; day++) {
          daysInMonth.push(`${prefix}-${String(day).padStart(2, '0')}`);
        }
        points.push({ label: monthStr, dateKeys: daysInMonth });
      }
    } else {
      // Year view: Last 3 years
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

    // Aggregate data for each point
    let totalMinutes = 0;
    let totalCompletedTasks = 0;
    let totalAllTasks = 0;
    let peakHours = 0;
    let peakLabel = '';

    const aggregated = points.map(pt => {
      const logs = allLogs.filter(l => pt.dateKeys.includes(l.date));
      const tasks = allTasks.filter(t => pt.dateKeys.includes(t.date));
      const completed = tasks.filter(t => t.isCompleted).length;

      const mins = logs.reduce((acc, l) => acc + (l.minutes || 0), 0);
      const hours = Math.round((mins / 60) * 10) / 10;
      const pomodoros = Math.round(mins / 25);

      totalMinutes += mins;
      totalCompletedTasks += completed;
      totalAllTasks += tasks.length;

      if (hours > peakHours) {
        peakHours = hours;
        peakLabel = pt.label;
      }

      return {
        label: pt.label,
        hours,
        tasks: completed,
        totalTasks: tasks.length,
        pomodoros,
      };
    });

    const hoursTotal = Math.round((totalMinutes / 60) * 10) / 10;
    const avgDaily = points.length ? Math.round((hoursTotal / points.length) * 10) / 10 : 0;
    const completionRate = totalAllTasks > 0 ? Math.round((totalCompletedTasks / totalAllTasks) * 100) : 0;

    setChartData(aggregated);
    setSummary({
      hours: hoursTotal,
      tasks: totalCompletedTasks,
      pomodoros: Math.round(totalMinutes / 25),
      completion: completionRate,
      avgDailyHours: avgDaily,
      peakValue: peakHours,
      peakLabel: peakLabel || 'None',
    });
  };

  useEffect(() => {
    loadAnalyticsData();
    // Subscribe to syncEngine for immediate cross-device updates
    const unsubscribe = syncEngine.subscribe(() => {
      loadAnalyticsData();
    });
    return () => unsubscribe();
  }, [timeframe]);

  // Tab click handler: switches timeframe and ensures section is open
  const handleTabClick = (tab: TimeframeMode) => {
    if (timeframe === tab) {
      // Toggle expansion if already selected
      setIsSectionOpen(prev => !prev);
    } else {
      setTimeframe(tab);
      setIsSectionOpen(true);
    }
  };

  const timeframeLabels: Record<TimeframeMode, string> = {
    days: 'Days (14-Day Deep View)',
    weeks: 'Weeks (8-Week Trend)',
    months: 'Months (6-Month Overview)',
    year: 'Year (Multi-Year Archive)',
  };

  const cards = [
    {
      label: 'HOURS TAKEN',
      value: `${summary.hours}h`,
      sub: `Avg ${summary.avgDailyHours}h / period`,
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
      sub: '25m Focus Blocks',
      icon: <Flame size={20} />,
      color: '#f59e0b',
    },
    {
      label: 'PEAK FOCUS',
      value: `${summary.peakValue}h`,
      sub: summary.peakLabel ? `On ${summary.peakLabel}` : 'Active Period',
      icon: <Target size={20} />,
      color: '#a855f7',
    },
  ];

  // Responsive chart height based on expanded vs compressed view
  const chartHeightPrimary = isExpandedView ? (isPhone ? 280 : 360) : (isPhone ? 180 : 220);
  const chartHeightSecondary = isExpandedView ? (isPhone ? 240 : 300) : (isPhone ? 160 : 200);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%' }}>

      {/* ── 1. HEADER & VIEW CONTROLS ── */}
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
              LIVE
            </span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Real-time Pomodoro focus sessions and task execution insights
          </p>
        </div>

        {/* View Mode Toggle: Expanded vs Compressed */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setIsExpandedView(prev => !prev)}
            className="v-pill-btn"
            style={{
              padding: '8px 16px',
              fontSize: 13,
              gap: 8,
              borderColor: isExpandedView ? 'var(--accent-color)' : undefined,
            }}
            title={isExpandedView ? 'Switch to Compressed View' : 'Switch to Expanded View'}
          >
            {isExpandedView ? (
              <>
                <Minimize2 size={15} style={{ color: 'var(--accent-color)' }} />
                <span>Compressed View</span>
              </>
            ) : (
              <>
                <Maximize2 size={15} style={{ color: 'var(--accent-color)' }} />
                <span>Expanded View</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── 2. EXPANDABLE TIMEFRAME BUTTONS (Days, Weeks, Months, Year) ── */}
      <div
        className="v-card"
        style={{
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
            SELECT TIMEFRAME BREAKDOWN
          </div>
          <div style={{ fontSize: 12, color: 'var(--accent-color)', fontWeight: 600 }}>
            {timeframeLabels[timeframe]}
          </div>
        </div>

        {/* Expandable Tabs Row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: 10,
          }}
        >
          {(['days', 'weeks', 'months', 'year'] as TimeframeMode[]).map(tab => {
            const isActive = timeframe === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => handleTabClick(tab)}
                className={`v-pill-btn${isActive ? ' v-pill-btn-primary' : ''}`}
                style={{
                  padding: '12px 18px',
                  fontSize: 14,
                  fontWeight: 700,
                  justifyContent: 'space-between',
                  borderRadius: 14,
                  borderWidth: isActive ? 2 : 1,
                  boxShadow: isActive ? '0 0 20px var(--accent-glow)' : undefined,
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Calendar size={16} />
                  <span style={{ textTransform: 'capitalize' }}>{tab}</span>
                </div>
                {isActive ? (
                  isSectionOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />
                ) : (
                  <span style={{ fontSize: 11, opacity: 0.6 }}>Open</span>
                )}
              </button>
            );
          })}
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

      {/* ── 4. EXPANDABLE SECTION: LARGE CHARTS ── */}
      {isSectionOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

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
                    FOCUS HOURS TAKEN ({timeframe.toUpperCase()})
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Total focus duration logged per {timeframe === 'days' ? 'day' : timeframe.slice(0, -1)}
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

          {/* Chart 2: Tasks Completed vs Total (Bar Chart) */}
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
                    TASKS COMPLETED ({timeframe.toUpperCase()})
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Finished vs total tasks planned in each time block
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

          {/* Chart 3: Pomodoro Focus Sessions (Bar Chart) */}
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
                <Flame size={20} style={{ color: '#f59e0b' }} />
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
                    COMPLETED POMODORO SESSIONS ({timeframe.toUpperCase()})
                  </h2>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Total 25-minute focus intervals logged
                  </div>
                </div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', fontFamily: 'monospace' }}>
                Total: {summary.pomodoros} 🍅
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
                    dataKey="pomodoros"
                    name="Pomodoro Sessions (25m)"
                    fill="#f59e0b"
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
