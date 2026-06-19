import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories below (which run before module init) can use
// these. OWNER is a valid 43-char base58 pubkey reused for the signer, owner,
// and destination so the real validateAddress() and the signerAddress === owner
// guard both pass. The mock fns are re-armed in beforeEach.
const h = vi.hoisted(() => ({
  OWNER: "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY",
  mockGetAllTokenAccounts: vi.fn(),
  mockSendViaSender: vi.fn(),
  mockLoadKeypair: vi.fn(),
  mockCreateSigner: vi.fn(),
  mockGetCloseIx: vi.fn(),
}));
const { OWNER } = h;

vi.mock("../lib/helius.js", () => ({
  setupClient: vi.fn().mockResolvedValue({
    getAllTokenAccountsByOwner: (...args: unknown[]) => h.mockGetAllTokenAccounts(...args),
    tx: { sendTransactionWithSender: (...args: unknown[]) => h.mockSendViaSender(...args) },
  }),
}));

vi.mock("../lib/wallet.js", () => ({
  loadKeypairFromFile: (...args: unknown[]) => h.mockLoadKeypair(...args),
}));

vi.mock("@solana/kit", () => ({
  address: (a: string) => a,
  createKeyPairSignerFromBytes: (...args: unknown[]) => h.mockCreateSigner(...args),
}));

vi.mock("@solana-program/token", () => ({
  getCloseAccountInstruction: (...args: unknown[]) => h.mockGetCloseIx(...args),
}));

vi.mock("../lib/feedback.js", () => ({
  sendCommandEvent: vi.fn(),
  getCurrentCommand: () => "reclaim",
}));

// Stub ora so the non-json (terminal) path doesn't drive a real spinner.
vi.mock("ora", () => {
  const make = () => {
    const s: any = { start: () => s, stop: () => s, succeed: () => s, fail: () => s };
    return s;
  };
  return { default: make };
});

import { reclaimCommand } from "./reclaim.js";
import { sendCommandEvent } from "../lib/feedback.js";

interface CapturedJson {
  ok: boolean;
  error_code?: string;
  recoverable?: boolean;
  data?: any;
  details?: any;
}

function captureStdout(fn: () => Promise<void>) {
  const chunks: string[] = [];
  let exitCode: number | null = null;
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    chunks.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n");
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  // The real process.exit terminates immediately; here we throw to unwind. We
  // record only the FIRST exit code: a command's own try/catch may re-handle
  // the thrown sentinel and call process.exit again, which never happens in
  // production where the first exit halts the process.
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: any) => {
    if (exitCode === null) exitCode = typeof code === "number" ? code : 0;
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
      // Each writeEnvelope() is one console.log call → one chunk. Return the
      // first JSON envelope emitted (the meaningful one in production).
      let json: CapturedJson | null = null;
      for (const c of chunks) {
        try {
          const parsed = JSON.parse(c.trim());
          if (parsed && typeof parsed === "object" && "ok" in parsed) {
            json = parsed;
            break;
          }
        } catch {
          /* not a JSON chunk */
        }
      }
      return { json, raw: chunks.join(""), exitCode };
    });
}

/** An empty, closable SPL token account owned by OWNER. */
function emptyAta(pubkey: string) {
  return {
    pubkey,
    account: {
      lamports: 2_039_280,
      data: {
        parsed: {
          info: {
            state: "initialized",
            mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            tokenAmount: { amount: "0" },
            closeAuthority: null,
          },
        },
      },
    },
  };
}

const baseOpts = {
  keypair: "/tmp/keypair.json",
  yes: true,
  json: true,
};

describe("reclaim command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.mockGetAllTokenAccounts.mockReset();
    h.mockSendViaSender.mockReset();
    h.mockLoadKeypair.mockResolvedValue({ secretKey: new Uint8Array(64) });
    h.mockCreateSigner.mockResolvedValue({ address: OWNER });
    h.mockGetCloseIx.mockReturnValue({});
  });

  it("returns ok:true and exit 0 when every batch lands", async () => {
    h.mockGetAllTokenAccounts.mockResolvedValue([emptyAta("Ata1")]);
    h.mockSendViaSender.mockResolvedValue("sig-1");

    const { json, exitCode } = await captureStdout(() => reclaimCommand(OWNER, baseOpts));

    expect(json?.ok).toBe(true);
    expect(json?.data.closed).toBe(1);
    expect(json?.data.failures).toHaveLength(0);
    // Success path never calls process.exit → natural exit 0.
    expect(exitCode).toBeNull();
  });

  it("returns ok:false and exits non-zero when every batch fails to land", async () => {
    h.mockGetAllTokenAccounts.mockResolvedValue([emptyAta("Ata1"), emptyAta("Ata2")]);
    h.mockSendViaSender.mockRejectedValue(new Error("Sender unavailable"));

    const { json, exitCode } = await captureStdout(() => reclaimCommand(OWNER, baseOpts));

    expect(json?.ok).toBe(false);
    expect(json?.error_code).toBe("PAYMENT_FAILED");
    expect(exitCode).toBe(22); // ExitCode.PAYMENT_FAILED
    // Failed batches are transient and re-running is safe, so the envelope must
    // tell an agent it can retry even though PAYMENT_FAILED is normally terminal.
    expect(json?.recoverable).toBe(true);
    // The breakdown is preserved so callers still know nothing landed.
    expect(json?.details.closed).toBe(0);
    expect(json?.details.failures).toHaveLength(1);
  });

  it("exits non-zero on partial failure but still reports the landed batches", async () => {
    // batch-size 1 → two single-account batches; first lands, second fails.
    h.mockGetAllTokenAccounts.mockResolvedValue([emptyAta("Ata1"), emptyAta("Ata2")]);
    h.mockSendViaSender
      .mockResolvedValueOnce("sig-1")
      .mockRejectedValueOnce(new Error("boom"));

    const { json, exitCode } = await captureStdout(() =>
      reclaimCommand(OWNER, { ...baseOpts, batchSize: "1" }),
    );

    expect(json?.ok).toBe(false);
    expect(exitCode).toBe(22);
    expect(json?.recoverable).toBe(true);
    expect(json?.details.closed).toBe(1);
    expect(json?.details.successes).toHaveLength(1);
    expect(json?.details.failures).toHaveLength(1);
  });

  it("on terminal (non-json) failure: records the success:false event, prints the feedback prompt, exits 22", async () => {
    h.mockGetAllTokenAccounts.mockResolvedValue([emptyAta("Ata1")]);
    h.mockSendViaSender.mockRejectedValue(new Error("Sender unavailable"));

    // json omitted → terminal mode; yes:true skips the confirm prompt.
    const { raw, exitCode } = await captureStdout(() =>
      reclaimCommand(OWNER, { keypair: "/tmp/keypair.json", yes: true }),
    );

    expect(exitCode).toBe(22);
    // process.exit() halts before the postAction hook, so reclaim emits both by hand.
    expect(sendCommandEvent).toHaveBeenCalledWith("reclaim", { success: false, exitCode: 22 });
    expect(raw).toContain('helius feedback "<your feedback on reclaim>"');
    expect(raw).toContain("--feedback-tool reclaim");
  });
});
