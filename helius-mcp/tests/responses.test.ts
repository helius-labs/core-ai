import { describe, it, expect } from 'vitest';
import type { ResponseFamily, DetailLevel } from '../src/router/types.js';
import {
  cleanText,
  truncateText,
  compactErrorText,
  buildTextVariant,
  estimateRenderedSize,
  collectSectionHints,
  applySectionSelection,
  applyItemSelection,
  applyRangeSelection,
  toPlainText,
  getFamilyLimit,
  mcpText,
  mcpErrorCompact,
  mcpResultHandle,
} from '../src/router/responses.js';

// ─── cleanText ───

describe('cleanText', () => {
  it('normalizes CRLF to LF', () => {
    expect(cleanText('line1\r\nline2\r\n')).toBe('line1\nline2');
  });

  it('handles mixed CRLF and LF in the same string', () => {
    expect(cleanText('a\r\nb\nc\r\nd')).toBe('a\nb\nc\nd');
  });

  it('collapses 3+ consecutive newlines to 2', () => {
    expect(cleanText('a\n\n\n\nb')).toBe('a\n\nb');
    expect(cleanText('a\n\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('preserves exactly 2 consecutive newlines', () => {
    expect(cleanText('a\n\nb')).toBe('a\n\nb');
  });

  it('trims leading and trailing whitespace', () => {
    expect(cleanText('  hello  ')).toBe('hello');
  });

  it('returns empty string for empty input', () => {
    expect(cleanText('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(cleanText('   \n\n  ')).toBe('');
  });
});

// ─── truncateText ───

describe('truncateText', () => {
  it('returns text unchanged when under the limit', () => {
    expect(truncateText('short', 100)).toBe('short');
  });

  it('returns text unchanged when exactly at the limit', () => {
    const text = 'a'.repeat(50);
    expect(truncateText(text, 50)).toBe(text);
  });

  it('appends [truncated] when text exceeds limit', () => {
    const result = truncateText('a'.repeat(200), 50);
    expect(result).toContain('[truncated]');
  });

  it('does not append [truncated] when text is within limit', () => {
    expect(truncateText('hello', 100)).not.toContain('[truncated]');
  });

  it('snaps to heading boundary when it falls above 55% of limit', () => {
    // Place a ## heading at position 60 in a 100-char limit (60% > 55%)
    const before = 'x'.repeat(58) + '\n\n## Heading\n' + 'y'.repeat(80);
    const result = truncateText(before, 100);
    // Should cut at the heading boundary, not include content after it
    expect(result).not.toContain('Heading');
    expect(result).toContain('[truncated]');
  });

  it('ignores heading boundary when it falls below 55% of limit', () => {
    // Place a ## heading at position 10 in a 100-char limit (10% < 55%)
    const before = 'x'.repeat(8) + '\n\n## Early\n' + 'y'.repeat(200);
    const result = truncateText(before, 100);
    // Should cut at hard limit since boundary is too early
    expect(result).toContain('[truncated]');
    // The result should be longer than just up to the heading
    expect(result.replace('\n\n[truncated]', '').length).toBeGreaterThan(20);
  });

  it('prefers markdown heading boundary over double-newline', () => {
    // Both \n## and \n\n exist, but \n## is later
    const text = 'intro\n\nparagraph ' + 'a'.repeat(30) + '\n## Section\n' + 'b'.repeat(80);
    const result = truncateText(text, 70);
    expect(result).toContain('[truncated]');
  });

  it('snaps to ### heading boundary', () => {
    const text = 'x'.repeat(58) + '\n### SubHeading\n' + 'y'.repeat(80);
    const result = truncateText(text, 100);
    expect(result).not.toContain('SubHeading');
    expect(result).toContain('[truncated]');
  });

  it('snaps to --- separator boundary', () => {
    const text = 'x'.repeat(58) + '\n---\n' + 'y'.repeat(80);
    const result = truncateText(text, 100);
    expect(result).toContain('[truncated]');
  });
});

// ─── compactErrorText ───

describe('compactErrorText', () => {
  it('strips leading JSON code blocks', () => {
    const text = '```json\n{"error": "detail"}\n```\nActual error message';
    const result = compactErrorText(text);
    expect(result).not.toContain('```json');
    expect(result).toContain('Actual error message');
  });

  it('strips JSON blocks case-insensitively', () => {
    const text = '```JSON\n{"key": "val"}\n```\nRemaining text';
    const result = compactErrorText(text);
    expect(result).not.toContain('```JSON');
    expect(result).toContain('Remaining text');
  });

  it('collapses 3+ consecutive newlines', () => {
    const result = compactErrorText('line1\n\n\n\nline2');
    expect(result).not.toContain('\n\n\n');
    expect(result).toContain('line1');
    expect(result).toContain('line2');
  });

  it('uses default maxChars of 1200', () => {
    const text = 'e'.repeat(2000);
    const result = compactErrorText(text);
    // \n\n[truncated] suffix is 13 chars
    expect(result.length).toBeLessThanOrEqual(1200 + 13);
    // Lower bound: truncation should snap near the limit, not far below it
    expect(result.length).toBeGreaterThan(1100);
    expect(result).toContain('[truncated]');
  });

  it('respects explicit maxChars', () => {
    const text = 'e'.repeat(2000);
    const result = compactErrorText(text, 100);
    expect(result.length).toBeLessThanOrEqual(100 + 13);
    expect(result).toContain('[truncated]');
  });

  it('returns short text unchanged when no JSON block present', () => {
    expect(compactErrorText('simple error')).toBe('simple error');
  });

  it('only strips JSON block at the start of text (^ anchor)', () => {
    const text = 'prefix text\n```json\n{"a":1}\n```\nafter';
    const result = compactErrorText(text);
    // The regex uses ^ so mid-text blocks survive
    expect(result).toContain('prefix text');
  });
});

// ─── getFamilyLimit ───

describe('getFamilyLimit', () => {
  const ALL_FAMILIES: ResponseFamily[] = [
    'scalar',
    'mutationReceipt',
    'record',
    'list',
    'history',
    'document',
    'streamingConfig',
    'catalog',
  ];
  const ALL_DETAILS: DetailLevel[] = ['summary', 'standard', 'full'];

  it('returns a positive number for every family/detail combination', () => {
    for (const family of ALL_FAMILIES) {
      for (const detail of ALL_DETAILS) {
        const limit = getFamilyLimit(family, detail);
        expect(limit).toBeGreaterThan(0);
        expect(typeof limit).toBe('number');
      }
    }
  });

  it('summary <= standard <= full for every family', () => {
    for (const family of ALL_FAMILIES) {
      const summary = getFamilyLimit(family, 'summary');
      const standard = getFamilyLimit(family, 'standard');
      const full = getFamilyLimit(family, 'full');
      expect(summary).toBeLessThanOrEqual(standard);
      expect(standard).toBeLessThanOrEqual(full);
    }
  });

  it('returns exact values for scalar family', () => {
    expect(getFamilyLimit('scalar', 'summary')).toBe(800);
    expect(getFamilyLimit('scalar', 'standard')).toBe(1200);
    expect(getFamilyLimit('scalar', 'full')).toBe(1200);
  });

  it('returns exact values for list family', () => {
    expect(getFamilyLimit('list', 'summary')).toBe(2500);
    expect(getFamilyLimit('list', 'standard')).toBe(4500);
    expect(getFamilyLimit('list', 'full')).toBe(12000);
  });

  it('returns matching limits for history and list families', () => {
    for (const detail of ALL_DETAILS) {
      expect(getFamilyLimit('history', detail)).toBe(getFamilyLimit('list', detail));
    }
  });
});

// ─── toPlainText ───

describe('toPlainText', () => {
  it('extracts text from content array', () => {
    expect(toPlainText({ content: [{ type: 'text', text: 'hello' }] })).toBe('hello');
  });

  it('joins multiple text items with double newlines', () => {
    const response = {
      content: [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ],
    };
    expect(toPlainText(response)).toBe('first\n\nsecond');
  });

  it('filters out non-text content types', () => {
    const response = {
      content: [
        { type: 'text', text: 'keep' },
        { type: 'image', text: 'skip' },
      ],
    };
    expect(toPlainText(response)).toBe('keep');
  });

  it('treats items with undefined type as text', () => {
    expect(toPlainText({ content: [{ text: 'implicit' }] })).toBe('implicit');
  });

  it('uses empty string for items with undefined text', () => {
    const response = { content: [{ type: 'text' }] };
    expect(toPlainText(response)).toBe('');
  });

  it('falls back to stringified structuredContent', () => {
    const data = { key: 'value' };
    const response = { content: [], structuredContent: data };
    const result = toPlainText(response);
    expect(JSON.parse(result)).toEqual(data);
    // Verify pretty-print format (null, 2 indentation)
    expect(result).toBe(JSON.stringify(data, null, 2));
  });

  it('returns empty string when content is undefined', () => {
    expect(toPlainText({})).toBe('');
  });

  it('returns empty string when content is empty array', () => {
    expect(toPlainText({ content: [] })).toBe('');
  });
});

// ─── buildTextVariant ───

describe('buildTextVariant', () => {
  const longText = (n: number) => 'word '.repeat(n).trim();

  it('returns empty string for empty input', () => {
    expect(buildTextVariant('scalar', 'summary', '')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(buildTextVariant('scalar', 'summary', '   \n\n  ')).toBe('');
  });

  it('returns cleaned text unchanged when under limit for detail=full', () => {
    expect(buildTextVariant('scalar', 'full', 'short text')).toBe('short text');
  });

  it('truncates at full limit for detail=full without stripping examples', () => {
    const text = 'Content.\n\n**Example Code:**\n```typescript\ncode();\n```\n' + 'a'.repeat(2000);
    const result = buildTextVariant('scalar', 'full', text);
    // full detail should NOT strip example code
    expect(result).toContain('Example Code');
    expect(result).toContain('[truncated]');
  });

  // Test all families at summary detail
  it.each<ResponseFamily>([
    'scalar',
    'mutationReceipt',
    'record',
    'list',
    'history',
    'document',
    'streamingConfig',
    'catalog',
  ])('handles %s family at summary detail', (family) => {
    const text = longText(1000);
    const limit = getFamilyLimit(family, 'summary');
    const result = buildTextVariant(family, 'summary', text);
    // Result should be within limit + \n\n[truncated] suffix (13 chars)
    expect(result.length).toBeLessThanOrEqual(limit + 13);
  });

  // Test all families at standard detail
  it.each<ResponseFamily>([
    'scalar',
    'mutationReceipt',
    'record',
    'list',
    'history',
    'document',
    'streamingConfig',
    'catalog',
  ])('handles %s family at standard detail', (family) => {
    const text = longText(2000);
    const limit = getFamilyLimit(family, 'standard');
    const result = buildTextVariant(family, 'standard', text);
    expect(result.length).toBeLessThanOrEqual(limit + 15);
  });

  it('strips **Example Code:** marker for non-full detail', () => {
    const text = 'Main content.\n\n**Example Code:**\nconst x = 1;';
    const result = buildTextVariant('record', 'summary', text);
    expect(result).not.toContain('const x = 1');
  });

  it('strips **Example:** marker for non-full detail', () => {
    const text = 'Main content.\n\n**Example:**\nsome example';
    const result = buildTextVariant('record', 'summary', text);
    expect(result).not.toContain('some example');
  });

  it('strips ```typescript code block marker', () => {
    const text = 'Main content.\n\n```typescript\nconst y = 2;\n```';
    const result = buildTextVariant('record', 'summary', text);
    expect(result).not.toContain('const y = 2');
  });

  it('strips ```ts code block marker', () => {
    const text = 'Main content.\n\n```ts\nconst z = 3;\n```';
    const result = buildTextVariant('record', 'summary', text);
    expect(result).not.toContain('const z = 3');
  });

  it('strips ```javascript code block marker', () => {
    const text = 'Main content.\n\n```javascript\nlet a = 4;\n```';
    const result = buildTextVariant('record', 'summary', text);
    expect(result).not.toContain('let a = 4');
  });

  it('strips ```js code block marker', () => {
    const text = 'Main content.\n\n```js\nlet b = 5;\n```';
    const result = buildTextVariant('record', 'summary', text);
    expect(result).not.toContain('let b = 5');
  });

  it('uses summarizeDocument for document family', () => {
    const doc =
      '# Main Title\n\nIntro paragraph here.\n\n## Section A\n\nA content.\n\n## Section B\n\nB content.\n\n## Section C\n\nC content.';
    const result = buildTextVariant('document', 'summary', doc);
    // Document summarization extracts headings + intro
    expect(result).toContain('Main Title');
  });

  it('uses summarizeListLike for history family', () => {
    const items = Array.from(
      { length: 50 },
      (_, i) => `**Transaction ${i + 1}**\nDetails of tx ${i + 1}`,
    ).join('\n\n');
    const result = buildTextVariant('history', 'summary', items);
    const limit = getFamilyLimit('history', 'summary');
    expect(result.length).toBeLessThanOrEqual(limit + 15);
  });

  it('uses summarizeListLike for catalog family', () => {
    const items = Array.from(
      { length: 50 },
      (_, i) => `**Catalog Entry ${i + 1}**\nInfo ${i + 1}`,
    ).join('\n\n');
    const result = buildTextVariant('catalog', 'summary', items);
    const limit = getFamilyLimit('catalog', 'summary');
    expect(result.length).toBeLessThanOrEqual(limit + 15);
  });
});

// ─── estimateRenderedSize ───

describe('estimateRenderedSize', () => {
  it('returns length of plain text', () => {
    expect(estimateRenderedSize('hello')).toBe(5);
  });

  it('accounts for CRLF normalization', () => {
    // 'a\r\nb' -> 'a\nb' = 3 chars
    expect(estimateRenderedSize('a\r\nb')).toBe(3);
  });

  it('accounts for collapsed newlines', () => {
    // 'a\n\n\n\nb' -> 'a\n\nb' = 4 chars
    expect(estimateRenderedSize('a\n\n\n\nb')).toBe(4);
  });

  it('returns 0 for empty string', () => {
    expect(estimateRenderedSize('')).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(estimateRenderedSize('   ')).toBe(0);
  });
});

// ─── collectSectionHints ───

describe('collectSectionHints', () => {
  it('captures h1, h2, and h3 headings', () => {
    const text = '# H1\n\n## H2\n\n### H3';
    expect(collectSectionHints(text)).toEqual(['H1', 'H2', 'H3']);
  });

  it('ignores h4+ headings', () => {
    expect(collectSectionHints('#### H4\n##### H5\n###### H6')).toEqual([]);
  });

  it('returns empty array when no headings present', () => {
    expect(collectSectionHints('plain text without headings')).toEqual([]);
  });

  it('limits output to 12 headings', () => {
    const text = Array.from({ length: 20 }, (_, i) => `## Heading ${i + 1}`).join('\n\n');
    expect(collectSectionHints(text)).toHaveLength(12);
  });

  it('trims whitespace from heading text', () => {
    expect(collectSectionHints('##   Padded   ')).toEqual(['Padded']);
  });

  it('handles heading followed by content on the same line', () => {
    // \s+ in the regex matches across whitespace including newlines,
    // so '##   \n\n## Real' is a single match where \s+ = '   \n\n'
    const text = '## Overview\n\nSome body text';
    const hints = collectSectionHints(text);
    expect(hints).toEqual(['Overview']);
  });
});

// ─── applySectionSelection ───

describe('applySectionSelection', () => {
  it('returns full text when section is undefined', () => {
    expect(applySectionSelection('full document', undefined)).toBe('full document');
  });

  it('returns full text when section is empty string', () => {
    expect(applySectionSelection('full document', '')).toBe('full document');
  });

  it('extracts matching section content (positive path)', () => {
    const text = '# Overview\n\nGeneral info.\n\n## Billing\n\nBilling details here.\n\n## Support\n\nSupport info.';
    const result = applySectionSelection(text, 'Billing');
    expect(result).toContain('Billing');
    expect(result).toContain('Billing details here.');
    // Should not include the next same-level heading or its content
    expect(result).not.toContain('## Support');
    expect(result).not.toContain('Support info.');
  });

  it('returns not-found message with original text when section does not match', () => {
    const text = '# Title\n\nContent here';
    const result = applySectionSelection(text, 'nonexistent');
    expect(result).toContain('No section matching "nonexistent"');
    expect(result).toContain('Content here');
  });

  it('matches section keywords case-insensitively', () => {
    const text = '## Webhooks\n\nWebhook setup instructions.';
    const result = applySectionSelection(text, 'webhooks');
    expect(result).toContain('Webhook setup instructions.');
  });
});

// ─── applyItemSelection ───

describe('applyItemSelection', () => {
  it('returns full text when item is undefined', () => {
    expect(applyItemSelection('full list', undefined)).toBe('full list');
  });

  it('extracts item by --- separator (1-indexed)', () => {
    const text = '**Item A**\nDesc A\n---\n**Item B**\nDesc B\n---\n**Item C**\nDesc C';
    expect(applyItemSelection(text, 1)).toContain('Item A');
    expect(applyItemSelection(text, 2)).toContain('Item B');
    expect(applyItemSelection(text, 3)).toContain('Item C');
  });

  it('extracts item by bold marker after double newline', () => {
    const text = '**First entry**\nDetails 1\n\n**Second entry**\nDetails 2';
    expect(applyItemSelection(text, 1)).toContain('First entry');
    expect(applyItemSelection(text, 2)).toContain('Second entry');
  });

  it('extracts item by emoji after double newline', () => {
    const text = '🔵 Blue item\nBlue details\n\n🟢 Green item\nGreen details';
    expect(applyItemSelection(text, 1)).toContain('Blue item');
    expect(applyItemSelection(text, 2)).toContain('Green item');
  });

  it('returns not-found for out-of-range positive index', () => {
    const result = applyItemSelection('**Only one**\nContent', 5);
    expect(result).toContain('Item 5 was not found');
    expect(result).toContain('Only one');
  });

  it('returns not-found for item 0', () => {
    const result = applyItemSelection('**Item**\nContent', 0);
    expect(result).toContain('Item 0 was not found');
  });

  it('returns not-found for negative item', () => {
    const result = applyItemSelection('**Item**\nContent', -1);
    expect(result).toContain('Item -1 was not found');
  });
});

// ─── applyRangeSelection ───

describe('applyRangeSelection', () => {
  it('returns full text when range is undefined', () => {
    expect(applyRangeSelection('hello', undefined)).toBe('hello');
  });

  it('returns full text when range is empty string', () => {
    expect(applyRangeSelection('hello', '')).toBe('hello');
  });

  it('slices text by character range', () => {
    expect(applyRangeSelection('abcdefghij', '2:5')).toBe('cde');
  });

  it('handles range starting at 0', () => {
    expect(applyRangeSelection('abcdef', '0:3')).toBe('abc');
  });

  it('handles range exceeding text length gracefully', () => {
    // String.slice(0, 9999) on a 3-char string returns the full string
    expect(applyRangeSelection('abc', '0:9999')).toBe('abc');
  });

  it('returns error for non-numeric range format', () => {
    const result = applyRangeSelection('text', 'bad');
    expect(result).toContain('Invalid range "bad"');
    expect(result).toContain('Expected "start:end"');
  });

  it('returns error for floating-point range values', () => {
    const result = applyRangeSelection('text', '1.5:3.5');
    expect(result).toContain('Invalid range "1.5:3.5"');
  });

  it('returns error when start >= end', () => {
    const result = applyRangeSelection('text', '5:3');
    expect(result).toContain('Invalid range "5:3"');
    expect(result).toContain('start >= 0 and end > start');
  });

  it('returns error when start equals end', () => {
    const result = applyRangeSelection('text', '0:0');
    expect(result).toContain('Invalid range "0:0"');
  });

  it('returns error when start is negative', () => {
    const result = applyRangeSelection('text', '-1:5');
    expect(result).toContain('Invalid range');
  });
});

// ─── mcpText ───

describe('mcpText', () => {
  it('returns correct MCP text response shape', () => {
    expect(mcpText('hello')).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });

  it('does not set isError', () => {
    expect(mcpText('msg').isError).toBeUndefined();
  });

  it('handles empty string', () => {
    expect(mcpText('')).toEqual({ content: [{ type: 'text', text: '' }] });
  });

  it('includes _meta when provided', () => {
    expect(mcpText('msg', { foo: 'bar' })._meta).toEqual({ foo: 'bar' });
  });

  it('omits _meta when not provided', () => {
    expect(mcpText('msg')._meta).toBeUndefined();
  });
});

// ─── mcpErrorCompact ───

describe('mcpErrorCompact', () => {
  it('returns error response with isError true', () => {
    expect(mcpErrorCompact('oops')).toEqual({
      content: [{ type: 'text', text: 'oops' }],
      isError: true,
    });
  });

  it('omits _meta when not provided', () => {
    expect(mcpErrorCompact('err')._meta).toBeUndefined();
  });

  it('includes _meta when provided', () => {
    expect(mcpErrorCompact('err', { code: 42 })._meta).toEqual({ code: 42 });
  });
});

// ─── mcpResultHandle ───

describe('mcpResultHandle', () => {
  it('includes summary and resultId in text', () => {
    const text = mcpResultHandle('summary text', 'res-123', []).content[0].text;
    expect(text).toContain('summary text');
    expect(text).toContain('resultId: res-123');
  });

  it('includes expand line with multiple expansions', () => {
    const text = mcpResultHandle('s', 'r', ['standard', 'full']).content[0].text;
    expect(text).toContain('expand: standard, full');
  });

  it('includes expand line with single expansion', () => {
    const text = mcpResultHandle('s', 'r', ['full']).content[0].text;
    expect(text).toContain('expand: full');
  });

  it('omits expand line when no expansions', () => {
    const text = mcpResultHandle('s', 'r', []).content[0].text;
    expect(text).not.toContain('expand:');
  });

  it('includes _meta when provided', () => {
    expect(mcpResultHandle('s', 'r', [], { action: 'test' })._meta).toEqual({ action: 'test' });
  });

  it('omits _meta when not provided', () => {
    expect(mcpResultHandle('s', 'r', [])._meta).toBeUndefined();
  });
});
