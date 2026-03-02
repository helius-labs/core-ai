import { describe, it, expect } from 'vitest';
import {
  formatSol,
  formatAddress,
  formatTimestamp,
  formatTokenAmount,
  formatSolCompact,
  LAMPORTS_PER_SOL,
} from '../src/utils/formatters.js';

describe('LAMPORTS_PER_SOL', () => {
  it('equals 1_000_000_000', () => {
    expect(LAMPORTS_PER_SOL).toBe(1_000_000_000);
  });
});

describe('formatSol', () => {
  it('returns "0 SOL" for zero', () => {
    expect(formatSol(0)).toBe('0 SOL');
  });

  it('returns a value containing "SOL" for non-zero amounts', () => {
    expect(formatSol(LAMPORTS_PER_SOL)).toContain('SOL');
    expect(formatSol(500_000_000)).toContain('SOL');
  });

  it('converts 1 SOL correctly', () => {
    // 1 SOL = 1_000_000_000 lamports → should display as 1.xx SOL
    const result = formatSol(LAMPORTS_PER_SOL);
    expect(result).toContain('1');
    expect(result).toContain('SOL');
  });

  it('converts fractional SOL correctly', () => {
    // 0.001 SOL = 1_000_000 lamports
    const result = formatSol(1_000_000);
    expect(result).toContain('SOL');
    expect(result).not.toBe('0 SOL');
  });
});

describe('formatAddress', () => {
  it('returns the address unchanged', () => {
    const addr = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    expect(formatAddress(addr)).toBe(addr);
  });
});

describe('formatTimestamp', () => {
  it('converts a unix timestamp to an ISO string', () => {
    const result = formatTimestamp(1700000000);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('returns a string ending in Z (UTC)', () => {
    const result = formatTimestamp(1700000000);
    expect(result).toMatch(/Z$/);
  });

  it('round-trips correctly', () => {
    const ts = 1700000000;
    const iso = formatTimestamp(ts);
    expect(new Date(iso).getTime()).toBe(ts * 1000);
  });
});

describe('formatTokenAmount', () => {
  it('converts with 6 decimals (USDC-style)', () => {
    // 1_000_000 raw with 6 decimals = 1.0
    const result = formatTokenAmount(1_000_000, 6);
    expect(result).toContain('1');
  });

  it('converts with 9 decimals (SOL-style)', () => {
    // 1_000_000_000 raw with 9 decimals = 1.0
    const result = formatTokenAmount(1_000_000_000, 9);
    expect(result).toContain('1');
  });

  it('handles zero amount', () => {
    expect(formatTokenAmount(0, 6)).toBe('0');
  });
});

describe('formatSolCompact', () => {
  it('returns a string containing "SOL"', () => {
    expect(formatSolCompact(LAMPORTS_PER_SOL)).toContain('SOL');
  });

  it('handles zero', () => {
    expect(formatSolCompact(0)).toContain('SOL');
  });
});
