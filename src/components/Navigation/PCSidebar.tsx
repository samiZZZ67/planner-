'use client';

import React from 'react';
import { CheckSquare, BarChart3, Settings } from 'lucide-react';
import type { TabType } from './PhoneTabBar';

interface PCSidebarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
}

export function PCSidebar({ currentTab, onSelectTab }: PCSidebarProps) {
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

      {/* Nav Icons Stack: Todo, Analytics, Settings */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => onSelectTab('todo')}
          className={`v-circle-btn${currentTab === 'todo' ? ' active' : ''}`}
          title="Todo (1)"
          aria-label="Todo"
        >
          <CheckSquare size={20} />
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('analytics')}
          className={`v-circle-btn${currentTab === 'analytics' ? ' active' : ''}`}
          title="Analytics (2)"
          aria-label="Analytics"
        >
          <BarChart3 size={20} />
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('settings')}
          className={`v-circle-btn${currentTab === 'settings' ? ' active' : ''}`}
          title="Settings (3)"
          aria-label="Settings"
        >
          <Settings size={20} />
        </button>
      </nav>
    </aside>
  );
}
