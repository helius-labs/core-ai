import { describe, it, expect } from 'vitest';
import { buildSolanaPayUri, printSolanaPayQR } from '../src/lib/qr.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TEST_ADDRESS = '11111111111111111111111111111111';

// ─── buildSolanaPayUri ───

describe('buildSolanaPayUri', () => {
  it('returns plain solana: URI when no amount is provided', () => {
    const uri = buildSolanaPayUri(TEST_ADDRESS);
    expect(uri).toBe(`solana:${TEST_ADDRESS}`);
  });

  it('returns plain solana: URI when amount is undefined', () => {
    const uri = buildSolanaPayUri(TEST_ADDRESS, undefined);
    expect(uri).toBe(`solana:${TEST_ADDRESS}`);
  });

  it('returns plain solana: URI when amount is 0', () => {
    const uri = buildSolanaPayUri(TEST_ADDRESS, 0);
    expect(uri).toBe(`solana:${TEST_ADDRESS}`);
  });

  it('returns USDC Solana Pay URI with amount and spl-token when amount is positive', () => {
    const uri = buildSolanaPayUri(TEST_ADDRESS, 49);
    expect(uri).toBe(`solana:${TEST_ADDRESS}?amount=49&spl-token=${USDC_MINT}`);
  });

  it('handles decimal USDC amounts', () => {
    const uri = buildSolanaPayUri(TEST_ADDRESS, 1.5);
    expect(uri).toBe(`solana:${TEST_ADDRESS}?amount=1.5&spl-token=${USDC_MINT}`);
  });

  it('handles the basic plan amount ($1)', () => {
    const uri = buildSolanaPayUri(TEST_ADDRESS, 1);
    expect(uri).toBe(`solana:${TEST_ADDRESS}?amount=1&spl-token=${USDC_MINT}`);
  });

  it('handles large amounts (professional plan $999)', () => {
    const uri = buildSolanaPayUri(TEST_ADDRESS, 999);
    expect(uri).toBe(`solana:${TEST_ADDRESS}?amount=999&spl-token=${USDC_MINT}`);
  });
});

// ─── printSolanaPayQR ───

describe('printSolanaPayQR', () => {
  it('accepts a raw URL string and resolves without error', async () => {
    // printSolanaPayQR logs to console — we just verify it completes
    const consoleSpy = { log: console.log };
    const logs: string[] = [];
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      await printSolanaPayQR(`solana:${TEST_ADDRESS}`);
      // Should have logged at least one non-empty line (the QR output)
      expect(logs.some(line => line.length > 0)).toBe(true);
    } finally {
      console.log = consoleSpy.log;
    }
  });

  it('accepts a full Solana Pay URL with parameters', async () => {
    const consoleSpy = { log: console.log };
    const logs: string[] = [];
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      const url = `solana:${TEST_ADDRESS}?amount=49&spl-token=${USDC_MINT}`;
      await printSolanaPayQR(url);
      expect(logs.some(line => line.length > 0)).toBe(true);
    } finally {
      console.log = consoleSpy.log;
    }
  });
});
