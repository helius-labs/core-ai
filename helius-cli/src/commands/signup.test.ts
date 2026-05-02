import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocked dependencies ──────────────────────────────────────────────────

const mockSignup = vi.fn();
const mockPayPaymentLink = vi.fn();
const mockGetPaymentStatus = vi.fn();
const mockListProjects = vi.fn();
const mockGetProject = vi.fn();
const mockCreateApiKey = vi.fn();

vi.mock("../lib/api.js", () => ({
  signup: (...args: unknown[]) => mockSignup(...args),
  payPaymentLink: (...args: unknown[]) => mockPayPaymentLink(...args),
  getPaymentStatus: (...args: unknown[]) => mockGetPaymentStatus(...args),
  listProjects: (...args: unknown[]) => mockListProjects(...args),
  getProject: (...args: unknown[]) => mockGetProject(...args),
  createApiKey: (...args: unknown[]) => mockCreateApiKey(...args),
}));

const mockSetJwt = vi.fn();
const mockSetApiKey = vi.fn();
const mockSetSharedApiKey = vi.fn();
const mockSetProjectId = vi.fn();
const mockGetPendingSignup = vi.fn();
const mockSetPendingSignup = vi.fn();
const mockUpdatePendingSignup = vi.fn();
const mockClearPendingSignup = vi.fn();

vi.mock("../lib/config.js", () => ({
  setJwt: (...args: unknown[]) => mockSetJwt(...args),
  setApiKey: (...args: unknown[]) => mockSetApiKey(...args),
  setSharedApiKey: (...args: unknown[]) => mockSetSharedApiKey(...args),
  setProjectId: (...args: unknown[]) => mockSetProjectId(...args),
  getPendingSignup: () => mockGetPendingSignup(),
  setPendingSignup: (...args: unknown[]) => mockSetPendingSignup(...args),
  updatePendingSignup: (...args: unknown[]) => mockUpdatePendingSignup(...args),
  clearPendingSignup: () => mockClearPendingSignup(),
  SHARED_CONFIG_PATH: "/tmp/test-config.json",
}));

const mockKeypairExists = vi.fn();
const mockKeygenCommand = vi.fn();
vi.mock("./keygen.js", () => ({
  keypairExists: (...args: unknown[]) => mockKeypairExists(...args),
  keygenCommand: (...args: unknown[]) => mockKeygenCommand(...args),
}));

const mockLoadKeypair = vi.fn();
const mockGetAddress = vi.fn();
vi.mock("../lib/wallet.js", () => ({
  loadKeypairFromFile: (...args: unknown[]) => mockLoadKeypair(...args),
  getAddress: (...args: unknown[]) => mockGetAddress(...args),
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
  getCurrentCommand: () => "signup",
}));

// ── Imports under test (must come AFTER vi.mock calls) ──

import { signupCommand } from "./signup.js";

// ── Helpers ──────────────────────────────────────────────────────────────

interface CapturedJson {
  ok: boolean;
  v?: number;
  data?: any;
  error?: any;
}

function captureStdout(fn: () => Promise<void>): Promise<{
  json: CapturedJson | null;
  raw: string;
  exitCode: number | null;
}> {
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
      // Envelope JSON is pretty-printed across multiple lines. Find the LAST
      // balanced JSON object that contains an "ok" key by scanning the raw
      // stream for `{`...`}` pairs.
      let json: CapturedJson | null = null;
      const tryParse = (text: string): CapturedJson | null => {
        try {
          const parsed = JSON.parse(text);
          return parsed && typeof parsed === "object" && "ok" in parsed
            ? parsed
            : null;
        } catch {
          return null;
        }
      };
      // Try the entire trimmed buffer first.
      const trimmed = raw.trim();
      json = tryParse(trimmed);
      if (!json) {
        // Fall back: find balanced top-level objects, prefer the FIRST
        // envelope (a `process.exit` mock that throws can cause a second,
        // spurious envelope from handleCommandError catching the throw).
        let depth = 0;
        let start = -1;
        const candidates: string[] = [];
        for (let i = 0; i < trimmed.length; i++) {
          if (trimmed[i] === "{") {
            if (depth === 0) start = i;
            depth++;
          } else if (trimmed[i] === "}") {
            depth--;
            if (depth === 0 && start >= 0) {
              candidates.push(trimmed.slice(start, i + 1));
              start = -1;
            }
          }
        }
        for (const c of candidates) {
          const parsed = tryParse(c);
          if (parsed) {
            json = parsed;
            break;
          }
        }
      }
      return { json, raw, exitCode };
    });
}

const baseOpts = {
  keypair: "/tmp/test-keypair.json",
  json: true,
  email: "a@b.com",
  firstName: "A",
  lastName: "B",
};

const samplePending = {
  paymentIntentId: "pi_abc",
  paymentUrl: "https://dashboard.helius.dev/pay/pi_abc",
  planName: "Agent Plan",
  amountCents: 1000,
  destinationWallet: "Treasury111",
  solanaPayUrl: "solana:Treasury111?amount=10",
  memo: "pi_abc",
  expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
  walletAddress: "Wallet111",
  refId: "ref-1",
  jwt: "jwt-1",
  createdAt: new Date().toISOString(),
};

// ── Tests ────────────────────────────────────────────────────────────────

describe("signup command — JSON output shapes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKeypairExists.mockReturnValue(true);
    mockLoadKeypair.mockResolvedValue({
      publicKey: new Uint8Array(32),
      secretKey: new Uint8Array(64),
    });
    mockGetAddress.mockResolvedValue("Wallet111");
    mockCheckSolBalance.mockResolvedValue(2_000_000n);
    mockCheckUsdcBalance.mockResolvedValue(20_000_000n);
  });

  afterEach(() => vi.restoreAllMocks());

  it("PAYMENT_REQUIRED for fresh signup (default link mode)", async () => {
    mockGetPendingSignup.mockReturnValue(undefined);
    mockSignup.mockResolvedValue({
      kind: "payment_required",
      jwt: "jwt-1",
      refId: "ref-1",
      walletAddress: "Wallet111",
      paymentLink: {
        kind: "payment_required",
        paymentIntentId: "pi_abc",
        amountCents: 1000,
        destinationWallet: "Treasury111",
        memo: "pi_abc",
        expiresAt: samplePending.expiresAt,
        paymentUrl: samplePending.paymentUrl,
        solanaPayUrl: samplePending.solanaPayUrl,
        planName: "Agent Plan",
      },
    });

    const { json } = await captureStdout(() => signupCommand({ ...baseOpts }));

    expect(json?.ok).toBe(true);
    expect(json?.data.status).toBe("PAYMENT_REQUIRED");
    expect(json?.data.paymentUrl).toBe(samplePending.paymentUrl);
    expect(json?.data.destinationWallet).toBe("Treasury111");
    expect(json?.data.memo).toBe("pi_abc");
    expect(json?.data.amountCents).toBe(1000);
    expect(json?.data.reused).toBeUndefined();
    expect(mockSetPendingSignup).toHaveBeenCalledTimes(1);
  });

  it("PAYMENT_REQUIRED with reused:true on second invocation (pending intent reuse)", async () => {
    mockGetPendingSignup.mockReturnValue(samplePending);

    const { json } = await captureStdout(() =>
      signupCommand({ ...baseOpts, email: undefined, firstName: undefined, lastName: undefined } as any),
    );

    expect(json?.data.status).toBe("PAYMENT_REQUIRED");
    expect(json?.data.reused).toBe(true);
    // No new intent created.
    expect(mockSignup).not.toHaveBeenCalled();
    expect(mockSetPendingSignup).not.toHaveBeenCalled();
  });

  it("ALREADY_SUBSCRIBED when wallet has matching project", async () => {
    mockGetPendingSignup.mockReturnValue(undefined);
    mockSignup.mockResolvedValue({
      kind: "already_subscribed",
      jwt: "jwt-1",
      refId: "ref-1",
      walletAddress: "Wallet111",
      projectId: "proj-1",
      apiKey: "key-1",
      endpoints: {
        mainnet: "https://mainnet.helius-rpc.com/?api-key=key-1",
        devnet: "https://devnet.helius-rpc.com/?api-key=key-1",
      },
    });

    const { json } = await captureStdout(() => signupCommand({ ...baseOpts }));

    expect(json?.data.status).toBe("ALREADY_SUBSCRIBED");
    expect(json?.data.apiKey).toBe("key-1");
    expect(mockSetApiKey).toHaveBeenCalledWith("key-1");
  });

  it("UPGRADE_REQUIRED when wallet is on a different plan", async () => {
    mockGetPendingSignup.mockReturnValue(undefined);
    mockSignup.mockResolvedValue({
      kind: "upgrade_required",
      jwt: "jwt-1",
      refId: "ref-1",
      walletAddress: "Wallet111",
      currentPlan: "developer_v4",
      requestedPlan: "agent",
    });

    const { json, exitCode } = await captureStdout(() => signupCommand({ ...baseOpts }));

    expect(json?.data.status).toBe("UPGRADE_REQUIRED");
    expect(json?.data.currentPlan).toBe("developer_v4");
    // emitUpgradeRequired calls process.exit only in non-JSON mode; JSON mode just returns.
    expect(exitCode).toBeNull();
  });

  it("MISSING_PENDING_INTENT when --resume is passed with no stored intent", async () => {
    mockGetPendingSignup.mockReturnValue(undefined);

    const { json } = await captureStdout(() =>
      signupCommand({ ...baseOpts, resume: true } as any),
    );

    expect(json?.data.status).toBe("MISSING_PENDING_INTENT");
    expect(mockLoadKeypair).not.toHaveBeenCalled();
  });
});

describe("signup command — --pay idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKeypairExists.mockReturnValue(true);
    mockLoadKeypair.mockResolvedValue({
      publicKey: new Uint8Array(32),
      secretKey: new Uint8Array(64),
    });
    mockGetAddress.mockResolvedValue("Wallet111");
    mockCheckSolBalance.mockResolvedValue(2_000_000n);
    mockCheckUsdcBalance.mockResolvedValue(20_000_000n);
  });

  it("--pay with stored txSignature does NOT re-send USDC", async () => {
    mockGetPendingSignup.mockReturnValue({ ...samplePending, txSignature: "tx-already-sent" });
    mockGetPaymentStatus.mockResolvedValue({
      status: "completed",
      phase: "complete",
      subscriptionActive: true,
      readyToRedirect: true,
      message: "ok",
    });
    mockListProjects.mockResolvedValue([{ id: "proj-1" }]);
    mockGetProject.mockResolvedValue({ apiKeys: [{ keyId: "key-1" }] });

    await captureStdout(() =>
      signupCommand({
        ...baseOpts,
        email: undefined,
        firstName: undefined,
        lastName: undefined,
        pay: true,
      } as any),
    );

    expect(mockPayPaymentLink).not.toHaveBeenCalled();
    expect(mockClearPendingSignup).toHaveBeenCalledTimes(1);
  });

  it("--pay with completed && !readyToRedirect does NOT re-send USDC, keeps polling", async () => {
    mockGetPendingSignup.mockReturnValue(samplePending); // no txSignature
    mockGetPaymentStatus
      .mockResolvedValueOnce({
        status: "completed",
        phase: "activating",
        subscriptionActive: false,
        readyToRedirect: false,
        message: "activating",
      })
      .mockResolvedValueOnce({
        status: "completed",
        phase: "complete",
        subscriptionActive: true,
        readyToRedirect: true,
        message: "ok",
      });
    mockListProjects.mockResolvedValue([{ id: "proj-1" }]);
    mockGetProject.mockResolvedValue({ apiKeys: [{ keyId: "key-1" }] });

    await captureStdout(() =>
      signupCommand({
        ...baseOpts,
        email: undefined,
        firstName: undefined,
        lastName: undefined,
        pay: true,
      } as any),
    );

    expect(mockPayPaymentLink).not.toHaveBeenCalled();
  });

  it("--pay with status pending DOES send USDC and stores txSignature", async () => {
    mockGetPendingSignup.mockReturnValue(samplePending);
    mockGetPaymentStatus
      .mockResolvedValueOnce({
        status: "pending",
        phase: "confirming",
        subscriptionActive: false,
        readyToRedirect: false,
        message: "",
      })
      .mockResolvedValueOnce({
        status: "completed",
        phase: "complete",
        subscriptionActive: true,
        readyToRedirect: true,
        message: "ok",
      });
    mockPayPaymentLink.mockResolvedValue({ txSignature: "tx-fresh" });
    mockListProjects.mockResolvedValue([{ id: "proj-1" }]);
    mockGetProject.mockResolvedValue({ apiKeys: [{ keyId: "key-1" }] });

    await captureStdout(() =>
      signupCommand({
        ...baseOpts,
        email: undefined,
        firstName: undefined,
        lastName: undefined,
        pay: true,
      } as any),
    );

    expect(mockPayPaymentLink).toHaveBeenCalledTimes(1);
    expect(mockUpdatePendingSignup).toHaveBeenCalledWith({ txSignature: "tx-fresh" });
  });
});

describe("signup command — --restart and --resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKeypairExists.mockReturnValue(true);
    mockLoadKeypair.mockResolvedValue({
      publicKey: new Uint8Array(32),
      secretKey: new Uint8Array(64),
    });
    mockGetAddress.mockResolvedValue("Wallet111");
  });

  it("--restart clears stored intent and creates a fresh one", async () => {
    // First call returns pending, but --restart clears it; subsequent
    // getPendingSignup() (after clearPendingSignup) should return undefined.
    let cleared = false;
    mockClearPendingSignup.mockImplementation(() => {
      cleared = true;
    });
    mockGetPendingSignup.mockImplementation(() =>
      cleared ? undefined : samplePending,
    );
    mockSignup.mockResolvedValue({
      kind: "payment_required",
      jwt: "jwt-2",
      refId: "ref-2",
      walletAddress: "Wallet111",
      paymentLink: {
        kind: "payment_required",
        paymentIntentId: "pi_new",
        amountCents: 1000,
        destinationWallet: "Treasury111",
        memo: "pi_new",
        expiresAt: samplePending.expiresAt,
        paymentUrl: "https://dashboard.helius.dev/pay/pi_new",
        solanaPayUrl: "solana:...",
        planName: "Agent Plan",
      },
    });

    await captureStdout(() => signupCommand({ ...baseOpts, restart: true } as any));

    expect(mockClearPendingSignup).toHaveBeenCalled();
    expect(mockSignup).toHaveBeenCalledTimes(1);
  });

  it("--resume does not load the keypair", async () => {
    mockGetPendingSignup.mockReturnValue(samplePending);
    mockGetPaymentStatus.mockResolvedValue({
      status: "completed",
      phase: "complete",
      subscriptionActive: true,
      readyToRedirect: true,
      message: "ok",
    });
    mockListProjects.mockResolvedValue([{ id: "proj-1" }]);
    mockGetProject.mockResolvedValue({ apiKeys: [{ keyId: "key-1" }] });

    await captureStdout(() => signupCommand({ ...baseOpts, resume: true } as any));

    expect(mockLoadKeypair).not.toHaveBeenCalled();
    expect(mockGetAddress).not.toHaveBeenCalled();
  });

  it("--resume returns SUCCESS when activation is ready", async () => {
    mockGetPendingSignup.mockReturnValue({ ...samplePending, txSignature: "tx-sent" });
    mockGetPaymentStatus.mockResolvedValue({
      status: "completed",
      phase: "complete",
      subscriptionActive: true,
      readyToRedirect: true,
      message: "ok",
    });
    mockListProjects.mockResolvedValue([{ id: "proj-1" }]);
    mockGetProject.mockResolvedValue({ apiKeys: [{ keyId: "key-1" }] });

    const { json } = await captureStdout(() =>
      signupCommand({ ...baseOpts, resume: true } as any),
    );

    expect(json?.data.status).toBe("SUCCESS");
    expect(json?.data.apiKey).toBe("key-1");
    expect(json?.data.txSignature).toBe("tx-sent");
    expect(mockClearPendingSignup).toHaveBeenCalled();
  });

  it("--resume after backend says EXPIRED clears stored intent", async () => {
    mockGetPendingSignup.mockReturnValue(samplePending);
    mockGetPaymentStatus.mockResolvedValue({
      status: "expired",
      phase: "expired",
      subscriptionActive: false,
      readyToRedirect: false,
      message: "expired",
    });

    const { json } = await captureStdout(() =>
      signupCommand({ ...baseOpts, resume: true } as any),
    );

    expect(json?.data.status).toBe("EXPIRED");
    expect(mockClearPendingSignup).toHaveBeenCalled();
  });

  it("--resume after backend says FAILED clears stored intent", async () => {
    mockGetPendingSignup.mockReturnValue(samplePending);
    mockGetPaymentStatus.mockResolvedValue({
      status: "failed",
      phase: "failed",
      subscriptionActive: false,
      readyToRedirect: false,
      message: "boom",
    });

    const { json } = await captureStdout(() =>
      signupCommand({ ...baseOpts, resume: true } as any),
    );

    expect(json?.data.status).toBe("FAILED");
    expect(json?.data.reason).toBe("boom");
    expect(mockClearPendingSignup).toHaveBeenCalled();
  });
});

describe("signup command — expired-pending in default link mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKeypairExists.mockReturnValue(true);
    mockLoadKeypair.mockResolvedValue({
      publicKey: new Uint8Array(32),
      secretKey: new Uint8Array(64),
    });
    mockGetAddress.mockResolvedValue("Wallet111");
  });

  const expiredStored = {
    ...samplePending,
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  };

  it("queries backend when local expiresAt is past — backend says pending → reprints link", async () => {
    mockGetPendingSignup.mockReturnValue(expiredStored);
    mockGetPaymentStatus.mockResolvedValue({
      status: "pending",
      phase: "confirming",
      subscriptionActive: false,
      readyToRedirect: false,
      message: "",
    });

    const { json } = await captureStdout(() =>
      signupCommand({ ...baseOpts, email: undefined, firstName: undefined, lastName: undefined } as any),
    );

    expect(mockGetPaymentStatus).toHaveBeenCalledWith(expiredStored.jwt, expiredStored.paymentIntentId);
    expect(json?.data.status).toBe("PAYMENT_REQUIRED");
    expect(json?.data.reused).toBe(true);
    expect(mockClearPendingSignup).not.toHaveBeenCalled();
    expect(mockSignup).not.toHaveBeenCalled();
  });

  it("queries backend when local expiresAt is past — backend says expired → clears + restarts fresh", async () => {
    let cleared = false;
    mockClearPendingSignup.mockImplementation(() => {
      cleared = true;
    });
    mockGetPendingSignup.mockImplementation(() => (cleared ? undefined : expiredStored));
    mockGetPaymentStatus.mockResolvedValue({
      status: "expired",
      phase: "expired",
      subscriptionActive: false,
      readyToRedirect: false,
      message: "expired",
    });
    mockSignup.mockResolvedValue({
      kind: "payment_required",
      jwt: "jwt-fresh",
      refId: "ref-fresh",
      walletAddress: "Wallet111",
      paymentLink: {
        kind: "payment_required",
        paymentIntentId: "pi_new",
        amountCents: 1000,
        destinationWallet: "Treasury111",
        memo: "pi_new",
        expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
        paymentUrl: "https://dashboard.helius.dev/pay/pi_new",
        solanaPayUrl: "solana:...",
        planName: "Agent Plan",
      },
    });

    const { json } = await captureStdout(() => signupCommand({ ...baseOpts }));

    expect(mockClearPendingSignup).toHaveBeenCalled();
    expect(mockSignup).toHaveBeenCalledTimes(1);
    expect(json?.data.paymentIntentId).toBe("pi_new");
    expect(json?.data.reused).toBeUndefined();
  });

  it("queries backend when local expiresAt is past — backend says completed → provisions instead of reprinting", async () => {
    mockGetPendingSignup.mockReturnValue(expiredStored);
    mockGetPaymentStatus.mockResolvedValue({
      status: "completed",
      phase: "complete",
      subscriptionActive: true,
      readyToRedirect: true,
      message: "ok",
    });
    mockListProjects.mockResolvedValue([{ id: "proj-1" }]);
    mockGetProject.mockResolvedValue({ apiKeys: [{ keyId: "key-1" }] });

    const { json } = await captureStdout(() =>
      signupCommand({ ...baseOpts, email: undefined, firstName: undefined, lastName: undefined } as any),
    );

    expect(json?.data.status).toBe("SUCCESS");
    expect(mockClearPendingSignup).toHaveBeenCalled();
    expect(mockSignup).not.toHaveBeenCalled();
  });
});

describe("signup command — basic plan rejection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKeypairExists.mockReturnValue(true);
    mockGetPendingSignup.mockReturnValue(undefined);
  });

  it("rejects --plan basic with a clear message pointing to --plan agent", async () => {
    const { json } = await captureStdout(() =>
      signupCommand({ ...baseOpts, plan: "basic" } as any),
    );

    expect(json?.ok).toBe(false);
    const msg = (json as any)?.error ?? "";
    expect(msg.toLowerCase()).toContain("basic");
    expect(msg).toContain("--plan agent");
    expect(mockSignup).not.toHaveBeenCalled();
  });
});
