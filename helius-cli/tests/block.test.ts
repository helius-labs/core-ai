import { afterEach, describe, expect, it, vi } from "vitest";

const getBlockMock = vi.fn(async (..._args: unknown[]) => null);
vi.mock("../src/lib/helius.js", () => ({
  setupClient: vi.fn(async () => ({ raw: { getBlock: getBlockMock } })),
}));

import { blockCommand } from "../src/commands/block.js";

afterEach(() => {
  getBlockMock.mockClear();
  vi.restoreAllMocks();
});

describe("block command", () => {
  it("requests blocks with v1 transactions supported", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await blockCommand("123456789", { json: true });

    expect(getBlockMock).toHaveBeenCalledTimes(1);
    const [slot, config] = getBlockMock.mock.calls[0];
    expect(slot).toBe(123456789n);
    expect(config).toMatchObject({ maxSupportedTransactionVersion: 1 });
  });
});
