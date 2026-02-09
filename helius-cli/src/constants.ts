import type { Address } from "@solana/kit";

export const VERSION = "1.0.0";

export const API_URL = "https://dev-api.helius.xyz/v0";

// User agent for API requests
export const CLI_USER_AGENT = `helius-cli/${VERSION}`;

// Treasury wallet that receives the 1 USDC payment
export const TREASURY = "CEs84tEowsXpH8u4VBf8rJSVgSRypFMfXw9CpGRtQgb6" as Address;

// USDC mint addresses per network
export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;
export const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" as Address;

// Default to mainnet USDC mint
export const USDC_MINT = USDC_MINT_MAINNET;

export const PAYMENT_AMOUNT = 1_000_000n; // 1 USDC (6 decimals)
