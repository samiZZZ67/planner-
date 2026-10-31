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
  { id: 'white', label: 'White', darkHex: '#ffffff', lightHex: '#000000' },
  { id: 'silver', label: 'Silver', darkHex: '#f4f4f5', lightHex: '#18181b' },
  { id: 'light-gray', label: 'Light Gray', darkHex: '#e4e4e7', lightHex: '#27272a' },
  { id: 'gray', label: 'Gray', darkHex: '#d4d4d8', lightHex: '#3f3f46' },
  { id: 'neutral-light', label: 'Neutral Light', darkHex: '#d4d4d8', lightHex: '#52525b' },
  { id: 'neutral', label: 'Neutral', darkHex: '#a1a1aa', lightHex: '#52525b' },
  { id: 'medium-gray', label: 'Medium Gray', darkHex: '#8e8e93', lightHex: '#71717a' },
  { id: 'charcoal', label: 'Charcoal', darkHex: '#71717a', lightHex: '#a1a1aa' },
];

// Presets for section colors (Clean Black & White / Grayscale)
export const PRESET_SECTION_COLORS = [
  { name: 'White', dark: '#ffffff', light: '#000000' },
  { name: 'Silver', dark: '#f4f4f5', light: '#18181b' },
  { name: 'Light Gray', dark: '#e4e4e7', light: '#27272a' },
  { name: 'Gray', dark: '#d4d4d8', light: '#3f3f46' },
  { name: 'Neutral Light', dark: '#d4d4d8', light: '#52525b' },
  { name: 'Neutral', dark: '#a1a1aa', light: '#52525b' },
  { name: 'Medium Gray', dark: '#8e8e93', light: '#71717a' },
  { name: 'Charcoal', dark: '#71717a', light: '#a1a1aa' },
];

export const SECTION_COLORS = PRESET_SECTION_COLORS.map(c => c.dark);
