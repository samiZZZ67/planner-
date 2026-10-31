'use client';

import React, { useState } from 'react';
import { marked, type Tokens } from 'marked';
import { Check, Copy } from 'lucide-react';

interface FormattedMessageProps {
  content: string;
  className?: string;
}

/**
 * Normalizes common LLM formatting artifacts and malformed sequences
 * such as escaped asterisks (**\*\*b), unclosed code blocks, or raw unclosed formatting.
 */
function normalizeMarkdown(raw: string): string {
  if (!raw) return '';
  let text = raw;

  // 1. Remove dangerous executable scripts/styles
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // 2. Fix malformed escaped asterisks (e.g. "**\*\*b" -> "**b**" or "\*\*text\*\*" -> "**text**")
  text = text.replace(/\\\*/g, '*');
  // Collapse 4+ consecutive asterisks into double asterisks
  text = text.replace(/\*{4,}/g, '**');

  // 3. Gracefully close open code block if generation was stopped mid-stream
  const codeBlockCount = (text.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    text += '\n```';
  }

  // 4. Auto-close dangling bold tags at end of message if generation was stopped
  const boldCount = (text.match(/\*\*/g) || []).length;
  if (boldCount % 2 !== 0) {
    text += '**';
  }

  return text;
}

function sanitizeHref(href?: string): string {
  if (!href) return '#';
  const clean = href.trim().toLowerCase();
  if (clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('mailto:') || clean.startsWith('#')) {
    return href;
  }
  return '#';
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      style={{
        margin: '10px 0',
        borderRadius: 10,
        overflow: 'hidden',
        border: '1.5px solid var(--v-glass-border)',
        background: 'var(--v-glass-bg-subtle)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          background: 'var(--v-glass-bg-hover)',
          borderBottom: '1px solid var(--v-glass-border-subtle)',
          fontSize: 11,
          fontFamily: 'monospace',
          color: 'var(--text-muted)',
        }}
      >
        <span>{lang || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            background: 'none',
            border: 'none',
            color: copied ? '#ffffff' : 'var(--text-secondary)',
            fontSize: 11,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 4px',
            borderRadius: 4,
          }}
          title="Copy code"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '12px 14px',
          overflowX: 'auto',
          fontSize: 12.5,
          lineHeight: 1.5,
          fontFamily: 'monospace',
          color: 'var(--text-primary)',
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function FormattedMessage({ content, className }: FormattedMessageProps) {
  const normalized = normalizeMarkdown(content);

  // Parse markdown AST into structured tokens
  const tokens = React.useMemo(() => {
    try {
      return marked.lexer(normalized, { gfm: true, breaks: true });
    } catch {
      return [];
    }
  }, [normalized]);

  const renderInlineToken = (token: Tokens.Generic, key: string | number): React.ReactNode => {
    switch (token.type) {
      case 'strong':
        return (
          <strong key={key} style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
            {token.tokens ? token.tokens.map((sub: any, i: number) => renderInlineToken(sub, i)) : token.text}
          </strong>
        );
      case 'em':
        return (
          <em key={key} style={{ fontStyle: 'italic', color: 'var(--text-primary)' }}>
            {token.tokens ? token.tokens.map((sub: any, i: number) => renderInlineToken(sub, i)) : token.text}
          </em>
        );
      case 'codespan':
        return (
          <code
            key={key}
            style={{
              padding: '2px 6px',
              borderRadius: 5,
              background: 'var(--v-glass-bg-subtle)',
              border: '1px solid var(--v-glass-border-subtle)',
              fontFamily: 'monospace',
              fontSize: '0.9em',
              color: 'var(--accent-color)',
            }}
          >
            {token.text}
          </code>
        );
      case 'link': {
        const safeHref = sanitizeHref(token.href);
        return (
          <a
            key={key}
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--accent-color)',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            {token.tokens ? token.tokens.map((sub: any, i: number) => renderInlineToken(sub, i)) : token.text}
          </a>
        );
      }
      case 'image': {
        const safeSrc = sanitizeHref(token.href);
        if (safeSrc === '#') return null;
        return (
          <img
            key={key}
            src={safeSrc}
            alt={token.text || 'AI attachment'}
            style={{
              maxWidth: '100%',
              borderRadius: 8,
              margin: '8px 0',
              border: '1.5px solid var(--v-glass-border)',
              display: 'block',
            }}
          />
        );
      }
      case 'del':
        return (
          <del key={key} style={{ textDecoration: 'line-through', opacity: 0.7 }}>
            {token.tokens ? token.tokens.map((sub: any, i: number) => renderInlineToken(sub, i)) : token.text}
          </del>
        );
      case 'html': {
        // Strip raw HTML tags so they are not executed or displayed as ugly markup
        const cleanText = token.text ? token.text.replace(/<[^>]*>/g, '') : '';
        return cleanText ? <span key={key}>{cleanText}</span> : null;
      }
      case 'text':
      default:
        return <span key={key}>{token.text}</span>;
    }
  };

  const renderInline = (inlineTokens?: Tokens.Generic[]): React.ReactNode => {
    if (!inlineTokens || inlineTokens.length === 0) return null;
    return inlineTokens.map((t, i) => renderInlineToken(t, i));
  };

  const renderBlockToken = (token: Tokens.Generic, index: number): React.ReactNode => {
    switch (token.type) {
      case 'heading': {
        const level = token.depth || 1;
        const fontSizes: Record<number, number> = { 1: 18, 2: 16, 3: 14.5, 4: 13.5, 5: 13, 6: 12.5 };
        return (
          <div
            key={index}
            role="heading"
            aria-level={level}
            style={{
              fontSize: fontSizes[level] || 15,
              fontWeight: 700,
              margin: '12px 0 6px',
              color: 'var(--text-primary)',
              lineHeight: 1.3,
            }}
          >
            {token.tokens ? renderInline(token.tokens) : token.text}
          </div>
        );
      }

      case 'paragraph':
        return (
          <p key={index} style={{ margin: '6px 0', lineHeight: 1.6, color: 'var(--text-primary)' }}>
            {token.tokens ? renderInline(token.tokens) : token.text}
          </p>
        );

      case 'list': {
        const isOrdered = token.ordered;
        const ListTag = isOrdered ? 'ol' : 'ul';
        return (
          <ListTag
            key={index}
            style={{
              margin: '8px 0',
              paddingLeft: isOrdered ? 22 : 18,
              listStyleType: isOrdered ? 'decimal' : 'disc',
              color: 'var(--text-primary)',
            }}
          >
            {token.items?.map((item: any, itemIdx: number) => (
              <li key={itemIdx} style={{ margin: '4px 0', lineHeight: 1.5 }}>
                {item.tokens ? renderInline(item.tokens) : item.text}
              </li>
            ))}
          </ListTag>
        );
      }

      case 'table':
        return (
          <div
            key={index}
            style={{
              width: '100%',
              overflowX: 'auto',
              margin: '12px 0',
              borderRadius: 10,
              border: '1.5px solid var(--v-glass-border)',
              background: 'var(--v-glass-bg-subtle)',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--v-glass-border)', background: 'var(--v-glass-bg-hover)' }}>
                  {token.header?.map((cell: any, hIdx: number) => (
                    <th
                      key={hIdx}
                      style={{
                        padding: '8px 12px',
                        fontWeight: 700,
                        color: 'var(--text-primary)',
                        textAlign: cell.align || 'left',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cell.tokens ? renderInline(cell.tokens) : cell.text}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {token.rows?.map((row: any[], rIdx: number) => (
                  <tr
                    key={rIdx}
                    style={{
                      borderBottom: rIdx === token.rows.length - 1 ? 'none' : '1px solid var(--v-glass-border-subtle)',
                      background: rIdx % 2 === 1 ? 'var(--v-glass-bg-subtle)' : 'transparent',
                    }}
                  >
                    {row.map((cell: any, cIdx: number) => (
                      <td
                        key={cIdx}
                        style={{
                          padding: '8px 12px',
                          color: 'var(--text-secondary)',
                          textAlign: cell.align || 'left',
                        }}
                      >
                        {cell.tokens ? renderInline(cell.tokens) : cell.text}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      case 'code':
        return <CodeBlock key={index} code={token.text || ''} lang={token.lang} />;

      case 'blockquote':
        return (
          <blockquote
            key={index}
            style={{
              margin: '8px 0',
              padding: '6px 14px',
              borderLeft: '3px solid var(--accent-color)',
              background: 'var(--v-glass-bg-subtle)',
              borderRadius: '0 8px 8px 0',
              fontStyle: 'italic',
              color: 'var(--text-secondary)',
            }}
          >
            {token.tokens ? (
              token.tokens.map((sub: any, sIdx: number) => renderBlockToken(sub, sIdx))
            ) : (
              <p style={{ margin: 0 }}>{token.text}</p>
            )}
          </blockquote>
        );

      case 'hr':
        return (
          <hr
            key={index}
            style={{
              border: 'none',
              borderTop: '1px solid var(--v-glass-border)',
              margin: '12px 0',
            }}
          />
        );

      case 'html': {
        const clean = token.text ? token.text.replace(/<[^>]*>/g, '') : '';
        return clean ? <p key={index} style={{ margin: '4px 0' }}>{clean}</p> : null;
      }

      case 'space':
        return null;

      default:
        return (
          <div key={index} style={{ margin: '4px 0' }}>
            {token.tokens ? renderInline(token.tokens) : token.text}
          </div>
        );
    }
  };

  // If marked didn't produce tokens or empty string, fallback to clean text
  if (!tokens || tokens.length === 0) {
    return <span className={className}>{content}</span>;
  }

  return (
    <div className={className} style={{ width: '100%', wordBreak: 'break-word' }}>
      {tokens.map((token, idx) => renderBlockToken(token, idx))}
    </div>
  );
}
