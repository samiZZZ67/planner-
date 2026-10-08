'use client';

import React from 'react';
import { Calendar, CheckSquare, BarChart3, Settings, Plus, Pin, MoreHorizontal } from 'lucide-react';
import type { TabType } from './PhoneTabBar';

interface PCSidebarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  onOpenNewTask: () => void;
}

export function PCSidebar({ currentTab, onSelectTab, onOpenNewTask }: PCSidebarProps) {
  return (
    <aside
      className="v-dock"
      style={{
        width: 66,
        padding: '18px 8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
        height: 'fit-content',
        position: 'sticky',
        top: 24,
        zIndex: 30,
        marginRight: 24,
      }}
      aria-label="VisionOS Navigation Dock"
    >
      {/* Top Logo Emblem Circle */}
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.12)',
          border: '1.5px solid rgba(255, 255, 255, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 20,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255,255,255,0.4)',
          cursor: 'pointer',
        }}
        title="Night Planner"
      >
        <span>🌙</span>
      </div>

      <div style={{ width: 30, height: 1, background: 'rgba(255,255,255,0.12)', margin: '4px 0' }} />

      {/* Nav Icons Stack */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <button
          onClick={() => onSelectTab('plan')}
          className={`v-circle-btn${currentTab === 'plan' ? ' active' : ''}`}
          title="Plan Tomorrow (1)"
          aria-label="Plan Tomorrow"
        >
          <Calendar size={18} />
        </button>

        <button
          onClick={() => onSelectTab('today')}
          className={`v-circle-btn${currentTab === 'today' ? ' active' : ''}`}
          title="Today Tasks & Live Timer (2)"
          aria-label="Today"
        >
          <CheckSquare size={18} />
        </button>

        <button
          onClick={onOpenNewTask}
          className="v-circle-btn"
          title="New Task (N)"
          aria-label="New Task"
          style={{ background: 'rgba(255, 255, 255, 0.2)', color: '#ffffff' }}
        >
          <Plus size={20} />
        </button>

        <button
          onClick={() => onSelectTab('progress')}
          className={`v-circle-btn${currentTab === 'progress' ? ' active' : ''}`}
          title="Analytics & Progress (3)"
          aria-label="Analytics"
        >
          <BarChart3 size={18} />
        </button>

        <button
          onClick={() => onSelectTab('settings')}
          className={`v-circle-btn${currentTab === 'settings' ? ' active' : ''}`}
          title="Settings (4)"
          aria-label="Settings"
        >
          <Settings size={18} />
        </button>
      </nav>

      <div style={{ width: 30, height: 1, background: 'rgba(255,255,255,0.12)', margin: '4px 0' }} />

      {/* Pin and More Buttons (matching reference image) */}
      <button
        onClick={onOpenNewTask}
        className="v-circle-btn"
        title="Quick Pin"
        aria-label="Quick Pin"
        style={{ width: 38, height: 38 }}
      >
        <Pin size={15} />
      </button>

      <button
        onClick={() => onSelectTab('settings')}
        className="v-circle-btn"
        title="More Options"
        aria-label="More Options"
        style={{ width: 38, height: 38 }}
      >
        <MoreHorizontal size={15} />
      </button>
    </aside>
  );
}
