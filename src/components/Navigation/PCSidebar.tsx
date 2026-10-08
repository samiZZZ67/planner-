'use client';

import React from 'react';
import { Calendar, CheckSquare, BarChart3, Settings, Plus, Sparkles } from 'lucide-react';
import type { TabType } from './PhoneTabBar';

interface PCSidebarProps {
  currentTab: TabType;
  onSelectTab: (tab: TabType) => void;
  onOpenNewTask: () => void;
}

export function PCSidebar({ currentTab, onSelectTab, onOpenNewTask }: PCSidebarProps) {
  const navItems: { id: TabType; label: string; icon: React.ReactNode; shortcut: string }[] = [
    { id: 'plan', label: 'Plan Tomorrow', icon: <Calendar className="w-5 h-5" />, shortcut: '1' },
    { id: 'today', label: 'Today Action', icon: <CheckSquare className="w-5 h-5" />, shortcut: '2' },
    { id: 'progress', label: 'Analytics', icon: <BarChart3 className="w-5 h-5" />, shortcut: '3' },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-5 h-5" />, shortcut: '4' },
  ];

  return (
    <aside className="w-64 shrink-0 border-r border-border-color bg-bg-secondary min-h-[calc(100vh-61px)] flex flex-col justify-between p-4">
      <div className="space-y-6">
        {/* Quick Add Button */}
        <button
          onClick={onOpenNewTask}
          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium flex items-center justify-center gap-2 shadow-lg shadow-purple-900/30 transition-all hover:scale-[1.01] active:scale-[0.99]"
          aria-label="Add new task (Shortcut: N)"
        >
          <Plus className="w-4 h-4" />
          <span>New Task</span>
          <kbd className="ml-auto text-[10px] bg-white/20 px-1.5 py-0.5 rounded font-mono">N</kbd>
        </button>

        {/* Navigation Items */}
        <nav className="space-y-1.5" aria-label="PC Sidebar Navigation">
          {navItems.map(item => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-purple-950/60 text-purple-300 border border-purple-800/60'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <div className={`${isActive ? 'text-accent-primary' : 'text-text-muted'}`}>
                  {item.icon}
                </div>
                <span>{item.label}</span>
                <kbd className="ml-auto text-[11px] font-mono text-text-muted/60 bg-bg-card px-1.5 py-0.5 rounded border border-border-color">
                  {item.shortcut}
                </kbd>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Philosophy Card */}
      <div className="p-3.5 rounded-xl bg-bg-card border border-border-color text-xs text-text-muted">
        <div className="flex items-center gap-2 text-text-primary font-medium mb-1">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Evening Clarity</span>
        </div>
        <p className="leading-relaxed">
          Plan what, how, how long, and done means. Free your mind to sleep peacefully.
        </p>
      </div>
    </aside>
  );
}
