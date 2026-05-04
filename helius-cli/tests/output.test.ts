import { describe, it, expect } from "vitest";
import {
  classifyError,
  ExitCode,
  getExitCode,
  CLI_GUIDANCE,
  jsonReplacer,
} from "../src/lib/output.js";

describe("classifyError — Tier 2 (status-in-message)", () => {
  it("classifies Helius HTTP 429 as RATE_LIMITED + retryable", () => {
    const r = classifyError(new Error("Helius HTTP 429: Too many requests"));
    expect(r).toEqual({
      exitCode: ExitCode.RATE_LIMITED,
      errorCode: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("classifies Helius HTTP 401 as INVALID_API_KEY", () => {
    const r = classifyError(new Error("Helius HTTP 401: unauthorized"));
    expect(r.errorCode).toBe("INVALID_API_KEY");
    expect(r.exitCode).toBe(ExitCode.INVALID_API_KEY);
    expect(r.retryable).toBe(false);
  });

  it("classifies Helius HTTP 503 as SERVER_ERROR + retryable", () => {
    const r = classifyError(new Error("Helius HTTP 503: bad gateway"));
    expect(r.errorCode).toBe("SERVER_ERROR");
    expect(r.retryable).toBe(true);
  });

  it("classifies webhook HTTP 404 as NOT_FOUND", () => {
    const r = classifyError(new Error("HTTP error! status: 404 - missing"));
    expect(r.errorCode).toBe("NOT_FOUND");
    expect(r.retryable).toBe(false);
  });
});

describe("classifyError — Tier 3 (keyword matching)", () => {
  it("classifies INSUFFICIENT_SOL", () => {
    expect(classifyError(new Error("Insufficient SOL to pay fees")).errorCode)
      .toBe("INSUFFICIENT_SOL");
  });

  it("classifies INSUFFICIENT_USDC", () => {
    expect(classifyError(new Error("insufficient usdc balance")).errorCode)
      .toBe("INSUFFICIENT_USDC");
  });

  it("classifies NO_API_KEY when message contains 'No API key found'", () => {
    expect(classifyError(new Error("No API key found in config")).errorCode)
      .toBe("NO_API_KEY");
  });

  it("classifies invalid base58 address as INVALID_ADDRESS", () => {
    expect(classifyError(new Error("Invalid base58 public key")).errorCode)
      .toBe("INVALID_ADDRESS");
  });

  it("classifies ECONNREFUSED as NETWORK_ERROR + retryable", () => {
    const r = classifyError(new Error("connect ECONNREFUSED 127.0.0.1:443"));
    expect(r.errorCode).toBe("NETWORK_ERROR");
    expect(r.retryable).toBe(true);
  });

  it("classifies SyntaxError as INVALID_INPUT", () => {
    expect(classifyError(new SyntaxError("Cannot convert abc to a BigInt")).errorCode)
      .toBe("INVALID_INPUT");
  });

  it("falls through to SDK_ERROR when no pattern matches", () => {
    const r = classifyError(new Error("something unexpected"));
    expect(r.errorCode).toBe("SDK_ERROR");
    expect(r.retryable).toBe(false);
  });
});

describe("getExitCode — round-trip mapping", () => {
  it("maps every classifyError errorCode to a non-default ExitCode", () => {
    const codes = [
      "RATE_LIMITED",
      "SERVER_ERROR",
      "NETWORK_ERROR",
      "INVALID_API_KEY",
      "NOT_FOUND",
      "INVALID_INPUT",
      "INVALID_ADDRESS",
      "INSUFFICIENT_SOL",
      "INSUFFICIENT_USDC",
      "PAYMENT_FAILED",
      "NO_API_KEY",
      "SDK_ERROR",
    ];
    for (const code of codes) {
      const exit = getExitCode(code);
      // Each known code should map into the documented 50-59 / 20-29 ranges, never the
      // generic GENERAL_ERROR fallback.
      expect(exit, `${code} → ${exit}`).not.toBe(ExitCode.GENERAL_ERROR);
    }
  });

  it("falls back to GENERAL_ERROR for unknown codes", () => {
    expect(getExitCode("NEVER_DEFINED")).toBe(ExitCode.GENERAL_ERROR);
  });
});

describe("CLI_GUIDANCE — coverage", () => {
  it("provides guidance for every non-transient error code", () => {
    // PR #107 contract: suggestion always emitted in JSON error envelope.
    // Every code that classifyError can produce should have user-facing guidance.
    const codes = [
      "INVALID_API_KEY",
      "RATE_LIMITED",
      "NO_API_KEY",
      "NOT_FOUND",
      "SERVER_ERROR",
      "NETWORK_ERROR",
      "INSUFFICIENT_SOL",
      "INSUFFICIENT_USDC",
      "PAYMENT_FAILED",
      "NOT_LOGGED_IN",
      "KEYPAIR_NOT_FOUND",
      "NO_PROJECTS",
      "MULTIPLE_PROJECTS",
      "PROJECT_NOT_FOUND",
      "NO_API_KEYS",
      "INVALID_INPUT",
    ];
    for (const code of codes) {
      expect(CLI_GUIDANCE[code], `${code} missing guidance`).toBeTruthy();
    }
  });
});

describe("jsonReplacer — bigint handling", () => {
  it("serializes bigints to numbers (lamports come back as bigint from web3.js)", () => {
    const out = JSON.stringify({ lamports: 1234567890n }, jsonReplacer);
    expect(JSON.parse(out)).toEqual({ lamports: 1234567890 });
  });

  it("passes other values through unchanged", () => {
    const out = JSON.stringify({ a: 1, b: "x", c: null }, jsonReplacer);
    expect(JSON.parse(out)).toEqual({ a: 1, b: "x", c: null });
  });
});
