import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPayRenewal = vi.fn();
const mockPayPaymentLink = vi.fn();
const mockGetPaymentStatus = vi.fn();
const mockWalletSignup = vi.fn();

vi.mock("../lib/api.js", () => ({
  walletSignup: (...args: unknown[]) => mockWalletSignup(...args),
  getPaymentStatus: (...args: unknown[]) => mockGetPaymentStatus(...args),
  payPaymentLink: (...args: unknown[]) => mockPayPaymentLink(...args),
  payRenewal: (...args: unknown[]) => mockPayRenewal(...args),
}));

const mockSetJwt = vi.fn();
vi.mock("../lib/config.js", () => ({
  setJwt: (...args: unknown[]) => mockSetJwt(...args),
  SHARED_CONFIG_PATH: "/tmp/test-config.json",
}));

const mockKeypairExists = vi.fn();
vi.mock("./keygen.js", () => ({
  keypairExists: (...args: unknown[]) => mockKeypairExists(...args),
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
  getCurrentCommand: () => "pay",
}));

import { payCommand } from "./pay.js";

interface CapturedJson {
  ok: boolean;
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

const renewalLink = {
  kind: "payment_required" as const,
  paymentIntentId: "pi_renew",
  amountCents: 4900,
  destinationWallet: "Treasury",
  memo: "pi_renew",
  expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
  paymentUrl: "https://dashboard.helius.dev/pay/pi_renew",
  solanaPayUrl: "solana:...",
  planName: "Subscription renewal",
};

describe("pay command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKeypairExists.mockReturnValue(true);
    mockLoadKeypair.mockResolvedValue({ secretKey: new Uint8Array(64) });
    mockGetAddress.mockResolvedValue("Wallet111");
    mockSignAuthMessage.mockResolvedValue({ message: "m", signature: "s" });
    mockWalletSignup.mockResolvedValue({ token: "jwt-1", refId: "r", newUser: false });
    mockCheckSolBalance.mockResolvedValue(2_000_000n);
    mockCheckUsdcBalance.mockResolvedValue(99_900_000_000n);
  });

  afterEach(() => vi.restoreAllMocks());

  it("default link mode prints the renewal payment URL", async () => {
    mockPayRenewal.mockResolvedValue({ kind: "payment_required", paymentLink: renewalLink });
    const { json } = await captureStdout(() => payCommand("pi_renew", baseOpts));
    expect(json?.data.status).toBe("PAYMENT_REQUIRED");
    expect(json?.data.paymentUrl).toBe(renewalLink.paymentUrl);
    expect(json?.data.amountCents).toBe(4900);
    expect(mockPayPaymentLink).not.toHaveBeenCalled();
  });

  it("--pay sends USDC then polls for completion", async () => {
    mockPayRenewal.mockResolvedValue({ kind: "payment_required", paymentLink: renewalLink });
    mockPayPaymentLink.mockResolvedValue({ txSignature: "tx-renew" });
    mockGetPaymentStatus.mockResolvedValue({
      status: "completed",
      phase: "complete",
      subscriptionActive: true,
      readyToRedirect: true,
      message: "ok",
    });

    const { json } = await captureStdout(() =>
      payCommand("pi_renew", { ...baseOpts, pay: true } as any),
    );
    expect(json?.data.status).toBe("SUCCESS");
    expect(json?.data.txSignature).toBe("tx-renew");
    expect(mockPayPaymentLink).toHaveBeenCalledTimes(1);
  });

  it("--resume polls existing intent and surfaces SUCCESS", async () => {
    mockGetPaymentStatus.mockResolvedValue({
      status: "completed",
      phase: "complete",
      subscriptionActive: true,
      readyToRedirect: true,
      message: "ok",
    });

    const { json } = await captureStdout(() =>
      payCommand("pi_renew", { ...baseOpts, resume: true } as any),
    );
    expect(json?.data.status).toBe("SUCCESS");
    expect(mockPayPaymentLink).not.toHaveBeenCalled();
  });

  it("--resume returns FAILED when backend reports failed", async () => {
    mockGetPaymentStatus.mockResolvedValue({
      status: "failed",
      phase: "failed",
      subscriptionActive: false,
      readyToRedirect: false,
      message: "boom",
    });
    const { json } = await captureStdout(() =>
      payCommand("pi_renew", { ...baseOpts, resume: true } as any),
    );
    expect(json?.data.status).toBe("FAILED");
  });
});
