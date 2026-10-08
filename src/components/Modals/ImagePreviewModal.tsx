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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${title}`}
    >
      <div
        className="relative max-w-4xl max-h-[90vh] bg-bg-card rounded-2xl overflow-hidden border border-border-color shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
          aria-label="Close image preview"
        >
          <X className="w-5 h-5" />
        </button>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={title}
          className="max-h-[80vh] w-auto object-contain mx-auto"
        />

        <div className="p-3 bg-bg-secondary border-t border-border-color text-center">
          <p className="text-sm font-medium text-text-primary">{title}</p>
        </div>
      </div>
    </div>
  );
}
