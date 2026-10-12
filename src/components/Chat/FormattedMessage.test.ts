import { describe, it, expect } from 'vitest';
import { marked } from 'marked';

// Test the exact normalization logic
function normalizeMarkdown(raw: string): string {
  if (!raw) return '';
  let text = raw;
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  text = text.replace(/\\\*/g, '*');
  text = text.replace(/\*{4,}/g, '**');
  const codeBlockCount = (text.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    text += '\n```';
  }
  const boldCount = (text.match(/\*\*/g) || []).length;
  if (boldCount % 2 !== 0) {
    text += '**';
  }
  return text;
}

describe('AI Message Markdown Formatting & Normalization', () => {
  it('should clean and normalize malformed bold syntax like **\\*\\*b', () => {
    const raw = 'This is **\\*\\*b';
    const normalized = normalizeMarkdown(raw);
    expect(normalized).toBe('This is **b**');
    const tokens = marked.lexer(normalized);
    expect(tokens[0].type).toBe('paragraph');
    const strong = (tokens[0] as any).tokens?.find((t: any) => t.type === 'strong');
    expect(strong).toBeDefined();
    expect(strong.text).toBe('b');
  });

  it('should safely auto-close unclosed code blocks when stopped mid-stream', () => {
    const raw = 'Here is the script:\n```python\nprint("Hello")';
    const normalized = normalizeMarkdown(raw);
    expect(normalized.endsWith('```')).toBe(true);
    const tokens = marked.lexer(normalized);
    const codeToken = tokens.find(t => t.type === 'code');
    expect(codeToken).toBeDefined();
    expect((codeToken as any).text).toContain('print("Hello")');
  });

  it('should correctly tokenize markdown tables', () => {
    const markdown = '| Task | Duration |\n|---|---|\n| Deep Work | 2h |\n| Review | 30m |';
    const tokens = marked.lexer(markdown);
    const tableToken = tokens.find(t => t.type === 'table') as any;
    expect(tableToken).toBeDefined();
    expect(tableToken.header).toHaveLength(2);
    expect(tableToken.rows).toHaveLength(2);
  });

  it('should strip dangerous script tags', () => {
    const raw = 'Hello <script>alert("hack")</script> world';
    const normalized = normalizeMarkdown(raw);
    expect(normalized).not.toContain('<script>');
    expect(normalized).toBe('Hello  world');
  });
});
