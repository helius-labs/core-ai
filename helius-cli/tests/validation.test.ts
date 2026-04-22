import { describe, it, expect } from "vitest";
import {
  canonicalizeCreditsTier,
  validateCreditsTier,
  validateQty,
  validateSignupPlan,
} from "../src/lib/validation.js";

describe("canonicalizeCreditsTier", () => {
  it("returns canonical form for uppercase input", () => {
    expect(canonicalizeCreditsTier("10_USDC")).toBe("10_USDC");
  });

  it("normalizes lowercase input to canonical form", () => {
    expect(canonicalizeCreditsTier("10_usdc")).toBe("10_USDC");
  });

  it("normalizes mixed-case input to canonical form", () => {
    expect(canonicalizeCreditsTier("10_UsDc")).toBe("10_USDC");
  });

  it("accepts legacy and future bare suffixes (SDK/backend may still honor them)", () => {
    // The CLI advertises only `10_USDC` but the SDK's backend accepts any
    // key in stripe.prepaidCreditsPlans. Power users can pass these
    // directly without waiting for a CLI release.
    expect(canonicalizeCreditsTier("4_USDC")).toBe("4_USDC");
    expect(canonicalizeCreditsTier("25_usdc")).toBe("25_USDC");
    expect(canonicalizeCreditsTier("100_USDC")).toBe("100_USDC");
  });

  it("strips the `prepaid_credits_` prefix so the SDK's template doesn't double it", () => {
    expect(canonicalizeCreditsTier("prepaid_credits_10_USDC")).toBe("10_USDC");
    expect(canonicalizeCreditsTier("PREPAID_CREDITS_25_usdc")).toBe("25_USDC");
  });

  it("returns null for malformed inputs", () => {
    expect(canonicalizeCreditsTier("usdc")).toBeNull();
    expect(canonicalizeCreditsTier("10usdc")).toBeNull();
    expect(canonicalizeCreditsTier("_USDC")).toBeNull();
    expect(canonicalizeCreditsTier("10_USDT")).toBeNull();
    expect(canonicalizeCreditsTier("prepaid_credits_USDC")).toBeNull();
  });
});

describe("validateCreditsTier", () => {
  it("accepts the canonical 10_USDC tier", () => {
    expect(validateCreditsTier("10_USDC")).toBeNull();
  });

  it("accepts tiers case-insensitively (regression: validator used to lowercase input against an uppercase set)", () => {
    expect(validateCreditsTier("10_usdc")).toBeNull();
    expect(validateCreditsTier("10_UsDc")).toBeNull();
  });

  it("accepts raw prepaid_credits_* keys as a future-proof escape hatch", () => {
    expect(validateCreditsTier("prepaid_credits_10_USDC")).toBeNull();
    expect(validateCreditsTier("prepaid_credits_25_USDC")).toBeNull();
  });

  it("accepts bare suffixes that are not advertised (SDK may still route them)", () => {
    // Regression for the plan's 'future tiers don't need a CLI patch' promise.
    expect(validateCreditsTier("4_USDC")).toBeNull();
    expect(validateCreditsTier("25_USDC")).toBeNull();
  });

  it("rejects malformed tiers with the advertised list in the error", () => {
    const err = validateCreditsTier("10_USDT");
    expect(err).toContain("Unknown credits tier: 10_USDT");
    expect(err).toContain("10_USDC");
    expect(err).toContain("prepaid_credits_");
  });
});

describe("validateQty", () => {
  it("accepts qty in [1, 100]", () => {
    expect(validateQty(1)).toBeNull();
    expect(validateQty(50)).toBeNull();
    expect(validateQty(100)).toBeNull();
  });

  it("rejects qty below 1", () => {
    expect(validateQty(0)).toContain("Invalid qty");
    expect(validateQty(-1)).toContain("Invalid qty");
  });

  it("rejects qty above 100", () => {
    expect(validateQty(101)).toContain("Invalid qty");
  });

  it("rejects non-integer qty", () => {
    expect(validateQty(1.5)).toContain("Invalid qty");
    expect(validateQty(NaN)).toContain("Invalid qty");
  });
});

describe("validateSignupPlan", () => {
  it("accepts agent plan", () => {
    expect(validateSignupPlan("agent")).toBeNull();
  });

  it("rejects basic (removed in this release)", () => {
    const err = validateSignupPlan("basic");
    expect(err).toContain("Unknown plan: basic");
  });
});
