'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend, Area, AreaChart,
} from 'recharts';
import { TrendingUp, TrendingDown, Clock, CheckCircle2, Target, Flame, BarChart3, PieChart as PieIcon, Activity } from 'lucide-react';
import type { Section } from '@/types';

type Range = 7 | 28 | 90;
type MainChart = 'hours' | 'tasks' | 'completion' | 'streak';

interface ProgressScreenProps { sections: Section[]; isPhone: boolean; }

function getDaysInRange(n: number): string[] {
  const result: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    result.push(d.toLocaleDateString('en-CA'));
  }
  return result;
}

const GlassTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'rgba(15,15,18,0.96)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 14px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6, letterSpacing: '0.05em' }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>{p.name}:</span>
          <strong>{p.value}</strong>
        </div>
      ))}
    </div>
  );
};

export function ProgressScreen({ sections, isPhone }: ProgressScreenProps) {
  const [range, setRange] = useState<Range>(7);
  const [mainChart, setMainChart] = useState<MainChart>('hours');
  const [cumulative, setCumulative] = useState(false);
  const [data, setData] = useState<any[]>([]);
  const [summary, setSummary] = useState({ hours: 0, tasks: 0, completion: 0, streak: 0 });
  const [prevSummary, setPrevSummary] = useState({ hours: 0, tasks: 0, completion: 0, streak: 0 });
  const [sectionData, setSectionData] = useState<any[]>([]);
  const [dailyComparison, setDailyComparison] = useState<any[]>([]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const days = getDaysInRange(range);
      const prevDays = getDaysInRange(range * 2).slice(0, range);
      const allLogs = await db.timeLogs.toArray();
      const allTasks = await db.tasks.filter(t => !t.deleted).toArray();

      const calcSummary = (dayList: string[]) => {
        const hours = dayList.reduce((s, d) => s + allLogs.filter(l => l.date === d).reduce((a, l) => a + l.minutes, 0), 0) / 60;
        const planned = allTasks.filter(t => dayList.includes(t.date));
        const tasks = planned.filter(t => t.isCompleted).length;
        const completion = planned.length ? Math.round((tasks / planned.length) * 100) : 0;
        let streak = 0;
        const sorted = [...days].reverse();
        for (const d of sorted) {
          if (allTasks.some(t => t.date === d && t.isCompleted)) streak++;
          else break;
        }
        return { hours: Math.round(hours * 10) / 10, tasks, completion, streak };
      };

      const chartData = days.map(d => {
        const logs = allLogs.filter(l => l.date === d);
        const planned = allTasks.filter(t => t.date === d);
        const done = planned.filter(t => t.isCompleted);
        return {
          date: d.slice(5),
          hours: Math.round((logs.reduce((s, l) => s + l.minutes, 0) / 60) * 10) / 10,
          tasks: done.length,
          planned: planned.length,
          completion: planned.length ? Math.round((done.length / planned.length) * 100) : 0,
          estimatedHrs: Math.round((planned.reduce((s, t) => s + (t.estimatedMinutes || 0), 0) / 60) * 10) / 10,
        };
      });

      if (cumulative) {
        let acc = { hours: 0, tasks: 0 };
        chartData.forEach(d => { acc.hours += d.hours; acc.tasks += d.tasks; d.hours = Math.round(acc.hours * 10) / 10; d.tasks = acc.tasks; });
      }

      const secData = sections.map(sec => {
        const mins = days.reduce((s, d) => s + allLogs.filter(l => l.date === d).reduce((a, l) => {
          const task = allTasks.find(t => t.id === l.taskId);
          return task?.sectionId === sec.id ? a + l.minutes : a;
        }, 0), 0);
        return { name: sec.name, value: Math.round(mins / 60 * 10) / 10, color: sec.color, icon: sec.icon, target: sec.dailyTargetMinutes };
      }).filter(d => d.value > 0);

      const daily = days.map(d => ({
        date: d.slice(5),
        estimated: Math.round(allTasks.filter(t => t.date === d).reduce((s, t) => s + (t.estimatedMinutes || 0), 0) / 60 * 10) / 10,
        actual: Math.round(allLogs.filter(l => l.date === d).reduce((s, l) => s + l.minutes, 0) / 60 * 10) / 10,
      }));

      if (!mounted) return;
      setSummary(calcSummary(days));
      setPrevSummary(calcSummary(prevDays));
      setData(chartData);
      setSectionData(secData);
      setDailyComparison(daily);
    }
    load();
  }, [range, cumulative, sections]);

  const delta = (cur: number, prev: number) => {
    if (!prev) return null;
    const pct = Math.round(((cur - prev) / prev) * 100);
    return { pct, up: cur >= prev };
  };

  const summaryCards = [
    { key: 'hours', label: 'Hours Spent', value: `${summary.hours}h`, prev: prevSummary.hours, icon: <Clock size={16} />, color: 'rgba(255,255,255,0.9)' },
    { key: 'tasks', label: 'Tasks Done', value: summary.tasks, prev: prevSummary.tasks, icon: <CheckCircle2 size={16} />, color: 'rgba(255,255,255,0.9)' },
    { key: 'completion', label: 'Completion', value: `${summary.completion}%`, prev: prevSummary.completion, icon: <Target size={16} />, color: 'rgba(255,255,255,0.9)' },
    { key: 'streak', label: 'Day Streak', value: `${summary.streak} 🔥`, prev: prevSummary.streak, icon: <Flame size={16} />, color: 'rgba(255,255,255,0.9)' },
  ];

  const getMainData = () => {
    const key = mainChart === 'hours' ? 'hours' : mainChart === 'tasks' ? 'tasks' : mainChart === 'completion' ? 'completion' : 'hours';
    return { key, label: mainChart === 'hours' ? 'Hours' : mainChart === 'tasks' ? 'Tasks' : mainChart === 'completion' ? 'Completion %' : 'Hours' };
  };

  const { key: mainKey, label: mainLabel } = getMainData();

  const axisStyle = { fill: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'monospace' };
  const gridColor = 'rgba(255,255,255,0.04)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: isPhone ? 120 : 40 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 className="font-bloody" style={{ fontSize: 24, margin: 0, color: 'rgba(255,255,255,0.85)' }}>Analytics</h2>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Your planning performance over time</p>
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {([7, 28, 90] as Range[]).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className="g-btn"
              style={{ padding: '7px 14px', fontSize: 12, background: range === r ? 'rgba(255,255,255,0.15)' : 'var(--glass-bg)', borderColor: range === r ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.07)', color: range === r ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)' }}>
              {r}d
            </button>
          ))}
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10 }}>
        {summaryCards.map(card => {
          const d = delta(typeof card.prev === 'number' ? +card.value.toString().replace(/[^\d.]/g, '') : 0, card.prev);
          return (
            <button key={card.key} onClick={() => setMainChart(card.key as MainChart)}
              className="g-card"
              style={{ padding: '16px', textAlign: 'left', cursor: 'pointer', border: `1px solid ${mainChart === card.key ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.07)'}`, background: mainChart === card.key ? 'rgba(255,255,255,0.06)' : 'var(--glass-bg)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ color: card.color }}>{card.icon}</div>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 600, letterSpacing: '0.06em' }}>{card.label.toUpperCase()}</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: 'rgba(255,255,255,0.9)' }}>{card.value}</div>
              {d && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 10, color: d.up ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)' }}>
                  {d.up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  <span>{d.up ? '+' : ''}{d.pct}% vs prev period</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Main Chart ── */}
      <div className="g-card" style={{ padding: '20px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={14} style={{ color: '#ffffff' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{mainLabel} — {range}-day view</span>
          </div>
          <button onClick={() => setCumulative(!cumulative)} className="g-btn" style={{ padding: '5px 12px', fontSize: 11, borderColor: cumulative ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.07)', color: cumulative ? '#ffffff' : 'rgba(255,255,255,0.4)' }}>
            {cumulative ? '📈 Cumulative' : '📊 Daily'}
          </button>
        </div>
        <ResponsiveContainer width="100%" height={isPhone ? 180 : 240}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="rgba(255,255,255,0.3)" />
                <stop offset="95%" stopColor="rgba(255,255,255,0)" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke={gridColor} />
            <XAxis dataKey="date" tick={axisStyle} axisLine={{ stroke: gridColor }} tickLine={false} />
            <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
            <Tooltip content={<GlassTooltip />} />
            <Area type="monotone" dataKey={mainKey} name={mainLabel} stroke="#ffffff" strokeWidth={2} fill="url(#grad1)" dot={false} activeDot={{ r: 4, fill: '#ffffff' }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Secondary Charts ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr', gap: 14 }}>
        {/* Estimated vs Actual */}
        <div className="g-card" style={{ padding: '18px 14px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <BarChart3 size={13} style={{ color: '#ffffff' }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>ESTIMATED VS ACTUAL HOURS</span>
          </div>
          <ResponsiveContainer width="100%" height={isPhone ? 160 : 200}>
            <BarChart data={dailyComparison} barGap={2}>
              <CartesianGrid strokeDasharray="2 4" stroke={gridColor} />
              <XAxis dataKey="date" tick={axisStyle} axisLine={{ stroke: gridColor }} tickLine={false} />
              <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
              <Tooltip content={<GlassTooltip />} />
              <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }} />
              <Bar dataKey="estimated" name="Estimated" fill="rgba(255,255,255,0.25)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="actual" name="Actual" fill="rgba(255,255,255,0.65)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Section Donut */}
        <div className="g-card" style={{ padding: '18px 14px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <PieIcon size={13} style={{ color: '#ffffff' }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>TIME BY SECTION</span>
          </div>
          {sectionData.length === 0 ? (
            <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={isPhone ? 160 : 200}>
              <PieChart>
                <Pie data={sectionData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={3}>
                  {sectionData.map((entry, i) => <Cell key={i} fill={entry.color} opacity={0.8} />)}
                </Pie>
                <Tooltip content={<GlassTooltip />} />
                <Legend wrapperStyle={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
          {/* Section Progress Bars */}
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sections.map(sec => {
              const d = sectionData.find(s => s.name === sec.name);
              const hrs = d?.value || 0;
              const targetHrs = sec.dailyTargetMinutes ? Math.round(sec.dailyTargetMinutes / 60 * range * 10) / 10 : null;
              const pct = targetHrs && targetHrs > 0 ? Math.min(100, (hrs / targetHrs) * 100) : 0;
              return (
                <div key={sec.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', display: 'flex', gap: 4, alignItems: 'center' }}><span>{sec.icon}</span><span>{sec.name}</span></span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>{hrs}h{targetHrs ? ` / ${targetHrs}h` : ''}</span>
                  </div>
                  {targetHrs && (
                    <div style={{ height: 3, borderRadius: 999, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 999, background: sec.color, width: `${pct}%`, boxShadow: `0 0 6px ${sec.color}50`, transition: 'width 0.5s ease' }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
