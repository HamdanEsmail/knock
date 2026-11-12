import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { specFor } from "../src/outside/spec";
import { cancelRun, fillDataset, makeDataset, readDataset, rowsOf } from "../src/tinyfish/datasets";
import { fetchMock } from "./helpers/fetch-mock";

const API = "https://agent.tinyfish.ai/v1/datasets";
const SPEC = specFor([{ n: 0, name: "Rdio", address: "https://rdio.com/" }]);

beforeEach(() => fetchMock.activate());
afterEach(() => fetchMock.reset());

describe("TinySet's datasets", () => {
  it("makes an empty dataset without filling it, and gives its id", async () => {
    fetchMock.intercept({ method: "POST", url: API, reply: { status: 201, json: { id: "ds-1", status: "empty", target_rows: 1, row_count: 0, run: null } } });
    expect(await makeDataset(env, SPEC, 1)).toBe("ds-1");
    expect(fetchMock.calls[0]?.body).toEqual({ spec: SPEC, target_rows: 1, populate: false });
  });

  it("does not take a dataset that came back already filling as an empty one", async () => {
    fetchMock.intercept({ method: "POST", url: API, reply: { status: 201, json: { id: "ds-1", status: "populating", run: { id: "run-1" } } } });
    await expect(makeDataset(env, SPEC, 1)).rejects.toThrow("bad_dataset");
    fetchMock.intercept({ method: "POST", url: API, reply: { status: 201, json: { status: "empty" } } });
    await expect(makeDataset(env, SPEC, 1)).rejects.toThrow("bad_dataset");
  });

  it("reads where a dataset stands: its status, its rows so far and its run", async () => {
    fetchMock.intercept({ method: "GET", url: `${API}/ds-1`, reply: { json: { id: "ds-1", status: "populating", target_rows: 50, row_count: 12, run: { id: "run-1", status: "running" } } } });
    expect(await readDataset(env, "ds-1")).toEqual({ status: "populating", rows: 12, runId: "run-1" });
    fetchMock.intercept({ method: "GET", url: `${API}/ds-1`, reply: { json: { id: "ds-1", status: "empty", row_count: 0, run: null } } });
    expect(await readDataset(env, "ds-1")).toEqual({ status: "empty", rows: 0, runId: null });
    fetchMock.intercept({ method: "GET", url: `${API}/ds-1`, reply: { json: { id: "ds-1" } } });
    await expect(readDataset(env, "ds-1")).rejects.toThrow("bad_dataset");
  });

  it("starts a fill for a number of rows and gives the run's id", async () => {
    fetchMock.intercept({ method: "POST", url: `${API}/ds-1/populate`, reply: { status: 202, json: { id: "ds-1", status: "populating", run: { id: "run-2", status: "queued" } } } });
    expect(await fillDataset(env, "ds-1", 50)).toBe("run-2");
    expect(fetchMock.calls[0]?.body).toEqual({ target_rows: 50 });
  });

  it("reads every row, following the cursor while the answer says it was cut", async () => {
    fetchMock.intercept({ method: "GET", url: `${API}/ds-1/rows?limit=500`, reply: { json: { rows: [{ _id: "a", data: { company_name: "Rdio" } }, { _id: "b" }, "x"], truncated: true, next_cursor: "c 2" } } });
    fetchMock.intercept({ method: "GET", url: `${API}/ds-1/rows?limit=500&after=c%202`, reply: { json: { rows: [{ _id: "c", data: { company_name: "Path" } }], truncated: false } } });
    expect(await rowsOf(env, "ds-1")).toEqual([{ company_name: "Rdio" }, { company_name: "Path" }]);
    fetchMock.intercept({ method: "GET", url: `${API}/ds-1/rows?limit=500`, reply: { json: { columns: [] } } });
    await expect(rowsOf(env, "ds-1")).rejects.toThrow("bad_rows");
  });

  it("asks for a run to be stopped", async () => {
    fetchMock.intercept({ method: "POST", url: `${API}/ds-1/runs/run-2/cancel`, reply: { json: { status: "cancelling" } } });
    await cancelRun(env, "ds-1", "run-2");
    expect(fetchMock.calls).toHaveLength(1);
  });

  it("says so when TinyFish refuses", async () => {
    fetchMock.intercept({ method: "POST", url: `${API}/ds-1/populate`, reply: { status: 402, json: { error: { code: "insufficient_funds" } } } });
    await expect(fillDataset(env, "ds-1", 50)).rejects.toThrow("insufficient_funds");
  });
});
