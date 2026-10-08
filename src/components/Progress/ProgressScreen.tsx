'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import {
  Clock,
  CheckCircle,
  TrendingUp,
  Flame,
  ArrowUpRight,
  ArrowDownRight,
  PieChart as PieIcon,
  BarChart2,
  Calendar,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import type { Task, Section, TimeLog } from '@/types';

type DateRange = 7 | 28 | 90;
type MetricKey = 'hours' | 'tasks' | 'completion' | 'streak';

interface ProgressScreenProps {
  sections: Section[];
  isPhone: boolean;
}

export function ProgressScreen({ sections, isPhone }: ProgressScreenProps) {
  const [range, setRange] = useState<DateRange>(28);
  const [activeMetric, setActiveMetric] = useState<MetricKey>('hours');
  const [isCumulative, setIsCumulative] = useState(false);

  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [allLogs, setAllLogs] = useState<TimeLog[]>([]);

  // Load data from Dexie
  useEffect(() => {
    async function loadData() {
      const [tasks, logs] = await Promise.all([
        db.tasks.filter(t => !t.deleted).toArray(),
        db.timeLogs.filter(tl => !tl.deleted).toArray(),
      ]);
      setAllTasks(tasks);
      setAllLogs(logs);
    }
    loadData();
    const interval = setInterval(loadData, 3000);
    return () => clearInterval(interval);
  }, []);

  // Compute date array for current and prior period
  const { currentDays, priorDays } = useMemo(() => {
    const today = new Date();
    const current: string[] = [];
    const prior: string[] = [];

    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      current.push(d.toISOString().split('T')[0]);
    }

    for (let i = range * 2 - 1; i >= range; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      prior.push(d.toISOString().split('T')[0]);
    }

    return { currentDays: current, priorDays: prior };
  }, [range]);

  // Aggregate current and prior metrics
  const { currentMetrics, priorMetrics, dailyData, sectionBreakdown } = useMemo(() => {
    const currentDaySet = new Set(currentDays);
    const priorDaySet = new Set(priorDays);

    const currentTasks = allTasks.filter(t => currentDaySet.has(t.date));
    const priorTasks = allTasks.filter(t => priorDaySet.has(t.date));

    const currentLogs = allLogs.filter(l => currentDaySet.has(l.date));
    const priorLogs = allLogs.filter(l => priorDaySet.has(l.date));

    // 1. Hours spent
    const curHours = Math.round((currentLogs.reduce((s, l) => s + l.minutes, 0) / 60) * 10) / 10;
    const priHours = Math.round((priorLogs.reduce((s, l) => s + l.minutes, 0) / 60) * 10) / 10;

    // 2. Tasks completed
    const curCompleted = currentTasks.filter(t => t.isCompleted).length;
    const priCompleted = priorTasks.filter(t => t.isCompleted).length;

    // 3. Completion rate
    const curRate = currentTasks.length > 0 ? Math.round((curCompleted / currentTasks.length) * 100) : 0;
    const priRate = priorTasks.length > 0 ? Math.round((priCompleted / priorTasks.length) * 100) : 0;

    // 4. Day streak
    let streak = 0;
    const todayStr = new Date().toISOString().split('T')[0];
    let checkDate = new Date();

    while (true) {
      const dStr = checkDate.toISOString().split('T')[0];
      const hasCompleted = allTasks.some(t => t.date === dStr && t.isCompleted);
      if (hasCompleted) {
        streak += 1;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        // Allow today to not be completed yet if earlier in the day
        if (dStr === todayStr) {
          checkDate.setDate(checkDate.getDate() - 1);
          continue;
        }
        break;
      }
      if (streak > 365) break;
    }

    // Daily breakdown for charts
    let runningHours = 0;
    let runningTasks = 0;

    const daily = currentDays.map(dateStr => {
      const dayTasks = currentTasks.filter(t => t.date === dateStr);
      const dayLogs = currentLogs.filter(l => l.date === dateStr);

      const actHours = Math.round((dayLogs.reduce((s, l) => s + l.minutes, 0) / 60) * 10) / 10;
      const estHours = Math.round((dayTasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0) / 60) * 10) / 10;
      const doneCount = dayTasks.filter(t => t.isCompleted).length;

      runningHours = Math.round((runningHours + actHours) * 10) / 10;
      runningTasks += doneCount;

      const [y, m, d] = dateStr.split('-');
      const label = `${m}/${d}`;

      return {
        date: dateStr,
        label,
        actualHours: actHours,
        estimatedHours: estHours,
        tasksDone: doneCount,
        cumulativeHours: runningHours,
        cumulativeTasks: runningTasks,
      };
    });

    // Time by section donut breakdown
    const secMap = new Map<string, number>();
    for (const log of currentLogs) {
      const task = allTasks.find(t => t.id === log.taskId);
      const secId = task?.sectionId || 'unknown';
      secMap.set(secId, (secMap.get(secId) || 0) + log.minutes);
    }

    const secBreakdown = sections.map(s => {
      const mins = secMap.get(s.id) || 0;
      const hrs = Math.round((mins / 60) * 10) / 10;
      return {
        name: s.name,
        color: s.color,
        hours: hrs,
        minutes: mins,
      };
    }).filter(s => s.minutes > 0);

    return {
      currentMetrics: {
        hours: curHours,
        tasks: curCompleted,
        completion: curRate,
        streak,
      },
      priorMetrics: {
        hours: priHours,
        tasks: priCompleted,
        completion: priRate,
      },
      dailyData: daily,
      sectionBreakdown: secBreakdown,
    };
  }, [allTasks, allLogs, currentDays, priorDays, sections]);

  // Compute % change comparison helper
  const renderTrend = (current: number, prior: number, isPercent = false) => {
    if (prior === 0) {
      return (
        <span className="text-[11px] text-text-muted">
          No prior period data
        </span>
      );
    }

    const diff = current - prior;
    const pct = Math.round(((diff) / prior) * 100);
    const isUp = diff >= 0;

    return (
      <div className={`flex items-center gap-0.5 text-xs font-semibold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
        {isUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
        <span>{isUp ? '+' : ''}{isPercent ? `${diff}%` : `${pct}%`} vs last {range}d</span>
      </div>
    );
  };

  const cards: {
    key: MetricKey;
    title: string;
    value: string;
    icon: React.ReactNode;
    trend: React.ReactNode;
  }[] = [
    {
      key: 'hours',
      title: 'Hours Spent',
      value: `${currentMetrics.hours}h`,
      icon: <Clock className="w-5 h-5 text-accent-primary" />,
      trend: renderTrend(currentMetrics.hours, priorMetrics.hours),
    },
    {
      key: 'tasks',
      title: 'Tasks Completed',
      value: `${currentMetrics.tasks}`,
      icon: <CheckCircle className="w-5 h-5 text-emerald-400" />,
      trend: renderTrend(currentMetrics.tasks, priorMetrics.tasks),
    },
    {
      key: 'completion',
      title: 'Completion Rate',
      value: `${currentMetrics.completion}%`,
      icon: <TrendingUp className="w-5 h-5 text-purple-400" />,
      trend: renderTrend(currentMetrics.completion, priorMetrics.completion, true),
    },
    {
      key: 'streak',
      title: 'Current Streak',
      value: `${currentMetrics.streak} days`,
      icon: <Flame className="w-5 h-5 text-amber-400" />,
      trend: (
        <span className="text-xs text-amber-400/90 font-medium">
          {currentMetrics.streak > 0 ? 'Consistent momentum' : 'Start today!'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6 pb-24">
      {/* Top Header & Range Controls */}
      <div className="bg-bg-card border border-border-color rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-bloody text-2xl font-bold text-text-primary">
            Execution Analytics
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            YouTube Studio style metrics tracking your real daily habits.
          </p>
        </div>

        {/* Date Range Selector */}
        <div className="flex items-center gap-1.5 bg-bg-secondary p-1 rounded-xl border border-border-color">
          {([7, 28, 90] as DateRange[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                range === r
                  ? 'bg-accent-primary text-white shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {r} Days
            </button>
          ))}
        </div>
      </div>

      {/* Summary KPI Cards: 2x2 grid on Phone, 1 row on PC */}
      <div className={`grid gap-4 ${isPhone ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
        {cards.map(c => {
          const isSelected = activeMetric === c.key;
          return (
            <div
              key={c.key}
              onClick={() => setActiveMetric(c.key)}
              className={`p-4 sm:p-5 rounded-2xl border cursor-pointer transition-all ${
                isSelected
                  ? 'bg-purple-950/30 border-accent-primary shadow-lg shadow-purple-950/30 scale-[1.01]'
                  : 'bg-bg-card border-border-color hover:border-accent-primary/50'
              }`}
              role="button"
              tabIndex={0}
              aria-label={`${c.title}: ${c.value}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-muted">{c.title}</span>
                {c.icon}
              </div>
              <div className="font-mono text-2xl font-bold text-text-primary mb-1">
                {c.value}
              </div>
              <div>{c.trend}</div>
            </div>
          );
        })}
      </div>

      {/* Main Chart (Line/Area with Daily vs Cumulative Toggle) */}
      <div className="bg-bg-card border border-border-color rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-base text-text-primary">
              {activeMetric === 'hours'
                ? 'Time Invested'
                : activeMetric === 'tasks'
                ? 'Tasks Completed'
                : 'Execution Pace'}
            </h3>
            <p className="text-xs text-text-muted">
              {isCumulative
                ? 'Cumulative growth curve (YouTube Studio subscriber style)'
                : 'Day-by-day activity trend'}
            </p>
          </div>

          <div className="flex items-center gap-1.5 bg-bg-secondary p-1 rounded-xl border border-border-color">
            <button
              onClick={() => setIsCumulative(false)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                !isCumulative ? 'bg-accent-primary text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Daily
            </button>
            <button
              onClick={() => setIsCumulative(true)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                isCumulative ? 'bg-accent-primary text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Cumulative
            </button>
          </div>
        </div>

        <div className="h-72 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="metricGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" stroke="#64748b" fontSize={11} tickLine={false} />
              <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#13141f',
                  border: '1px solid #26283d',
                  borderRadius: '12px',
                  fontSize: '12px',
                  color: '#f8fafc',
                }}
              />
              <Area
                type="monotone"
                dataKey={
                  isCumulative
                    ? activeMetric === 'tasks'
                      ? 'cumulativeTasks'
                      : 'cumulativeHours'
                    : activeMetric === 'tasks'
                    ? 'tasksDone'
                    : 'actualHours'
                }
                name={
                  activeMetric === 'tasks'
                    ? isCumulative ? 'Cumulative Tasks' : 'Tasks Done'
                    : isCumulative ? 'Cumulative Hours' : 'Actual Hours'
                }
                stroke="#8b5cf6"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#metricGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Secondary Charts: Estimated vs Actual Hours + Section Donut */}
      <div className={`grid gap-6 ${isPhone ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
        {/* Estimated vs Actual Hours Bar Chart */}
        <div className="bg-bg-card border border-border-color rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-accent-primary" />
            <h4 className="font-bold text-sm text-text-primary">
              Estimated vs Actual Hours
            </h4>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData.slice(-14)} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="label" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#13141f',
                    border: '1px solid #26283d',
                    borderRadius: '12px',
                    fontSize: '12px',
                    color: '#f8fafc',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Bar dataKey="estimatedHours" name="Estimated (h)" fill="#6366f1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="actualHours" name="Actual (h)" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Section Time Distribution Donut Chart */}
        <div className="bg-bg-card border border-border-color rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <PieIcon className="w-5 h-5 text-accent-primary" />
            <h4 className="font-bold text-sm text-text-primary">
              Time Spent by Section
            </h4>
          </div>

          {sectionBreakdown.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-xs text-text-muted">
              No logged time in this period
            </div>
          ) : (
            <div className="h-64 w-full flex flex-col sm:flex-row items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sectionBreakdown}
                    dataKey="hours"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                  >
                    {sectionBreakdown.map((sec, idx) => (
                      <Cell key={`cell-${idx}`} fill={sec.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val) => [`${val} hrs`, 'Time']}
                    contentStyle={{
                      backgroundColor: '#13141f',
                      border: '1px solid #26283d',
                      borderRadius: '12px',
                      fontSize: '12px',
                      color: '#f8fafc',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
