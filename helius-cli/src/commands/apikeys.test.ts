import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListProjects = vi.fn();
const mockCreateApiKey = vi.fn();
vi.mock("../lib/api.js", () => ({
  getProject: vi.fn(),
  listProjects: (...args: unknown[]) => mockListProjects(...args),
  createApiKey: (...args: unknown[]) => mockCreateApiKey(...args),
}));

const mockGetApiKey = vi.fn();
const mockGetProjectId = vi.fn();
const mockSetApiKey = vi.fn();
const mockSetSharedApiKey = vi.fn();
vi.mock("../lib/config.js", () => ({
  getJwt: () => "jwt-1",
  getApiKey: () => mockGetApiKey(),
  getProjectId: () => mockGetProjectId(),
  setApiKey: (...args: unknown[]) => mockSetApiKey(...args),
  setSharedApiKey: (...args: unknown[]) => mockSetSharedApiKey(...args),
  SHARED_CONFIG_PATH: "/tmp/test-config.json",
}));

import { createApiKeyCommand } from "./apikeys.js";

async function run(): Promise<any> {
  const out: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.join(" ")); });
  try {
    await createApiKeyCommand(undefined, { json: true });
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(out.join("\n"));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProjectId.mockReturnValue(undefined);
  mockListProjects.mockResolvedValue([{ id: "proj-1", users: [{ id: "OwnerWallet", role: "Owner" }] }]);
  mockCreateApiKey.mockResolvedValue({ keyId: "new-key", keyName: "default" });
});

describe("helius apikeys create", () => {
  it("saves the first key so other commands can use it after a keyless signup", async () => {
    mockGetApiKey.mockReturnValue(undefined);
    const json = await run();

    expect(mockCreateApiKey).toHaveBeenCalledWith("jwt-1", "proj-1", "OwnerWallet");
    expect(mockSetApiKey).toHaveBeenCalledWith("new-key");
    expect(mockSetSharedApiKey).toHaveBeenCalledWith("new-key");
    expect(json.data).toMatchObject({ keyId: "new-key", configured: true });
  });

  it("leaves an already-configured key in place", async () => {
    mockGetApiKey.mockReturnValue("existing-key");
    const json = await run();

    expect(mockSetApiKey).not.toHaveBeenCalled();
    expect(mockSetSharedApiKey).not.toHaveBeenCalled();
    expect(json.data).toMatchObject({ keyId: "new-key", configured: false });
  });

  it("defaults to the project signup saved, not the first one", async () => {
    mockGetApiKey.mockReturnValue(undefined);
    mockGetProjectId.mockReturnValue("proj-2");
    mockListProjects.mockResolvedValue([
      { id: "proj-1", users: [{ id: "OwnerWallet", role: "Owner" }] },
      { id: "proj-2", users: [{ id: "OwnerWallet2", role: "Owner" }] },
    ]);
    const json = await run();

    expect(mockCreateApiKey).toHaveBeenCalledWith("jwt-1", "proj-2", "OwnerWallet2");
    expect(json.data.projectId).toBe("proj-2");
  });

  it("falls back to the first project when the saved one is gone", async () => {
    mockGetApiKey.mockReturnValue(undefined);
    mockGetProjectId.mockReturnValue("proj-deleted");
    await run();

    expect(mockCreateApiKey).toHaveBeenCalledWith("jwt-1", "proj-1", "OwnerWallet");
  });
});
