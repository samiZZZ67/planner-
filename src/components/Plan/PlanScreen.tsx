'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/db';
import { syncEngine } from '@/lib/sync/syncEngine';
import { getPreviousDayData } from '@/lib/plan/autoPlan';
import {
  Calendar, Clock, Sparkles, Star, ChevronLeft, ChevronRight,
  ArrowUp, ArrowDown, Edit2, Trash2, Lightbulb, CheckCircle2,
  Plus,
} from 'lucide-react';
import type { Task, Section, Day } from '@/types';

interface PlanScreenProps {
  currentDate: string;
  onChangeDate: (date: string) => void;
  sections: Section[];
  onOpenTaskModal: (task?: Task | null) => void;
  onPreviewImage: (url: string, title: string) => void;
  onOpenAutoPlan: (previousDate: string, candidateTasks: Task[]) => void;
  isPhone: boolean;
}

const PRIORITY_ICON = { High: '🔥', Medium: '✦', Low: '◇' };

export function PlanScreen({ currentDate, onChangeDate, sections, onOpenTaskModal, onOpenAutoPlan, isPhone }: PlanScreenProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dayRecord, setDayRecord] = useState<Day | null>(null);
  const [freeHours, setFreeHours] = useState<number>(8);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [yesterdayChange, setYesterdayChange] = useState<string | null>(null);
  const [prevUnfinished, setPrevUnfinished] = useState<Task[]>([]);
  const [prevDate, setPrevDate] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    async function load() {
      const t = await db.tasks.filter(t => t.date === currentDate && !t.deleted).toArray();
      t.sort((a, b) => a.order - b.order);
      const d = await db.days.get(currentDate);
      const prevData = await getPreviousDayData(currentDate);
      if (!mounted) return;
      setTasks(t);
      setDayRecord(d || null);
      setFreeHours(d?.freeHours ?? 8);
      setYesterdayChange(prevData.previousReviewChange);
      setPrevUnfinished(prevData.unfinishedTasks);
      setPrevDate(prevData.previousDate);
    }
    load();
    const iv = setInterval(load, 2000);
    return () => { mounted = false; clearInterval(iv); };
  }, [currentDate]);

  const handleUpdateFreeHours = async (val: number) => {
    const v = Math.max(0, Math.min(24, val));
    setFreeHours(v);
    const now = Date.now();
    const existing = await db.days.get(currentDate);
    await db.days.put({ id: currentDate, date: currentDate, freeHours: v, review: existing?.review || { worked: '', blocked: '', change: '' }, updatedAt: now, deleted: false, isSample: false, synced: 0 });
    syncEngine.notifyLocalMutation();
  };

  const handleDeleteTask = async (id: string) => {
    await db.tasks.update(id, { deleted: true, updatedAt: Date.now(), synced: 0 });
    syncEngine.notifyLocalMutation();
  };

  const moveTask = async (task: Task, dir: 'up' | 'down') => {
    const sec = tasks.filter(t => t.sectionId === task.sectionId);
    const idx = sec.findIndex(t => t.id === task.id);
    const tgt = dir === 'up' ? idx - 1 : idx + 1;
    if (tgt < 0 || tgt >= sec.length) return;
    const swap = sec[tgt];
    const now = Date.now();
    await db.transaction('rw', db.tasks, async () => {
      await db.tasks.update(task.id, { order: swap.order, updatedAt: now, synced: 0 });
      await db.tasks.update(swap.id, { order: task.order, updatedAt: now, synced: 0 });
    });
    syncEngine.notifyLocalMutation();
  };

  const moveSection = async (taskId: string, sectionId: string) => {
    await db.tasks.update(taskId, { sectionId, updatedAt: Date.now(), synced: 0 });
    syncEngine.notifyLocalMutation();
  };

  const shiftDate = (days: number) => {
    const [y, m, d] = currentDate.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + days);
    onChangeDate(date.toISOString().split('T')[0]);
  };

  const totalMins = useMemo(() => tasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0), [tasks]);
  const totalHrs = Math.round((totalMins / 60) * 10) / 10;
  const isOver = totalHrs > freeHours;
  const allTags = useMemo(() => { const s = new Set<string>(); tasks.forEach(t => t.tags?.forEach(tag => s.add(tag))); return [...s]; }, [tasks]);
  const filtered = useMemo(() => tasks.filter(t => (!selectedTag || t.tags?.includes(selectedTag)) && (!selectedSection || t.sectionId === selectedSection)), [tasks, selectedTag, selectedSection]);
  const mustDos = useMemo(() => tasks.filter(t => t.mustDo).slice(0, 3), [tasks]);

  /* ── Shared task card ── */
  const TaskCard = ({ task }: { task: Task }) => {
    const sec = sections.find(s => s.id === task.sectionId);
    return (
      <div className="g-task-row" style={{ padding: '14px 16px 14px 20px', marginBottom: 8 }}>
        <div className="g-section-accent" style={{ background: sec?.color || '#8b5cf6', boxShadow: `0 0 8px ${sec?.color || '#8b5cf6'}50` }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12 }}>{task.icon || sec?.icon || '📌'}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: task.textColor || 'rgba(255,255,255,0.88)', lineHeight: 1.3 }}>
                {task.title}
              </span>
              {task.mustDo && <Star size={11} style={{ color: 'rgba(234,179,8,0.8)', fill: 'rgba(234,179,8,0.8)', flexShrink: 0 }} />}
            </div>
            {task.strategy && (
              <div
                dangerouslySetInnerHTML={{ __html: task.strategy }}
                style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: 6 }}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                <Clock size={10} />{task.estimatedMinutes}m
              </span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
                {PRIORITY_ICON[task.priority]} {task.priority}
              </span>
              {sec && (
                <span style={{ fontSize: 10, color: sec.color, display: 'flex', alignItems: 'center', gap: 3 }}>
                  {sec.icon} {sec.name}
                </span>
              )}
              {task.tags?.slice(0, 2).map(tag => (
                <button key={tag} onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                  style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 999, padding: '1px 7px', cursor: 'pointer' }}>
                  #{tag}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {isPhone && <>
              <button onClick={() => moveTask(task, 'up')} className="g-icon-btn" style={{ width: 28, height: 28 }} aria-label="Move up"><ArrowUp size={12} /></button>
              <button onClick={() => moveTask(task, 'down')} className="g-icon-btn" style={{ width: 28, height: 28 }} aria-label="Move down"><ArrowDown size={12} /></button>
            </>}
            <button onClick={() => onOpenTaskModal(task)} className="g-icon-btn" style={{ width: 28, height: 28 }} aria-label="Edit"><Edit2 size={12} /></button>
            <button onClick={() => handleDeleteTask(task.id)} className="g-icon-btn" style={{ width: 28, height: 28, color: 'rgba(239,68,68,0.5)', borderColor: 'rgba(239,68,68,0.12)' }} aria-label="Delete"><Trash2 size={12} /></button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: isPhone ? 120 : 40 }}>

      {/* ── Date & Budget Header ── */}
      <div className="g-card" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          {/* Date Picker Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => shiftDate(-1)} className="g-icon-btn" aria-label="Previous day"><ChevronLeft size={15} /></button>
            <div className="g-pill" style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar size={14} style={{ color: 'rgba(139,92,246,0.8)', flexShrink: 0 }} />
              <input type="date" value={currentDate} onChange={e => onChangeDate(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 600, cursor: 'pointer', outline: 'none', fontFamily: 'system-ui, sans-serif' }} />
            </div>
            <button onClick={() => shiftDate(1)} className="g-icon-btn" aria-label="Next day"><ChevronRight size={15} /></button>
          </div>

          {/* Free Hours */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>FREE HOURS</span>
            <div className="g-pill" style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="number" min={1} max={24} step={0.5} value={freeHours}
                onChange={e => handleUpdateFreeHours(parseFloat(e.target.value) || 0)}
                style={{ width: 48, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 700, textAlign: 'center', outline: 'none', fontFamily: 'monospace' }} />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>hrs</span>
            </div>
          </div>
        </div>

        {/* Budget Bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
              Planned: <strong style={{ color: 'rgba(255,255,255,0.75)' }}>{totalHrs}h</strong> / {freeHours}h budget
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'monospace', color: isOver ? 'rgba(239,68,68,0.8)' : 'rgba(34,197,94,0.8)' }}>
              {isOver ? `⚠ Over by ${(totalHrs - freeHours).toFixed(1)}h` : `${(freeHours - totalHrs).toFixed(1)}h available`}
            </span>
          </div>
          <div style={{ width: '100%', height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              borderRadius: 999,
              background: isOver
                ? 'linear-gradient(90deg, rgba(239,68,68,0.7), rgba(239,68,68,0.9))'
                : 'linear-gradient(90deg, rgba(139,92,246,0.5), rgba(99,102,241,0.8))',
              width: `${Math.min(100, freeHours > 0 ? (totalHrs / freeHours) * 100 : 100)}%`,
              boxShadow: isOver ? '0 0 8px rgba(239,68,68,0.4)' : '0 0 8px rgba(139,92,246,0.4)',
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      </div>

      {/* ── Yesterday Review ── */}
      {yesterdayChange && (
        <div className="g-card" style={{ padding: '14px 20px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <Lightbulb size={15} style={{ color: 'rgba(234,179,8,0.7)', flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 10, color: 'rgba(234,179,8,0.6)', fontWeight: 600, letterSpacing: '0.08em', marginBottom: 3 }}>ONE CHANGE FROM YESTERDAY</div>
            <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' }}>"{yesterdayChange}"</p>
          </div>
        </div>
      )}

      {/* ── Auto-plan Banner ── */}
      {prevUnfinished.length > 0 && tasks.length === 0 && (
        <div className="g-card g-card-glow" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sparkles size={16} style={{ color: 'rgba(139,92,246,0.8)' }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.8)', marginBottom: 2 }}>Auto-Plan from Yesterday</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{prevUnfinished.length} unfinished tasks from {prevDate}</div>
            </div>
          </div>
          <button onClick={() => onOpenAutoPlan(prevDate, prevUnfinished)} className="g-btn g-btn-primary" style={{ padding: '9px 18px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={13} /><span>Review & Import</span>
          </button>
        </div>
      )}

      {/* ── Tag Filter ── */}
      {allTags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          <button onClick={() => setSelectedTag(null)}
            className="g-pill"
            style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, color: !selectedTag ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)', flexShrink: 0, border: `1px solid ${!selectedTag ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.07)'}`, cursor: 'pointer', background: !selectedTag ? 'rgba(139,92,246,0.1)' : 'var(--glass-bg)', transition: 'all 0.2s' }}>
            All
          </button>
          {allTags.map(tag => (
            <button key={tag} onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
              className="g-pill"
              style={{ padding: '4px 12px', fontSize: 11, fontWeight: 500, color: selectedTag === tag ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)', flexShrink: 0, border: `1px solid ${selectedTag === tag ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.07)'}`, cursor: 'pointer', background: selectedTag === tag ? 'rgba(139,92,246,0.1)' : 'var(--glass-bg)', transition: 'all 0.2s' }}>
              #{tag}
            </button>
          ))}
        </div>
      )}

      {/* ── PHONE: Scrollable Section Tabs + Cards ── */}
      {isPhone && (
        <div>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8 }}>
            {sections.map(sec => {
              const count = tasks.filter(t => t.sectionId === sec.id).length;
              const isActive = selectedSection === sec.id;
              return (
                <button key={sec.id} onClick={() => setSelectedSection(isActive ? null : sec.id)}
                  className="g-pill"
                  style={{
                    padding: '6px 14px', fontSize: 11, fontWeight: 600, flexShrink: 0,
                    color: isActive ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
                    border: `1px solid ${isActive ? sec.color + '60' : 'rgba(255,255,255,0.07)'}`,
                    background: isActive ? sec.color + '15' : 'var(--glass-bg)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.2s',
                  }}>
                  <span>{sec.icon}</span><span>{sec.name}</span>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.06)', padding: '0 4px', borderRadius: 999 }}>{count}</span>
                </button>
              );
            })}
          </div>

          {filtered.length === 0 ? (
            <div className="g-card" style={{ padding: '40px 24px', textAlign: 'center' }}>
              <div className="font-bloody" style={{ fontSize: 20, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>No plans yet</div>
              <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Tap + to plan with clear intention.</p>
            </div>
          ) : (
            <div>{filtered.map(t => <TaskCard key={t.id} task={t} />)}</div>
          )}
        </div>
      )}

      {/* ── PC: Board Columns ── */}
      {!isPhone && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 260px', gap: 14 }}>
          {/* Section Columns */}
          <div style={{ gridColumn: '1 / 4', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {sections.map(sec => {
              const secTasks = filtered.filter(t => t.sectionId === sec.id);
              const secMins = secTasks.reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
              return (
                <div key={sec.id} className="g-card"
                  style={{ minHeight: 320, display: 'flex', flexDirection: 'column', borderTop: `2px solid ${sec.color}40` }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { const id = e.dataTransfer.getData('text/plain'); if (id) moveSection(id, sec.id); }}>
                  {/* Section header */}
                  <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{sec.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>{sec.name}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
                        {Math.round((secMins / 60) * 10) / 10}h{sec.dailyTargetMinutes ? ` / ${Math.round((sec.dailyTargetMinutes / 60) * 10) / 10}h target` : ''}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.05)', padding: '2px 7px', borderRadius: 999, fontWeight: 700 }}>{secTasks.length}</span>
                  </div>

                  {/* Tasks in column */}
                  <div style={{ padding: 10, flex: 1, overflowY: 'auto' }}>
                    {secTasks.length === 0 ? (
                      <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'rgba(255,255,255,0.18)', border: '1px dashed rgba(255,255,255,0.06)', borderRadius: 10 }}>
                        Drop tasks here
                      </div>
                    ) : secTasks.map(task => (
                      <div key={task.id} draggable onDragStart={e => e.dataTransfer.setData('text/plain', task.id)}
                        className="g-task-row" style={{ padding: '11px 12px 11px 16px', marginBottom: 6, cursor: 'grab' }}>
                        <div className="g-section-accent" style={{ background: sec.color, boxShadow: `0 0 6px ${sec.color}40` }} />
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: task.textColor || 'rgba(255,255,255,0.85)', marginBottom: 3, cursor: 'pointer' }}
                              onClick={() => onOpenTaskModal(task)}>
                              {task.title}
                            </div>
                            {task.strategy && (
                              <div dangerouslySetInnerHTML={{ __html: task.strategy }}
                                style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: 4 }} />
                            )}
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', fontFamily: 'monospace', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <span>{task.estimatedMinutes}m</span>
                              <span>· {PRIORITY_ICON[task.priority]} {task.priority}</span>
                              {task.mustDo && <span style={{ color: 'rgba(234,179,8,0.6)' }}>★ Must-Do</span>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: 0 }} className="task-actions">
                            <button onClick={() => onOpenTaskModal(task)} className="g-icon-btn" style={{ width: 24, height: 24 }}><Edit2 size={10} /></button>
                            <button onClick={() => handleDeleteTask(task.id)} className="g-icon-btn" style={{ width: 24, height: 24, color: 'rgba(239,68,68,0.5)' }}><Trash2 size={10} /></button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add task to section shortcut */}
                  <button onClick={() => onOpenTaskModal(null)} style={{ margin: '0 10px 10px', padding: '8px', borderRadius: 10, border: '1px dashed rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.2)', fontSize: 12, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, transition: 'all 0.2s', fontFamily: 'system-ui, sans-serif' }}>
                    <Plus size={12} />Add task
                  </button>
                </div>
              );
            })}
          </div>

          {/* Day Summary Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Top 3 Must-Dos */}
            <div className="g-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Star size={14} style={{ color: 'rgba(234,179,8,0.7)', fill: 'rgba(234,179,8,0.7)' }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.07em' }}>TOP 3 MUST-DOS</span>
              </div>
              {mustDos.length === 0 ? (
                <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>Star up to 3 tasks as your daily non-negotiables.</p>
              ) : mustDos.map((t, i) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: i < mustDos.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                  <span style={{ width: 18, height: 18, borderRadius: 5, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: 'rgba(234,179,8,0.8)', flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                </div>
              ))}
            </div>

            {/* Section targets */}
            <div className="g-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.07em', marginBottom: 12 }}>SECTION TARGETS</div>
              {sections.map(sec => {
                const secMins = tasks.filter(t => t.sectionId === sec.id).reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
                const target = sec.dailyTargetMinutes;
                return (
                  <div key={sec.id} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>{sec.icon}</span><span>{sec.name}</span>
                      </span>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
                        {secMins}m{target ? ` / ${target}m` : ''}
                      </span>
                    </div>
                    {target && (
                      <div style={{ height: 3, borderRadius: 999, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 999, background: sec.color, width: `${Math.min(100, (secMins / target) * 100)}%`, boxShadow: `0 0 6px ${sec.color}60`, transition: 'width 0.3s ease' }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
