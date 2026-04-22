import { describe, it, expect } from 'vitest';
import { computeExactUsdc } from '../src/utils/pricing.js';

describe('computeExactUsdc', () => {
  // ─── No plan → undefined ───

  it('returns undefined when plan is undefined', () => {
    expect(computeExactUsdc()).toBeUndefined();
  });

  it('returns undefined when plan is empty string', () => {
    expect(computeExactUsdc('')).toBeUndefined();
  });

  // ─── Agent plan ($10 one-time, 1M starting credits) ───

  it('returns $10 for agent plan (period irrelevant)', () => {
    const result = computeExactUsdc('agent');
    expect(result).toEqual({ usdcAmount: 10, label: 'agent plan ($10)' });
  });

  it('returns $10 for agent plan (case insensitive)', () => {
    const result = computeExactUsdc('Agent');
    expect(result).toEqual({ usdcAmount: 10, label: 'agent plan ($10)' });
  });

  it('ignores period for agent plan', () => {
    expect(computeExactUsdc('agent', 'monthly')).toEqual({
      usdcAmount: 10,
      label: 'agent plan ($10)',
    });
    expect(computeExactUsdc('agent', 'yearly')).toEqual({
      usdcAmount: 10,
      label: 'agent plan ($10)',
    });
  });

  it('returns undefined for basic plan (removed from supported set)', () => {
    expect(computeExactUsdc('basic')).toBeUndefined();
  });

  // ─── Developer plan ───

  it('returns $49 for developer plan (monthly)', () => {
    const result = computeExactUsdc('developer', 'monthly');
    expect(result).toEqual({ usdcAmount: 49, label: 'Developer plan ($49)' });
  });

  it('returns $490 for developer plan (yearly)', () => {
    const result = computeExactUsdc('developer', 'yearly');
    expect(result).toEqual({ usdcAmount: 490, label: 'Developer plan ($490)' });
  });

  it('defaults to monthly pricing when period is omitted', () => {
    const result = computeExactUsdc('developer');
    expect(result).toEqual({ usdcAmount: 49, label: 'Developer plan ($49)' });
  });

  // ─── Business plan ───

  it('returns $499 for business plan (monthly)', () => {
    const result = computeExactUsdc('business', 'monthly');
    expect(result).toEqual({ usdcAmount: 499, label: 'Business plan ($499)' });
  });

  it('returns $4990 for business plan (yearly)', () => {
    const result = computeExactUsdc('business', 'yearly');
    expect(result).toEqual({ usdcAmount: 4990, label: 'Business plan ($4990)' });
  });

  // ─── Professional plan ───

  it('returns $999 for professional plan (monthly)', () => {
    const result = computeExactUsdc('professional', 'monthly');
    expect(result).toEqual({ usdcAmount: 999, label: 'Professional plan ($999)' });
  });

  it('returns $9990 for professional plan (yearly)', () => {
    const result = computeExactUsdc('professional', 'yearly');
    expect(result).toEqual({ usdcAmount: 9990, label: 'Professional plan ($9990)' });
  });

  // ─── Unknown plan ───

  it('returns undefined for an unknown plan name', () => {
    expect(computeExactUsdc('enterprise')).toBeUndefined();
  });

  it('returns undefined for a random string', () => {
    expect(computeExactUsdc('foobar')).toBeUndefined();
  });

  // ─── Case insensitivity for period ───

  it('handles uppercase period "Yearly"', () => {
    const result = computeExactUsdc('developer', 'Yearly');
    expect(result).toEqual({ usdcAmount: 490, label: 'Developer plan ($490)' });
  });

  it('handles uppercase period "MONTHLY"', () => {
    const result = computeExactUsdc('developer', 'MONTHLY');
    expect(result).toEqual({ usdcAmount: 49, label: 'Developer plan ($49)' });
  });
});
