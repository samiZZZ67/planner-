/**
 * WCAG 2.1 Color Contrast Utilities
 */

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    return {
      r: parseInt(cleanHex[0] + cleanHex[0], 16),
      g: parseInt(cleanHex[1] + cleanHex[1], 16),
      b: parseInt(cleanHex[2] + cleanHex[2], 16),
    };
  }
  if (cleanHex.length === 6) {
    return {
      r: parseInt(cleanHex.substring(0, 2), 16),
      g: parseInt(cleanHex.substring(2, 4), 16),
      b: parseInt(cleanHex.substring(4, 6), 16),
    };
  }
  return null;
}

function getChannelLuminance(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function getRelativeLuminance(hexColor: string): number {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return 0;
  const r = getChannelLuminance(rgb.r);
  const g = getChannelLuminance(rgb.g);
  const b = getChannelLuminance(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function getContrastRatio(colorA: string, colorB: string): number {
  const lumA = getRelativeLuminance(colorA);
  const lumB = getRelativeLuminance(colorB);
  const brightest = Math.max(lumA, lumB);
  const darkest = Math.min(lumA, lumB);
  return (brightest + 0.05) / (darkest + 0.05);
}

export function passesContrastRatio(foreground: string, background: string, minimum = 4.5): boolean {
  return getContrastRatio(foreground, background) >= minimum;
}

// 8 Verified High-Contrast Strategy Text Colors (passes >= 4.5:1 on dark #0e0e15 and light #ffffff)
export interface StrategyColor {
  id: string;
  label: string;
  darkHex: string;   // Lighter shade for dark mode
  lightHex: string;  // Darker shade for light mode
}

export const STRATEGY_COLORS: StrategyColor[] = [
  { id: 'crimson', label: 'Red', darkHex: '#f87171', lightHex: '#b91c1c' },
  { id: 'amber', label: 'Orange', darkHex: '#fbbf24', lightHex: '#b45309' },
  { id: 'yellow', label: 'Yellow', darkHex: '#fde047', lightHex: '#854d0e' },
  { id: 'emerald', label: 'Green', darkHex: '#34d399', lightHex: '#047857' },
  { id: 'cyan', label: 'Cyan', darkHex: '#22d3ee', lightHex: '#0e7490' },
  { id: 'blue', label: 'Blue', darkHex: '#60a5fa', lightHex: '#1d4ed8' },
  { id: 'purple', label: 'Purple', darkHex: '#c084fc', lightHex: '#7e22ce' },
  { id: 'pink', label: 'Pink', darkHex: '#f472b6', lightHex: '#be185d' },
];

// Presets for section colors
export const PRESET_SECTION_COLORS = [
  { name: 'Purple', dark: '#a855f7', light: '#7e22ce' },
  { name: 'Amber', dark: '#f59e0b', light: '#b45309' },
  { name: 'Blue', dark: '#3b82f6', light: '#1d4ed8' },
  { name: 'Emerald', dark: '#10b981', light: '#047857' },
  { name: 'Indigo', dark: '#6366f1', light: '#4338ca' },
  { name: 'Rose', dark: '#f43f5e', light: '#be123c' },
  { name: 'Cyan', dark: '#06b6d4', light: '#0e7490' },
  { name: 'Slate', dark: '#94a3b8', light: '#475569' },
];

export const SECTION_COLORS = PRESET_SECTION_COLORS.map(c => c.dark);
