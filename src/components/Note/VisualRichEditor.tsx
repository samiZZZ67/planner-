'use client';

import React, { useRef, useEffect, useState } from 'react';
import {
  Bold as BoldIcon,
  Underline as UnderlineIcon,
  Strikethrough as StrikethroughIcon,
  Palette,
  Highlighter,
  RotateCcw
} from 'lucide-react';

interface VisualRichEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  minHeight?: number | string;
  className?: string;
}

const TEXT_COLORS = [
  { label: 'Default', value: 'inherit' },
  { label: 'Pure White', value: '#ffffff' },
  { label: 'Light Gray', value: '#d4d4d8' },
  { label: 'Mid Gray', value: '#a1a1aa' },
  { label: 'Dark Gray', value: '#52525b' },
  { label: 'Pure Black', value: '#000000' },
];

const HIGHLIGHT_COLORS = [
  { label: 'Clear', value: 'transparent' },
  { label: 'Soft White', value: 'rgba(255, 255, 255, 0.25)' },
  { label: 'Light Gray', value: 'rgba(255, 255, 255, 0.15)' },
  { label: 'Mid Gray', value: 'rgba(255, 255, 255, 0.08)' },
  { label: 'Subtle Dark', value: 'rgba(0, 0, 0, 0.3)' },
  { label: 'Dark Contrast', value: 'rgba(0, 0, 0, 0.6)' },
];

export function VisualRichEditor({
  value,
  onChange,
  placeholder = 'Write here...',
  minHeight = 240,
  className = '',
}: VisualRichEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Sync external value (e.g. date change or db load) into innerHTML only when not focused
  useEffect(() => {
    if (!editorRef.current) return;
    if (document.activeElement !== editorRef.current) {
      if (editorRef.current.innerHTML !== (value || '')) {
        editorRef.current.innerHTML = value || '';
      }
    }
  }, [value]);

  const notifyChange = () => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    // Clean up empty tags
    if (html === '<br>' || html === '<p><br></p>' || html === '<div><br></div>') {
      onChange('');
    } else {
      onChange(html);
    }
  };

  const handleInput = () => {
    notifyChange();
  };

  const applyFormat = (command: string, arg?: string) => {
    if (editorRef.current && document.activeElement !== editorRef.current) {
      editorRef.current.focus();
    }
    document.execCommand(command, false, arg);
    notifyChange();
  };

  const applyTextColor = (color: string) => {
    if (editorRef.current && document.activeElement !== editorRef.current) {
      editorRef.current.focus();
    }
    if (color === 'inherit') {
      document.execCommand('foreColor', false, 'var(--text-primary)');
    } else {
      document.execCommand('foreColor', false, color);
    }
    setShowColorPicker(false);
    notifyChange();
  };

  const applyHighlight = (color: string) => {
    if (editorRef.current && document.activeElement !== editorRef.current) {
      editorRef.current.focus();
    }
    if (color === 'transparent') {
      document.execCommand('hiliteColor', false, 'transparent');
      document.execCommand('backColor', false, 'transparent');
    } else {
      const ok = document.execCommand('hiliteColor', false, color);
      if (!ok) {
        document.execCommand('backColor', false, color);
      }
    }
    setShowHighlightPicker(false);
    notifyChange();
  };

  const clearFormatting = () => {
    if (editorRef.current && document.activeElement !== editorRef.current) {
      editorRef.current.focus();
    }
    document.execCommand('removeFormat', false);
    notifyChange();
  };

  const isEmpty = !value || value === '<br>' || value === '<p><br></p>' || value === '<div><br></div>';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
      {/* ── Visual Formatting Toolbar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 12px',
          background: 'var(--v-glass-bg-subtle)',
          borderTopLeftRadius: 14,
          borderTopRightRadius: 14,
          border: '1.5px solid var(--v-glass-border)',
          borderBottom: 'none',
          flexWrap: 'wrap',
          position: 'relative',
          zIndex: 10,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em', marginRight: 4 }}>
          FORMAT:
        </span>

        {/* Bold */}
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); applyFormat('bold'); }}
          className="v-circle-btn"
          style={{ width: 30, height: 30, fontWeight: 700 }}
          title="Bold (Select text & click)"
          aria-label="Bold"
        >
          <BoldIcon size={13} />
        </button>

        {/* Underline */}
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); applyFormat('underline'); }}
          className="v-circle-btn"
          style={{ width: 30, height: 30 }}
          title="Underline (Select text & click)"
          aria-label="Underline"
        >
          <UnderlineIcon size={13} />
        </button>

        {/* Strikethrough */}
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); applyFormat('strikeThrough'); }}
          className="v-circle-btn"
          style={{ width: 30, height: 30 }}
          title="Strikethrough (Select text & click)"
          aria-label="Strikethrough"
        >
          <StrikethroughIcon size={13} />
        </button>

        <div style={{ width: 1, height: 16, background: 'var(--v-glass-border)', margin: '0 4px' }} />

        {/* Text Color Picker Toggle */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); setShowColorPicker(prev => !prev); setShowHighlightPicker(false); }}
            className="v-pill-btn"
            style={{ padding: '4px 8px', fontSize: 11, minHeight: 30, gap: 4 }}
            title="Text Color"
          >
            <Palette size={13} color="var(--accent-color)" />
            <span>Color</span>
          </button>

          {showColorPicker && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 6,
                padding: '8px 10px',
                background: 'var(--v-glass-bg-card)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                border: '1.5px solid var(--v-glass-border)',
                borderRadius: 12,
                boxShadow: 'var(--v-shadow-card)',
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                zIndex: 50,
              }}
            >
              {TEXT_COLORS.map(c => (
                <button
                  key={c.label}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); applyTextColor(c.value); }}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: c.value === 'inherit' ? 'var(--text-primary)' : c.value,
                    border: '1.5px solid var(--v-glass-border)',
                    cursor: 'pointer',
                    transition: 'transform 0.15s ease',
                  }}
                  title={c.label}
                  onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.2)')}
                  onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                />
              ))}
            </div>
          )}
        </div>

        {/* Highlight Picker Toggle */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); setShowHighlightPicker(prev => !prev); setShowColorPicker(false); }}
            className="v-pill-btn"
            style={{ padding: '4px 8px', fontSize: 11, minHeight: 30, gap: 4 }}
            title="Highlight Color"
          >
            <Highlighter size={13} color="var(--text-primary)" />
            <span>Highlight</span>
          </button>

          {showHighlightPicker && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 6,
                padding: '8px 10px',
                background: 'var(--v-glass-bg-card)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                border: '1.5px solid var(--v-glass-border)',
                borderRadius: 12,
                boxShadow: 'var(--v-shadow-card)',
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                zIndex: 50,
              }}
            >
              {HIGHLIGHT_COLORS.map(h => (
                <button
                  key={h.label}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); applyHighlight(h.value); }}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    background: h.value === 'transparent' ? 'transparent' : h.value,
                    border: h.value === 'transparent' ? '1.5px dashed var(--v-glass-border)' : '1.5px solid var(--v-glass-border)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    transition: 'transform 0.15s ease',
                  }}
                  title={h.label}
                  onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.2)')}
                  onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                >
                  {h.value === 'transparent' ? '✕' : ''}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Clear formatting */}
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); clearFormatting(); }}
          className="v-circle-btn"
          style={{ width: 30, height: 30 }}
          title="Clear formatting on selection"
          aria-label="Clear formatting"
        >
          <RotateCcw size={12} />
        </button>

        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          Select text to format
        </span>
      </div>

      {/* ── ContentEditable Editor Area ── */}
      <div style={{ position: 'relative' }}>
        <div
          ref={editorRef}
          contentEditable={true}
          suppressContentEditableWarning={true}
          onInput={handleInput}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            setIsFocused(false);
            notifyChange();
          }}
          className={`rich-text-editor font-system ${className}`}
          style={{
            minHeight,
            padding: '16px',
            background: 'var(--v-glass-bg-card)',
            border: '1.5px solid var(--v-glass-border)',
            borderBottomLeftRadius: 14,
            borderBottomRightRadius: 14,
            outline: isFocused ? '2px solid var(--accent-color)' : 'none',
            outlineOffset: -1,
            color: 'var(--text-primary)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            fontSize: 15,
            lineHeight: 1.6,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            cursor: 'text',
          }}
        />

        {/* Visual placeholder when empty */}
        {isEmpty && !isFocused && (
          <div
            onClick={() => {
              editorRef.current?.focus();
            }}
            style={{
              position: 'absolute',
              top: 16,
              left: 16,
              color: 'var(--text-muted)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
              fontSize: 15,
              lineHeight: 1.6,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
}
