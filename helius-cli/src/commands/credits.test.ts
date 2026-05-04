import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPurchaseCredits = vi.fn();
const mockPayPaymentLink = vi.fn();
const mockGetPaymentStatus = vi.fn();
const mockGetPaymentIntent = vi.fn();
const mockListProjects = vi.fn();
const mockWalletSignup = vi.fn();

vi.mock("../lib/api.js", () => ({
  walletSignup: (...args: unknown[]) => mockWalletSignup(...args),
  listProjects: (...args: unknown[]) => mockListProjects(...args),
  getPaymentStatus: (...args: unknown[]) => mockGetPaymentStatus(...args),
  getPaymentIntent: (...args: unknown[]) => mockGetPaymentIntent(...args),
  payPaymentLink: (...args: unknown[]) => mockPayPaymentLink(...args),
  purchaseCredits: (...args: unknown[]) => mockPurchaseCredits(...args),
}));

const mockSetJwt = vi.fn();
const mockGetPendingCredits = vi.fn();
const mockSetPendingCredits = vi.fn();
const mockUpdatePendingCredits = vi.fn();
const mockClearPendingCredits = vi.fn();

vi.mock("../lib/config.js", () => ({
  setJwt: (...args: unknown[]) => mockSetJwt(...args),
  getPendingCredits: () => mockGetPendingCredits(),
  setPendingCredits: (...args: unknown[]) => mockSetPendingCredits(...args),
  updatePendingCredits: (...args: unknown[]) => mockUpdatePendingCredits(...args),
  clearPendingCredits: () => mockClearPendingCredits(),
  SHARED_CONFIG_PATH: "/tmp/test-config.json",
}));

const mockKeypairExists = vi.fn();
vi.mock("./keygen.js", () => ({
  keypairExists: (...args: unknown[]) => mockKeypairExists(...args),
  getDefaultKeypairPath: () => "/tmp/keypair.json",
}));

const mockLoadKeypair = vi.fn();
const mockGetAddress = vi.fn();
const mockSignAuthMessage = vi.fn();
vi.mock("../lib/wallet.js", () => ({
  loadKeypairFromFile: (...args: unknown[]) => mockLoadKeypair(...args),
  getAddress: (...args: unknown[]) => mockGetAddress(...args),
  signAuthMessage: (...args: unknown[]) => mockSignAuthMessage(...args),
}));

const mockCheckSolBalance = vi.fn();
const mockCheckUsdcBalance = vi.fn();
vi.mock("../lib/payment.js", () => ({
  checkSolBalance: (...args: unknown[]) => mockCheckSolBalance(...args),
  checkUsdcBalance: (...args: unknown[]) => mockCheckUsdcBalance(...args),
}));

vi.mock("../lib/feedback.js", () => ({
  sendCommandEvent: vi.fn(),
  getCurrentCommand: () => "credits",
}));

import { creditsCommand } from "./credits.js";

interface CapturedJson {
  ok: boolean;
  v?: number;
  data?: any;
  error?: any;
}

function captureStdout(fn: () => Promise<void>) {
  const chunks: string[] = [];
  let exitCode: number | null = null;

  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    chunks.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n");
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: any) => {
    exitCode = typeof code === "number" ? code : 0;
    throw new Error("__test_exit__");
  }) as never);

  return fn()
    .catch((e) => {
      if (e instanceof Error && e.message === "__test_exit__") return;
      throw e;
    })
    .finally(() => {
      logSpy.mockRestore();
      errSpy.mockRestore();
      exitSpy.mockRestore();
    })
    .then(() => {
      const raw = chunks.join("");
      const trimmed = raw.trim();
      let json: CapturedJson | null = null;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && "ok" in parsed) json = parsed;
      } catch {
        /* ignore */
      }
      return { json, raw, exitCode };
    });
}

const baseOpts = {
  keypair: "/tmp/keypair.json",
  json: true,
};

const samplePending = {
  paymentIntentId: "pi_credits",
  paymentUrl: "https://dashboard.helius.dev/pay/pi_credits",
  planName: "Prepaid credits (1 × 1M)",
  amountCents: 1000,
  destinationWallet: "Treasury",
  solanaPayUrl: "solana:Treasury?amount=10",
  memo: "pi_credits",
  expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
  jwt: "jwt-1",
  projectId: "proj-1",
  qty: 1,
  createdAt: new Date().toISOString(),
};

describe("credits command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKeypairExists.mockReturnValue(true);
    mockLoadKeypair.mockResolvedValue({ secretKey: new Uint8Array(64) });
    mockGetAddress.mockResolvedValue("Wallet111");
    mockSignAuthMessage.mockResolvedValue({ message: "m", signature: "s" });
    mockWalletSignup.mockResolvedValue({ token: "jwt-1", refId: "r", newUser: false });
    mockListProjects.mockResolvedValue([{ id: "proj-1" }]);
    mockCheckSolBalance.mockResolvedValue(2_000_000n);
    mockCheckUsdcBalance.mockResolvedValue(99_900_000_000n);
  });

  afterEach(() => vi.restoreAllMocks());

  it("PAYMENT_REQUIRED on fresh credits purchase", async () => {
    mockGetPendingCredits.mockReturnValue(undefined);
    mockPurchaseCredits.mockResolvedValue({
      kind: "payment_required",
      paymentLink: {
        kind: "payment_required",
        paymentIntentId: samplePending.paymentIntentId,
        amountCents: samplePending.amountCents,
        destinationWallet: samplePending.destinationWallet,
        memo: samplePending.memo,
        expiresAt: samplePending.expiresAt,
        paymentUrl: samplePending.paymentUrl,
        solanaPayUrl: samplePending.solanaPayUrl,
        planName: samplePending.planName,
      },
    });

    const { json } = await captureStdout(() => creditsCommand({ ...baseOpts, qty: "1" } as any));
    expect(json?.data.status).toBe("PAYMENT_REQUIRED");
    expect(json?.data.qty).toBe(1);
    expect(json?.data.destinationWallet).toBe("Treasury");
    expect(mockSetPendingCredits).toHaveBeenCalledTimes(1);
  });

  it("rejects --qty 0", async () => {
    mockGetPendingCredits.mockReturnValue(undefined);
    const { json } = await captureStdout(() => creditsCommand({ ...baseOpts, qty: "0" } as any));
    expect(json?.ok).toBe(false);
    expect(mockPurchaseCredits).not.toHaveBeenCalled();
  });

  it("--resume MISSING_PENDING_CREDITS when no stored intent", async () => {
    mockGetPendingCredits.mockReturnValue(undefined);
    const { json } = await captureStdout(() => creditsCommand({ ...baseOpts, resume: true } as any));
    expect(json?.data.status).toBe("MISSING_PENDING_CREDITS");
    expect(mockLoadKeypair).not.toHaveBeenCalled();
  });

  it("--resume SUCCESS when activation is ready", async () => {
    mockGetPendingCredits.mockReturnValue({ ...samplePending, txSignature: "tx-sent" });
    mockGetPaymentStatus.mockResolvedValue({
      status: "completed",
      phase: "complete",
      subscriptionActive: true,
      readyToRedirect: true,
      message: "ok",
    });
    const { json } = await captureStdout(() => creditsCommand({ ...baseOpts, resume: true } as any));
    expect(json?.data.status).toBe("SUCCESS");
    expect(json?.data.qty).toBe(1);
    expect(mockClearPendingCredits).toHaveBeenCalled();
  });

  it("--resume SUCCESS without stored txSignature backfills it from getPaymentIntent", async () => {
    mockGetPendingCredits.mockReturnValue({ ...samplePending });
    mockGetPaymentStatus.mockResolvedValue({
      status: "completed",
      phase: "complete",
      subscriptionActive: true,
      readyToRedirect: true,
      message: "ok",
    });
    mockGetPaymentIntent.mockResolvedValue({ txSignature: "tx-from-intent" });
    const { json } = await captureStdout(() => creditsCommand({ ...baseOpts, resume: true } as any));
    expect(json?.data.status).toBe("SUCCESS");
    expect(json?.data.txSignature).toBe("tx-from-intent");
    expect(mockGetPaymentIntent).toHaveBeenCalledWith(samplePending.jwt, samplePending.paymentIntentId);
    expect(mockClearPendingCredits).toHaveBeenCalled();
  });

  it("--pay reuses stored pendingCredits and does NOT re-send when txSignature exists", async () => {
    mockGetPendingCredits.mockReturnValue({ ...samplePending, txSignature: "tx-old" });
    mockGetPaymentStatus.mockResolvedValue({
      status: "completed",
      phase: "complete",
      subscriptionActive: true,
      readyToRedirect: true,
      message: "ok",
    });
    await captureStdout(() => creditsCommand({ ...baseOpts, pay: true } as any));
    expect(mockPayPaymentLink).not.toHaveBeenCalled();
    expect(mockClearPendingCredits).toHaveBeenCalled();
  });
});
