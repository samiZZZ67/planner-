'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { useTimer } from '@/lib/timer/useTimer';
import { Play, Pause, Square, Check, Clock, ChevronDown, ChevronUp, Moon } from 'lucide-react';
import type { Task, Section, TimeLog, Day, PriorityLevel } from '@/types';

interface TodayScreenProps {
  sections: Section[];
  onOpenManualTime: (taskId: string, title: string) => void;
  onPreviewImage?: (url: string, title: string) => void;
  isPhone: boolean;
}

export function TodayScreen({ sections, onOpenManualTime, onPreviewImage, isPhone }: TodayScreenProps) {
  const today = new Date().toLocaleDateString('en-CA');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [dayRecord, setDayRecord] = useState<Day | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [review, setReview] = useState({ worked: '', blocked: '', change: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { activeTimer, formattedTime, isTimerRunning, startTimer, pauseTimer, resumeTimer, stopTimer } = useTimer();

  useEffect(() => {
    let mounted = true;
    async function load() {
      const t = await db.tasks.filter(t => t.date === today && !t.deleted).toArray();
      t.sort((a, b) => a.order - b.order);
      const tl = await db.timeLogs.filter(tl => tl.date === today).toArray();
      const d = await db.days.get(today);
      if (!mounted) return;
      setTasks(t); setTimeLogs(tl); setDayRecord(d || null);
      if (d?.review) setReview(d.review);
    }
    load();
    const iv = setInterval(load, 2500);
    return () => { mounted = false; clearInterval(iv); };
  }, [today]);

  const getActualMins = (taskId: string) => timeLogs.filter(tl => tl.taskId === taskId).reduce((s, tl) => s + tl.minutes, 0);

  const handleUpdateTaskTime = async (taskId: string, minutes: number) => {
    await db.tasks.update(taskId, { estimatedMinutes: minutes, updatedAt: Date.now(), synced: 0 });
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, estimatedMinutes: minutes } : t));
    syncEngine.notifyLocalMutation();
  };

  const handleUpdateTaskPriority = async (taskId: string, priority: PriorityLevel) => {
    await db.tasks.update(taskId, { priority, updatedAt: Date.now(), synced: 0 });
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, priority } : t));
    syncEngine.notifyLocalMutation();
  };

  const handleToggleDone = async (task: Task) => {
    const done = !task.isCompleted;
    await db.tasks.update(task.id, { isCompleted: done, completedAt: done ? Date.now() : null, updatedAt: Date.now(), synced: 0 });
    syncEngine.notifyLocalMutation();
  };

  const handleStopTimer = async () => {
    await stopTimer();
  };

  const handleStartTimer = async (task: Task) => {
    if (activeTimer && activeTimer.taskId !== task.id) {
      await handleStopTimer();
    }
    await startTimer(task.id, task.title, sections.find(s => s.id === task.sectionId)?.color || '#8b5cf6');
    syncEngine.notifyLocalMutation();
  };

  const saveReview = async () => {
    const now = Date.now();
    const existing = await db.days.get(today);
    await db.days.put({ id: today, date: today, freeHours: existing?.freeHours ?? 8, review, updatedAt: now, deleted: false, isSample: false, synced: 0 });
    syncEngine.notifyLocalMutation();
    setShowReview(false);
  };

  const grouped = sections.map(sec => ({
    section: sec,
    tasks: tasks.filter(t => t.sectionId === sec.id),
  })).filter(g => g.tasks.length > 0);

  const totalPlanned = tasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
  const totalActual = timeLogs.reduce((s, tl) => s + tl.minutes, 0);
  const totalDone = tasks.filter(t => t.isCompleted).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: isPhone ? 120 : 40 }}>

      {/* ── Day Stats Bar ── */}
      <div className="g-card" style={{ padding: '16px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[
            { label: 'Planned', value: `${Math.round((totalPlanned / 60) * 10) / 10}h`, color: 'rgba(139,92,246,0.8)' },
            { label: 'Actual', value: `${Math.round((totalActual / 60) * 10) / 10}h`, color: 'rgba(99,102,241,0.8)' },
            { label: 'Done', value: `${totalDone}/${tasks.length}`, color: 'rgba(34,197,94,0.8)' },
          ].map(stat => (
            <div key={stat.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.07em', marginBottom: 4 }}>{stat.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: stat.color }}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Task Groups ── */}
      {grouped.length === 0 ? (
        <div className="g-card" style={{ padding: '40px 24px', textAlign: 'center' }}>
          <div className="font-bloody" style={{ fontSize: 22, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Nothing planned</div>
          <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Go to Plan to add tasks for today.</p>
        </div>
      ) : grouped.map(({ section: sec, tasks: secTasks }) => (
        <div key={sec.id}>
          {/* Section Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, padding: '0 4px' }}>
            <span style={{ fontSize: 16 }}>{sec.icon}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: sec.color, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{sec.name}</span>
            <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${sec.color}30, transparent)` }} />
          </div>

          {secTasks.map(task => {
            const actual = getActualMins(task.id);
            const isActive = activeTimer?.taskId === task.id;
            const isExpanded = expandedId === task.id;
            const pct = task.estimatedMinutes ? Math.min(100, (actual / task.estimatedMinutes) * 100) : 0;

            return (
              <div key={task.id} className="g-task-row" style={{ marginBottom: 8, opacity: task.isCompleted ? 0.55 : 1 }}>
                <div className="g-section-accent" style={{ background: sec.color, boxShadow: `0 0 8px ${sec.color}50` }} />
                <div style={{ padding: '14px 14px 14px 20px' }}>
                  {/* Task Header Row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* Checkbox */}
                    <button
                      onClick={() => handleToggleDone(task)}
                      style={{
                        width: 22, height: 22, borderRadius: 6,
                        background: task.isCompleted ? `rgba(34,197,94,0.15)` : 'transparent',
                        border: `1.5px solid ${task.isCompleted ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.15)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s',
                      }}
                      aria-label={task.isCompleted ? 'Mark undone' : 'Mark done'}
                    >
                      {task.isCompleted && <Check size={12} style={{ color: 'rgba(34,197,94,0.9)' }} />}
                    </button>

                    {/* Title */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: task.isCompleted ? 'rgba(255,255,255,0.4)' : (task.textColor || 'rgba(255,255,255,0.85)'), textDecoration: task.isCompleted ? 'line-through' : 'none', lineHeight: 1.3 }}>
                        {task.icon && <span style={{ marginRight: 5 }}>{task.icon}</span>}
                        {task.title}
                      </div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                        <span><Clock size={9} style={{ display: 'inline', verticalAlign: 'middle' }} /> {actual}m / {task.estimatedMinutes}m</span>
                        {isActive && <span style={{ color: 'rgba(139,92,246,0.8)', fontWeight: 700 }}>⏱ {formattedTime}</span>}
                      </div>
                    </div>

                    {/* Controls */}
                    <div style={{ display: 'flex', gap: 5, flexShrink: 0, alignItems: 'center' }}>
                      {isActive ? (
                        <>
                          {isTimerRunning ? (
                            <button onClick={pauseTimer} className="g-icon-btn" style={{ width: 32, height: 32, color: 'rgba(234,179,8,0.7)', borderColor: 'rgba(234,179,8,0.2)' }} aria-label="Pause"><Pause size={13} /></button>
                          ) : (
                            <button onClick={resumeTimer} className="g-icon-btn" style={{ width: 32, height: 32, color: 'rgba(99,102,241,0.8)', borderColor: 'rgba(99,102,241,0.2)' }} aria-label="Resume"><Play size={13} /></button>
                          )}
                          <button onClick={handleStopTimer} className="g-icon-btn" style={{ width: 32, height: 32, color: 'rgba(239,68,68,0.7)', borderColor: 'rgba(239,68,68,0.2)' }} aria-label="Stop"><Square size={13} /></button>
                        </>
                      ) : (
                        <button onClick={() => handleStartTimer(task)} className="g-icon-btn" style={{ width: 32, height: 32, color: 'rgba(34,197,94,0.7)', borderColor: 'rgba(34,197,94,0.2)' }} aria-label="Start timer"><Play size={13} /></button>
                      )}
                      <button onClick={() => onOpenManualTime(task.id, task.title)} className="g-icon-btn" style={{ width: 32, height: 32 }} aria-label="Log time manually"><Clock size={13} /></button>
                      <button onClick={() => setExpandedId(isExpanded ? null : task.id)} className="g-icon-btn" style={{ width: 28, height: 28 }} aria-label={isExpanded ? 'Collapse' : 'Expand'}>
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </div>
                  </div>

                  {/* Progress bar */}
                  {actual > 0 && (
                    <div style={{ marginTop: 10, height: 3, borderRadius: 999, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 999, background: pct >= 100 ? 'rgba(239,68,68,0.6)' : `linear-gradient(90deg, ${sec.color}60, ${sec.color})`, width: `${pct}%`, boxShadow: `0 0 6px ${sec.color}50`, transition: 'width 0.5s ease' }} />
                    </div>
                  )}

                  {/* Bottom Controls: Time & Hard / Medium / Low Priority */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 10,
                      paddingTop: 8,
                      borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                      flexWrap: 'wrap',
                      gap: 6,
                    }}
                  >
                    {/* Time selector pills */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginRight: 2 }}>Est:</span>
                      {[15, 30, 45, 60, 120].map(mins => {
                        const isSelected = task.estimatedMinutes === mins;
                        return (
                          <button
                            key={mins}
                            type="button"
                            onClick={() => handleUpdateTaskTime(task.id, mins)}
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              padding: '2px 5px',
                              borderRadius: 4,
                              border: isSelected ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                              background: isSelected ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                              color: isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.45)',
                              cursor: 'pointer',
                              transition: 'all 0.15s',
                            }}
                            title={`Set to ${mins}m`}
                          >
                            {mins >= 60 ? `${mins / 60}h` : `${mins}m`}
                          </button>
                        );
                      })}
                    </div>

                    {/* Hard / Medium / Low difficulty pills */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      {(['High', 'Medium', 'Low'] as PriorityLevel[]).map(lvl => {
                        const label = lvl === 'High' ? 'Hard' : lvl;
                        const isSelected = task.priority === lvl;
                        const color = lvl === 'High' ? '#f87171' : lvl === 'Medium' ? '#fbbf24' : '#34d399';
                        const bgColor = lvl === 'High' ? 'rgba(239,68,68,0.22)' : lvl === 'Medium' ? 'rgba(245,158,11,0.22)' : 'rgba(16,185,129,0.22)';
                        const borderColor = lvl === 'High' ? 'rgba(239,68,68,0.55)' : lvl === 'Medium' ? 'rgba(245,158,11,0.55)' : 'rgba(16,185,129,0.55)';

                        return (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => handleUpdateTaskPriority(task.id, lvl)}
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: 4,
                              border: isSelected ? `1px solid ${borderColor}` : '1px solid rgba(255, 255, 255, 0.1)',
                              background: isSelected ? bgColor : 'rgba(255, 255, 255, 0.04)',
                              color: isSelected ? color : 'rgba(255, 255, 255, 0.45)',
                              cursor: 'pointer',
                              transition: 'all 0.15s',
                            }}
                            title={`Set priority to ${label}`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Expanded Strategy + Done Means */}
                  {isExpanded && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      {task.strategy && (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>Strategy</div>
                          <div dangerouslySetInnerHTML={{ __html: task.strategy }} style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }} />
                        </div>
                      )}
                      {task.doneMeans && (
                        <div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>Done means...</div>
                          <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>{task.doneMeans}</p>
                        </div>
                      )}
                      {task.image && (
                        <img
                          src={task.image}
                          alt={task.title}
                          onClick={() => onPreviewImage && onPreviewImage(task.image!, task.title)}
                          style={{ marginTop: 10, borderRadius: 10, maxWidth: '100%', border: '1px solid rgba(255,255,255,0.07)', cursor: onPreviewImage ? 'pointer' : 'default' }}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* ── Evening Review ── */}
      <div className="g-card" style={{ padding: 20 }}>
        <button
          onClick={() => setShowReview(!showReview)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', cursor: 'pointer', width: '100%', color: 'inherit', fontFamily: 'system-ui, sans-serif', padding: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Moon size={15} style={{ color: 'rgba(139,92,246,0.8)' }} />
          </div>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>Evening Review</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>1-minute reflection on today</div>
          </div>
          {showReview ? <ChevronUp size={14} style={{ color: 'rgba(255,255,255,0.3)' }} /> : <ChevronDown size={14} style={{ color: 'rgba(255,255,255,0.3)' }} />}
        </button>

        {showReview && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { key: 'worked', label: 'What worked today?', placeholder: 'What went well?' },
              { key: 'blocked', label: 'What blocked me?', placeholder: 'Any friction or obstacles?' },
              { key: 'change', label: 'One change for tomorrow', placeholder: 'What will you do differently?' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="g-label">{label}</label>
                <textarea
                  className="g-input"
                  rows={2}
                  placeholder={placeholder}
                  value={(review as any)[key]}
                  onChange={e => setReview(prev => ({ ...prev, [key]: e.target.value }))}
                  style={{ resize: 'vertical', minHeight: 60 }}
                />
              </div>
            ))}
            <button onClick={saveReview} className="g-btn g-btn-primary" style={{ alignSelf: 'flex-end', padding: '9px 20px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={14} /><span>Save Review</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
