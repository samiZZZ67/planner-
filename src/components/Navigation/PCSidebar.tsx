'use client';

import React from 'react';
import { ListChecks, BarChart3, Settings, Plus, StickyNote, Tag, CalendarRange, CalendarDays } from 'lucide-react';
import type { TabType } from './PhoneTabBar';

interface PCSidebarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
}

export function PCSidebar({ currentTab, onSelectTab }: PCSidebarProps) {
  const navItems: { id: TabType; icon: React.ReactNode; label: string; shortcut: string }[] = [
    { id: 'todo', icon: <ListChecks size={20} />, label: 'To-Do List', shortcut: '1' },
    { id: 'weekly', icon: <CalendarRange size={20} />, label: 'Weekly Plan', shortcut: '2' },
    { id: 'monthly', icon: <CalendarDays size={20} />, label: 'Monthly Plan', shortcut: '3' },
    { id: 'add_task', icon: <Plus size={20} />, label: 'Add Task', shortcut: '4' },
    { id: 'note', icon: <StickyNote size={20} />, label: 'Note', shortcut: '5' },
    { id: 'category', icon: <Tag size={20} />, label: 'Category', shortcut: '6' },
  ];

  return (
    <aside
      className="v-dock"
      style={{
        width: 68,
        padding: '20px 8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
        flexShrink: 0,
        height: 'fit-content',
        position: 'sticky',
        top: 28,
        zIndex: 30,
        marginRight: 24,
      }}
      aria-label="Navigation Dock"
    >
      {/* Top Logo Emblem Circle */}
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: 'var(--v-glass-bg-subtle)',
          border: '1.5px solid var(--v-glass-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          boxShadow: 'var(--v-shadow-btn)',
          cursor: 'pointer',
        }}
        title="Night Planner"
      >
        <span>🌙</span>
      </div>

      <div style={{ width: 32, height: 1, background: 'var(--v-glass-border-subtle)', margin: '2px 0' }} />

      {/* Nav Icons Stack */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        {navItems.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectTab(item.id)}
            className={`v-circle-btn${currentTab === item.id ? ' active' : ''}`}
            title={`${item.label} (${item.shortcut})`}
            aria-label={item.label}
          >
            {item.icon}
          </button>
        ))}
      </nav>

      <div style={{ width: 32, height: 1, background: 'var(--v-glass-border-subtle)', margin: '2px 0' }} />

      {/* Analytics & Settings at bottom */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => onSelectTab('analytics')}
          className={`v-circle-btn${currentTab === 'analytics' ? ' active' : ''}`}
          title="Analytics (5)"
          aria-label="Analytics"
        >
          <BarChart3 size={20} />
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('settings')}
          className={`v-circle-btn${currentTab === 'settings' ? ' active' : ''}`}
          title="Settings (6)"
          aria-label="Settings"
        >
          <Settings size={20} />
        </button>
      </nav>
    </aside>
  );
}
