'use client';

import React from 'react';
import { X } from 'lucide-react';

interface ImagePreviewModalProps {
  imageUrl: string | null;
  title: string;
  onClose: () => void;
}

export function ImagePreviewModal({ imageUrl, title, onClose }: ImagePreviewModalProps) {
  if (!imageUrl) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${title}`}
    >
      <div
        className="g-card"
        style={{
          maxWidth: '90vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="g-icon-btn"
          style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, width: 32, height: 32, background: 'rgba(0,0,0,0.6)' }}
          aria-label="Close image preview"
        >
          <X size={15} />
        </button>

        <img
          src={imageUrl}
          alt={title}
          style={{ maxHeight: '78vh', width: 'auto', objectFit: 'contain', margin: '0 auto' }}
        />

        <div style={{ padding: '10px 16px', background: 'rgba(15,15,18,0.9)', borderTop: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.8)' }}>{title}</p>
        </div>
      </div>
    </div>
  );
}
