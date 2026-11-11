// The one place every TinyFish call goes through. It adds the key and turns a refusal into a
// TinyFishError. The key is read here and nowhere else, and never appears in an error or a log.
import type { Env } from "../env";

export class TinyFishError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`TinyFish HTTP ${status} ${code}`);
    this.name = "TinyFishError";
    this.status = status;
    this.code = code;
  }
}

/** An error code is a short token. Anything longer could echo what was sent, so it is not kept. */
const CODE_SHAPE = /^[A-Za-z0-9_.-]{1,64}$/;

async function errorFrom(res: Response): Promise<TinyFishError> {
  let code: unknown;
  try {
    const body = JSON.parse(await res.text()) as { code?: unknown; error?: { code?: unknown } | string };
    code = typeof body.error === "object" && body.error !== null ? body.error.code : body.code;
  } catch {
    // not JSON: there is no code in it
  }
  return new TinyFishError(res.status, typeof code === "string" && CODE_SHAPE.test(code) ? code : `http_${res.status}`);
}

/** Reads a 2xx body as JSON; a body that is not JSON becomes a TinyFishError `bad_json`. */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new TinyFishError(res.status, "bad_json");
  }
}

/** Sends one request to TinyFish. Anything but a 2xx answer, and a request that never arrived, is a TinyFishError. */
export async function tinyfishFetch(env: Env, url: string, init: RequestInit = {}): Promise<Response> {
  if (!env.TINYFISH_API_KEY) throw new TinyFishError(0, "no_key");
  const headers = new Headers(init.headers);
  headers.set("X-API-Key", env.TINYFISH_API_KEY);
  headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch {
    throw new TinyFishError(0, "network");
  }
  if (!res.ok) throw await errorFrom(res);
  return res;
}

/** The short code of whatever went wrong in a call, for the row to keep. */
export function codeOf(err: unknown): string {
  if (err instanceof TinyFishError) return err.code;
  throw err;
}
