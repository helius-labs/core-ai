import { afterEach, describe, expect, it, vi } from "vitest";

// Mock readline so the interactive prompt path is controllable.
const questionMock = vi.fn<(q: string, cb: (answer: string) => void) => void>();
vi.mock("readline", () => ({
  default: {
    createInterface: () => ({
      question: (q: string, cb: (a: string) => void) => questionMock(q, cb),
      close: () => {},
    }),
  },
}));

import { confirmDestructive } from "../src/lib/output.js";

const originalIsTTY = process.stdin.isTTY;

function setTTY(value: boolean) {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

afterEach(() => {
  Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
  questionMock.mockReset();
});

describe("confirmDestructive", () => {
  it("proceeds without prompting when --yes is passed", async () => {
    setTTY(true);
    expect(await confirmDestructive("Delete? ", { yes: true })).toBe(true);
    expect(questionMock).not.toHaveBeenCalled();
  });

  it("proceeds without prompting in --json mode", async () => {
    setTTY(true);
    expect(await confirmDestructive("Delete? ", { json: true })).toBe(true);
    expect(questionMock).not.toHaveBeenCalled();
  });

  it("proceeds without prompting in non-interactive (non-TTY) contexts", async () => {
    setTTY(false);
    expect(await confirmDestructive("Delete? ", {})).toBe(true);
    expect(questionMock).not.toHaveBeenCalled();
  });

  it("prompts on a TTY and proceeds when the user answers yes", async () => {
    setTTY(true);
    questionMock.mockImplementation((_q, cb) => cb("y"));
    expect(await confirmDestructive("Delete? ", {})).toBe(true);
    expect(questionMock).toHaveBeenCalledOnce();
  });

  it("prompts on a TTY and aborts when the user answers no", async () => {
    setTTY(true);
    questionMock.mockImplementation((_q, cb) => cb(""));
    expect(await confirmDestructive("Delete? ", {})).toBe(false);
  });
});
