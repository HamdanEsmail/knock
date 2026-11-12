import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { handOver, legId } from "../src/list/workflow";

/** A stand-in for the Workflow binding: it refuses an id it has seen, as the real one does. */
function binding(over: { broken?: boolean } = {}) {
  const made: { id: string; params: unknown }[] = [];
  const workflow = {
    create: async ({ id, params }: { id: string; params: unknown }) => {
      if (over.broken) throw new Error("the platform is not answering");
      if (made.some((m) => m.id === id)) throw new Error("instance already exists");
      made.push({ id, params });
      return {};
    },
    get: async (id: string) => {
      if (!made.some((m) => m.id === id)) throw new Error("instance not found");
      return { status: async () => ({ status: "running" }) };
    },
  };
  return { made, env: { ...env, LIST_WORKFLOW: workflow } as unknown as Env };
}

describe("handing a list on from run to run", () => {
  it("gives every leg of every attempt its own run id", () => {
    expect(legId("abc123", 0, { group: 0, stage: "doors", turn: 0 })).toBe("abc123-a0-g0-doors-0");
    expect(legId("abc123", 2, { group: 14, stage: "search2", turn: 3 })).toBe("abc123-a2-g14-search2-3");
    expect(legId("abc123", 0, { group: 24, stage: "verdict", turn: 12 })).toMatch(/^[a-zA-Z0-9_][a-zA-Z0-9-_]{0,99}$/);
  });

  it("starts one run when a hand-over is tried twice", async () => {
    const b = binding();
    const leg = { group: 1, stage: "read", turn: 0 } as const;
    await handOver(b.env, "abc123", 0, leg);
    await handOver(b.env, "abc123", 0, leg);
    expect(b.made).toEqual([{ id: "abc123-a0-g1-read-0", params: { listId: "abc123", attempt: 0, leg } }]);
  });

  it("fails when the run could not be started and is not there", async () => {
    await expect(handOver(binding({ broken: true }).env, "abc123", 0, { group: 0, stage: "doors", turn: 0 })).rejects.toThrow("not answering");
  });
});
