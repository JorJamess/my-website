// HTTP client for LifeOS's /api/obsidian endpoints. Every request carries the device token; nothing else is trusted.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
  /** worth trying again later: network trouble, rate limits, server errors (including D1 quota errors) */
  get transient() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}
/** the owner revoked this Mac in LifeOS: stop syncing and ask them to pair again */
export class DeviceRevokedError extends ApiError {}
/** the document was refused for permission reasons (revoked, old grant) */
export class SyncRefusedError extends ApiError {}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type UploadBody = {
  id: string;
  kind: "note" | "pdf";
  title: string;
  path: string;
  content_hash: string;
  tags: string[];
  source_updated_at?: string | null;
  grant_version: number;
  sync_version: number;
  total_chunks: number;
  part: number;
  chunks: { index: number; page?: number | null; heading?: string | null; content: string }[];
  pdf_refs?: string[];
  pdf?: { state: "pending" | "processing" | "completed" | "no_text" | "failed" | "too_large"; size_bytes?: number | null; pages?: number | null; message?: string | null };
};
export type UploadResult = { id: string; status: string; received: number; expected: number };
export type BlockedBody = { id: string; title: string; path: string; content_hash: string; kind?: "note" | "pdf"; findings: { kind: string; line: number; redacted: string; fingerprint: string }[] };

export type PollResult = {
  now: string;
  cursor: string;
  paused: boolean;
  sync_requested: boolean;
  commands: { id: string; op: string; expires_at: string }[];
  revocations: { document_id: string; grant_version: number; state: "revoked" | "reenabled"; changed_at: string }[];
  exceptions: { document_id: string; fingerprint: string; content_hash: string; excepted_at: string }[];
};
export type ClaimedCommand = { id: string; op: string; payload: Record<string, unknown>; expected_hash: string | null; expires_at: string; secret_findings: number };
export type CommandResultBody = { status: "applied" | "conflict" | "failed"; message?: string; conflict?: Record<string, unknown> };
export type HeartbeatBody = { status: "idle" | "syncing" | "paused" | "error"; error?: string; success?: boolean; sync_request_seen?: boolean; details?: Record<string, string | number | boolean | null> };

export class BridgeClient {
  constructor(
    private baseUrl: string,
    private token: string | null,
    private fetchImpl: FetchLike = fetch as FetchLike,
    private onRequest?: () => void,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    this.onRequest?.();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/obsidian${path}`, {
        method,
        headers: { "content-type": "application/json", ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), "user-agent": "obsidian-bridge" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError(0, "network", `Can't reach LifeOS (${(e as Error).message})`);
    }
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* not JSON (e.g. an HTML error page) */
    }
    if (res.ok) return json as T;
    const code = typeof json.error === "string" ? json.error : `http_${res.status}`;
    const message = typeof json.message === "string" ? json.message : code;
    const retry = Number(res.headers.get("retry-after")) || undefined;
    if (res.status === 401 && code === "device_revoked") throw new DeviceRevokedError(401, code, "This Mac was revoked in LifeOS. Pair it again to continue.");
    if (res.status === 403 && (code === "revoked" || code === "stale_grant")) throw new SyncRefusedError(403, code, message);
    throw new ApiError(res.status, code, message, retry);
  }

  /** Trade a pairing code for a device token. Not authenticated; wrong codes are rate limited by LifeOS. */
  static async pair(baseUrl: string, input: { code: string; name: string; vault_name?: string; version?: string }, fetchImpl?: FetchLike) {
    return new BridgeClient(baseUrl, null, fetchImpl).call<{ device_id: string; token: string }>("POST", "/pair/complete", input);
  }

  poll(since: { rev: string; exc: string }) {
    const q = new URLSearchParams({ rev_since: since.rev, exc_since: since.exc });
    return this.call<PollResult>("GET", `/bridge/poll?${q}`);
  }
  upload(body: UploadBody) {
    return this.call<UploadResult>("POST", "/bridge/documents", body);
  }
  removeDocument(id: string) {
    return this.call<{ ok: boolean }>("DELETE", `/bridge/documents/${encodeURIComponent(id)}`);
  }
  updatePath(id: string, body: { path: string; title?: string }) {
    return this.call<{ ok: boolean }>("PATCH", `/bridge/documents/${encodeURIComponent(id)}`, body);
  }
  reportBlocked(body: BlockedBody) {
    return this.call<{ ok: boolean }>("POST", "/bridge/blocked", body);
  }
  claim(id: string) {
    return this.call<ClaimedCommand>("POST", `/bridge/commands/${encodeURIComponent(id)}/claim`);
  }
  reportResult(id: string, body: CommandResultBody) {
    return this.call<{ id: string; status: string }>("POST", `/bridge/commands/${encodeURIComponent(id)}/result`, body);
  }
  heartbeat(body: HeartbeatBody) {
    return this.call<{ ok: boolean }>("POST", "/bridge/heartbeat", body);
  }
  unpair() {
    return this.call<{ ok: boolean }>("POST", "/bridge/unpair");
  }
  reenable(id: string) {
    return this.call<{ document_id: string; grant_version: number }>("POST", `/bridge/documents/${encodeURIComponent(id)}/reenable`);
  }
}

/** The calls the sync engine needs (so tests can swap in a fake). */
export type SyncApi = Pick<BridgeClient, "upload" | "removeDocument" | "updatePath" | "reportBlocked">;
