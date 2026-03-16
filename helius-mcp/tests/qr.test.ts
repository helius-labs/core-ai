import { describe, it, expect } from 'vitest';
import { buildSolanaPayUri, generateSolanaPayQR } from '../src/utils/qr.js';

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

// ─── generateSolanaPayQR ───

describe('generateSolanaPayQR', () => {
  it('returns a non-empty string for a raw URL', async () => {
    const qr = await generateSolanaPayQR(`solana:${TEST_ADDRESS}`);
    expect(typeof qr).toBe('string');
    expect(qr.length).toBeGreaterThan(0);
  });

  it('returns a non-empty string for a full Solana Pay URL with parameters', async () => {
    const url = `solana:${TEST_ADDRESS}?amount=49&spl-token=${USDC_MINT}`;
    const qr = await generateSolanaPayQR(url);
    expect(typeof qr).toBe('string');
    expect(qr.length).toBeGreaterThan(0);
  });

  it('produces different QR output for different URLs', async () => {
    const qr1 = await generateSolanaPayQR(`solana:${TEST_ADDRESS}`);
    const qr2 = await generateSolanaPayQR(`solana:${TEST_ADDRESS}?amount=100&spl-token=${USDC_MINT}`);
    expect(qr1).not.toBe(qr2);
  });
});
