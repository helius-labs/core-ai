import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUpgradePlan = vi.fn();
const mockPayPaymentLink = vi.fn();
const mockGetPaymentStatus = vi.fn();
const mockListProjects = vi.fn();
const mockWalletSignup = vi.fn();

vi.mock("../lib/api.js", () => ({
  walletSignup: (...args: unknown[]) => mockWalletSignup(...args),
  listProjects: (...args: unknown[]) => mockListProjects(...args),
  getPaymentStatus: (...args: unknown[]) => mockGetPaymentStatus(...args),
  payPaymentLink: (...args: unknown[]) => mockPayPaymentLink(...args),
  upgradePlan: (...args: unknown[]) => mockUpgradePlan(...args),
}));

const mockSetJwt = vi.fn();
const mockGetPendingUpgrade = vi.fn();
const mockSetPendingUpgrade = vi.fn();
const mockUpdatePendingUpgrade = vi.fn();
const mockClearPendingUpgrade = vi.fn();

vi.mock("../lib/config.js", () => ({
  setJwt: (...args: unknown[]) => mockSetJwt(...args),
  getPendingUpgrade: () => mockGetPendingUpgrade(),
  setPendingUpgrade: (...args: unknown[]) => mockSetPendingUpgrade(...args),
  updatePendingUpgrade: (...args: unknown[]) => mockUpdatePendingUpgrade(...args),
  clearPendingUpgrade: () => mockClearPendingUpgrade(),
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
  sendDiscoveryEvent: vi.fn(),
  sendCommandEvent: vi.fn(),
  getCurrentCommand: () => "upgrade",
}));

import { upgradeCommand } from "./upgrade.js";

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
        let depth = 0;
        let start = -1;
        for (let i = 0; i < trimmed.length; i++) {
          if (trimmed[i] === "{") {
            if (depth === 0) start = i;
            depth++;
          } else if (trimmed[i] === "}") {
            depth--;
            if (depth === 0 && start >= 0) {
              try {
                const parsed = JSON.parse(trimmed.slice(start, i + 1));
                if (parsed && "ok" in parsed) {
                  json = parsed;
                  break;
                }
              } catch {
                /* ignore */
              }
              start = -1;
            }
          }
        }
      }
      return { json, raw, exitCode };
    });
}

const baseOpts = {
  keypair: "/tmp/keypair.json",
  json: true,
  plan: "developer",
};

const samplePending = {
  paymentIntentId: "pi_up",
  paymentUrl: "https://dashboard.helius.dev/pay/pi_up",
  planName: "Developer (Monthly)",
  amountCents: 4900,
  destinationWallet: "Treasury",
  solanaPayUrl: "solana:Treasury?amount=49",
  memo: "pi_up",
  expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
  jwt: "jwt-1",
  projectId: "proj-1",
  targetPlan: "developer",
  period: "monthly",
  createdAt: new Date().toISOString(),
};

describe("upgrade command", () => {
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

  it("PAYMENT_REQUIRED on fresh upgrade", async () => {
    mockGetPendingUpgrade.mockReturnValue(undefined);
    mockUpgradePlan.mockResolvedValue({
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

    const { json } = await captureStdout(() => upgradeCommand({ ...baseOpts }));
    expect(json?.data.status).toBe("PAYMENT_REQUIRED");
    expect(json?.data.targetPlan).toBe("developer");
    expect(json?.data.destinationWallet).toBe("Treasury");
    expect(mockSetPendingUpgrade).toHaveBeenCalledTimes(1);
  });

  it("PAYMENT_REQUIRED with reused:true on second invocation", async () => {
    mockGetPendingUpgrade.mockReturnValue(samplePending);
    const { json } = await captureStdout(() => upgradeCommand({ ...baseOpts, plan: undefined } as any));
    expect(json?.data.status).toBe("PAYMENT_REQUIRED");
    expect(json?.data.reused).toBe(true);
    expect(mockUpgradePlan).not.toHaveBeenCalled();
    expect(mockSetPendingUpgrade).not.toHaveBeenCalled();
  });

  it("--restart clears stored pendingUpgrade", async () => {
    let cleared = false;
    mockClearPendingUpgrade.mockImplementation(() => {
      cleared = true;
    });
    mockGetPendingUpgrade.mockImplementation(() => (cleared ? undefined : samplePending));
    mockUpgradePlan.mockResolvedValue({
      kind: "payment_required",
      paymentLink: {
        ...samplePending,
        kind: "payment_required" as const,
        paymentIntentId: "pi_new",
      },
    });
    await captureStdout(() => upgradeCommand({ ...baseOpts, restart: true } as any));
    expect(mockClearPendingUpgrade).toHaveBeenCalled();
    expect(mockUpgradePlan).toHaveBeenCalledTimes(1);
  });

  it("--pay reuses stored pendingUpgrade and skips USDC send when txSignature exists", async () => {
    mockGetPendingUpgrade.mockReturnValue({ ...samplePending, txSignature: "tx-old" });
    mockGetPaymentStatus.mockResolvedValue({
      status: "completed",
      phase: "complete",
      subscriptionActive: true,
      readyToRedirect: true,
      message: "ok",
    });
    await captureStdout(() => upgradeCommand({ ...baseOpts, plan: undefined, pay: true } as any));
    expect(mockPayPaymentLink).not.toHaveBeenCalled();
    expect(mockClearPendingUpgrade).toHaveBeenCalled();
  });

  it("--resume returns SUCCESS when activation is ready", async () => {
    mockGetPendingUpgrade.mockReturnValue({ ...samplePending, txSignature: "tx-sent" });
    mockGetPaymentStatus.mockResolvedValue({
      status: "completed",
      phase: "complete",
      subscriptionActive: true,
      readyToRedirect: true,
      message: "ok",
    });
    const { json } = await captureStdout(() =>
      upgradeCommand({ ...baseOpts, plan: undefined, resume: true } as any),
    );
    expect(json?.data.status).toBe("SUCCESS");
    expect(json?.data.txSignature).toBe("tx-sent");
    expect(mockClearPendingUpgrade).toHaveBeenCalled();
  });

  it("--resume returns MISSING_PENDING_UPGRADE when no stored intent", async () => {
    mockGetPendingUpgrade.mockReturnValue(undefined);
    const { json } = await captureStdout(() =>
      upgradeCommand({ ...baseOpts, plan: undefined, resume: true } as any),
    );
    expect(json?.data.status).toBe("MISSING_PENDING_UPGRADE");
    expect(mockLoadKeypair).not.toHaveBeenCalled();
  });

  it("--resume returns FAILED when backend reports failed", async () => {
    mockGetPendingUpgrade.mockReturnValue(samplePending);
    mockGetPaymentStatus.mockResolvedValue({
      status: "failed",
      phase: "failed",
      subscriptionActive: false,
      readyToRedirect: false,
      message: "boom",
    });
    const { json } = await captureStdout(() =>
      upgradeCommand({ ...baseOpts, plan: undefined, resume: true } as any),
    );
    expect(json?.data.status).toBe("FAILED");
    expect(mockClearPendingUpgrade).toHaveBeenCalled();
  });
});
