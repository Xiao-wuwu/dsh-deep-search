/** undici HTTP wrapper: per-target proxy, UA rotation, timeouts, 1 retry, gzip, typed errors. */
import { request, ProxyAgent, type Dispatcher } from "undici";
import { pickUa } from "./ua.ts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly target: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} from ${target}`);
    this.name = "HttpError";
  }

  /** 429 / 402 / quota-ish bodies — the cooldown trigger. */
  get isQuota(): boolean {
    return this.status === 429 || this.status === 402 || this.code === "quota";
  }

  get isRetryable(): boolean {
    return this.status >= 500 || this.status === 408 || this.code === "network" || this.code === "timeout";
  }
}

export interface HttpOpts {
  target: string;
  /** Query seed for stable UA selection. */
  seed?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  proxy?: string;
  signal?: AbortSignal;
}

export interface HttpPostOpts extends HttpOpts {
  body: string;
  contentType?: string;
}

export interface HttpResult {
  status: number;
  body: string;
  ms: number;
}

const DEFAULT_TIMEOUT = 15_000;
const RETRY_BACKOFF_MS = 500;

interface CallSpec {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

async function once(url: string, spec: CallSpec, timeoutMs: number, target: string, opts: HttpOpts, dispatcher?: Dispatcher): Promise<HttpResult> {
  const started = Date.now();
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  try {
    const res = await request(url, {
      method: spec.method,
      headers: spec.headers,
      body: spec.body,
      signal,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      ...(dispatcher ? { dispatcher } : {}),
    });
    const text = await res.body.text().catch(() => "");
    const ms = Date.now() - started;
    if (res.statusCode >= 400) {
      const quota =
        res.statusCode === 429 ||
        res.statusCode === 402 ||
        /quota|rate.?limit|credits/i.test(text.slice(0, 2000));
      throw new HttpError(res.statusCode, quota ? "quota" : "http", target,
        `${target} -> ${res.statusCode}: ${text.slice(0, 200)}`);
    }
    return { status: res.statusCode, body: text, ms };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const msg = String((err as Error)?.message ?? err);
    if (opts.signal?.aborted) throw err; // caller-driven abort passes through untouched
    if (/timeout|AbortError/i.test(msg)) {
      throw new HttpError(0, "timeout", target, `timeout after ${timeoutMs}ms: ${url}`);
    }
    throw new HttpError(0, "network", target, `network error: ${msg}`);
  }
}

export interface HttpClient {
  get(url: string, opts: HttpOpts): Promise<HttpResult>;
  post(url: string, opts: HttpPostOpts): Promise<HttpResult>;
}

export function createHttpClient(
  defaults: { timeoutMs?: number; proxyByTarget?: Record<string, string> } = {},
): HttpClient {
  const timeout = defaults.timeoutMs ?? DEFAULT_TIMEOUT;

  const proxyFor = (opts: HttpOpts): string | undefined =>
    opts.proxy ?? defaults.proxyByTarget?.[opts.target];

  // cached per-proxy-url agents (ProxyAgent construction is not free)
  const agents = new Map<string, ProxyAgent>();
  const dispatcherFor = (opts: HttpOpts): Dispatcher | undefined => {
    const p = proxyFor(opts);
    if (!p) return undefined;
    let a = agents.get(p);
    if (!a) {
      a = new ProxyAgent(p);
      agents.set(p, a);
    }
    return a;
  };

  const baseHeaders = (opts: HttpOpts): Record<string, string> => ({
    "user-agent": pickUa(opts.seed ?? opts.target),
    "accept-encoding": "gzip, deflate",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    ...opts.headers,
  });

  const runWithRetry = async (url: string, spec: CallSpec, opts: HttpOpts): Promise<HttpResult> => {
    const dispatcher = dispatcherFor(opts);
    try {
      return await once(url, spec, opts.timeoutMs ?? timeout, opts.target, opts, dispatcher);
    } catch (err) {
      if (err instanceof HttpError && err.isRetryable && !opts.signal?.aborted) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
        return once(url, spec, opts.timeoutMs ?? timeout, opts.target, opts, dispatcher);
      }
      throw err;
    }
  };

  return {
    async get(url, opts) {
      return runWithRetry(url, { method: "GET", headers: baseHeaders(opts) }, opts);
    },
    async post(url, opts) {
      return runWithRetry(
        url,
        { method: "POST", headers: { ...baseHeaders(opts), "content-type": opts.contentType ?? "application/json" }, body: opts.body },
        opts,
      );
    },
  };
}
