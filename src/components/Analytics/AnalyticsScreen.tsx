'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/db';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';
import { Clock, CheckCircle2, Flame, Target, TrendingUp } from 'lucide-react';

type Range = 7 | 28 | 90;

interface AnalyticsScreenProps {
  isPhone: boolean;
}

function getDaysInRange(n: number): string[] {
  const result: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    result.push(d.toLocaleDateString('en-CA'));
  }
  return result;
}

const GlassTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'var(--v-glass-bg-card)',
        backdropFilter: 'blur(16px)',
        border: '1.5px solid var(--v-glass-border)',
        borderRadius: 12,
        padding: '10px 14px',
        boxShadow: 'var(--v-shadow-card)',
        color: 'var(--text-primary)',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ fontSize: 13, fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
          <span>{p.name}:</span>
          <span>{p.value}</span>
        </div>
      ))}
    </div>
  );
};

export function AnalyticsScreen({ isPhone }: AnalyticsScreenProps) {
  const [range, setRange] = useState<Range>(7);
  const [data, setData] = useState<any[]>([]);
  const [summary, setSummary] = useState({
    hours: 0,
    tasks: 0,
    pomodoros: 0,
    completion: 0,
  });

  useEffect(() => {
    let mounted = true;
    async function load() {
      const days = getDaysInRange(range);
      const allLogs = await db.timeLogs.filter(l => !l.deleted).toArray();
      const allTasks = await db.tasks.filter(t => !t.deleted).toArray();

      const rangeLogs = allLogs.filter(l => days.includes(l.date));
      const rangeTasks = allTasks.filter(t => days.includes(t.date));

      const totalMinutes = rangeLogs.reduce((sum, l) => sum + (l.minutes || 0), 0);
      const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
      const completedTasks = rangeTasks.filter(t => t.isCompleted).length;
      const completionRate = rangeTasks.length ? Math.round((completedTasks / rangeTasks.length) * 100) : 0;
      // Count Pomodoro sessions (each 25 min = 1 pomodoro session)
      const pomodoroCount = Math.round(totalMinutes / 25);

      const chartData = days.map(d => {
        const dayLogs = allLogs.filter(l => l.date === d);
        const dayTasks = allTasks.filter(t => t.date === d);
        const dayDone = dayTasks.filter(t => t.isCompleted);
        const dayMins = dayLogs.reduce((sum, l) => sum + (l.minutes || 0), 0);

        return {
          date: d.slice(5), // MM-DD
          hours: Math.round((dayMins / 60) * 10) / 10,
          tasks: dayDone.length,
          totalTasks: dayTasks.length,
        };
      });

      if (!mounted) return;
      setData(chartData);
      setSummary({
        hours: totalHours,
        tasks: completedTasks,
        pomodoros: pomodoroCount,
        completion: completionRate,
      });
    }

    load();
    return () => { mounted = false; };
  }, [range]);

  const cards = [
    { label: 'HOURS TAKEN', value: `${summary.hours}h`, icon: <Clock size={18} />, color: '#38bdf8' },
    { label: 'TASKS COMPLETED', value: summary.tasks, icon: <CheckCircle2 size={18} />, color: '#22c55e' },
    { label: 'POMODORO SESSIONS', value: `${summary.pomodoros} 🍅`, icon: <Flame size={18} />, color: '#f59e0b' },
    { label: 'COMPLETION RATE', value: `${summary.completion}%`, icon: <Target size={18} />, color: '#a855f7' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%' }}>

      {/* Header & Range Selector */}
      <div
        className="v-card"
        style={{
          padding: isPhone ? '18px 16px' : '22px 28px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <h1
            className="font-bloody"
            style={{
              fontSize: isPhone ? 28 : 36,
              margin: 0,
              lineHeight: 1,
              color: 'var(--text-primary)',
            }}
          >
            ANALYTICS
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Real-time focus hours and completed Pomodoro sessions
          </p>
        </div>

        {/* Range Buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          {([7, 28, 90] as Range[]).map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`v-pill-btn${range === r ? ' v-pill-btn-primary' : ''}`}
              style={{ padding: '6px 14px', fontSize: 12, minHeight: 36 }}
            >
              {r} Days
            </button>
          ))}
        </div>
      </div>

      {/* 4 Summary Metric Cards */}
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
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
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
                fontSize: 26,
                fontWeight: 700,
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
              }}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {/* Main Focus Hours Chart */}
      <div
        className="v-card"
        style={{
          padding: isPhone ? '18px 16px' : '24px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TrendingUp size={16} style={{ color: 'var(--accent-color)' }} />
          <h2
            className="font-bloody"
            style={{
              fontSize: 18,
              margin: 0,
              color: 'var(--text-primary)',
            }}
          >
            HOURS TAKEN PER DAY ({range} DAYS)
          </h2>
        </div>

        <ResponsiveContainer width="100%" height={isPhone ? 200 : 260}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorHours" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--v-glass-border-subtle)" />
            <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
            <Tooltip content={<GlassTooltip />} />
            <Area
              type="monotone"
              dataKey="hours"
              name="Hours Taken"
              stroke="#38bdf8"
              strokeWidth={2.5}
              fill="url(#colorHours)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Completed Tasks Chart */}
      <div
        className="v-card"
        style={{
          padding: isPhone ? '18px 16px' : '24px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={16} style={{ color: '#22c55e' }} />
          <h2
            className="font-bloody"
            style={{
              fontSize: 18,
              margin: 0,
              color: 'var(--text-primary)',
            }}
          >
            TASKS COMPLETED PER DAY
          </h2>
        </div>

        <ResponsiveContainer width="100%" height={isPhone ? 180 : 220}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--v-glass-border-subtle)" />
            <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
            <Tooltip content={<GlassTooltip />} />
            <Bar dataKey="tasks" name="Tasks Done" fill="#22c55e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

    </div>
  );
}
