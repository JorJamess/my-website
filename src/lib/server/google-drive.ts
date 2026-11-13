import "server-only";
import { getEnv } from "./env";

/** Read-only Drive access, limited by this app to one folder (and what is inside it). */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const GOOGLE_CALLBACK_PATH = "/api/library/google/callback";
export const DEFAULT_FOLDER_NAME = "Memories";

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function tokenKey(secret: string) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`google-drive-token:${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(plain: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(secret), enc.encode(plain));
  return `${b64(iv)}.${b64(ct)}`;
}

export async function decryptToken(stored: string, secret: string) {
  const [iv, ct] = stored.split(".");
  if (!iv || !ct) throw new Error("bad_token_format");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await tokenKey(secret), unb64(ct));
  return dec.decode(plain);
}

export class DriveError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

async function config() {
  const env = await getEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new DriveError("google_not_configured", 503);
  if (!env.SESSION_SECRET) throw new DriveError("session_secret_missing", 503);
  return { env, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, secret: env.SESSION_SECRET };
}

export function redirectUri(req: Request) {
  return new URL(GOOGLE_CALLBACK_PATH, new URL(req.url).origin).toString();
}

export async function buildAuthUrl(req: Request, state: string) {
  const { clientId } = await config();
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  }).toString();
  return u.toString();
}

/** Trade the one-time code from Google for tokens, and keep only the (encrypted) refresh token. */
export async function finishConnect(req: Request, code: string) {
  const { env, clientId, clientSecret, secret } = await config();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(req), grant_type: "authorization_code" }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; expires_in?: number };
  if (!res.ok || !data.access_token) throw new DriveError("token_exchange_failed");
  if (!data.refresh_token) throw new DriveError("no_refresh_token");
  if (!(data.scope ?? "").split(" ").includes(DRIVE_SCOPE)) throw new DriveError("scope_not_granted", 400);

  const folder = await findFolderByName(data.access_token, DEFAULT_FOLDER_NAME);
  await env.DB.prepare(
    `INSERT INTO google_drive_auth (id, refresh_token, scope, folder_id, folder_name, connected_at)
     VALUES (1, ?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(id) DO UPDATE SET refresh_token = ?1, scope = ?2, folder_id = ?3, folder_name = ?4, connected_at = ?5`,
  )
    .bind(await encryptToken(data.refresh_token, secret), data.scope ?? DRIVE_SCOPE, folder?.id ?? null, folder?.name ?? null, new Date().toISOString())
    .run();
  cached = null;
  parentCache.clear();
  return { folder };
}

export type Connection = { folderId: string | null; folderName: string | null; connectedAt: string };

export async function getConnection(): Promise<Connection | null> {
  const { DB } = await getEnv();
  const r = await DB.prepare("SELECT folder_id, folder_name, connected_at FROM google_drive_auth WHERE id = 1").first<{ folder_id: string | null; folder_name: string | null; connected_at: string }>();
  return r ? { folderId: r.folder_id, folderName: r.folder_name, connectedAt: r.connected_at } : null;
}

export async function disconnect() {
  const { env, secret } = await config().catch(async () => ({ env: await getEnv(), secret: "" }));
  const row = await env.DB.prepare("SELECT refresh_token FROM google_drive_auth WHERE id = 1").first<{ refresh_token: string }>();
  if (row && secret) {
    // best effort: also revoke the grant at Google so the token stops working everywhere
    try {
      const rt = await decryptToken(row.refresh_token, secret);
      await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: rt }) });
    } catch {}
  }
  await env.DB.prepare("DELETE FROM google_drive_auth WHERE id = 1").run();
  cached = null;
  parentCache.clear();
}

let cached: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 30_000) return cached.token;
  const { env, clientId, clientSecret, secret } = await config();
  const row = await env.DB.prepare("SELECT refresh_token FROM google_drive_auth WHERE id = 1").first<{ refresh_token: string }>();
  if (!row) throw new DriveError("not_connected", 409);
  const rt = await decryptToken(row.refresh_token, secret).catch(() => {
    throw new DriveError("reconnect_needed", 409);
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: rt, grant_type: "refresh_token" }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) {
    if (data.error === "invalid_grant") throw new DriveError("reconnect_needed", 409);
    throw new DriveError("token_refresh_failed");
  }
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3000) * 1000 };
  return cached.token;
}

const API = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ID_RE = /^[A-Za-z0-9_-]{10,80}$/;

export const isValidId = (id: string) => ID_RE.test(id);
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function driveGet(path: string, params: Record<string, string>, token?: string, init?: RequestInit) {
  const t = token ?? (await accessToken());
  const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${t}` } });
  return res;
}

async function findFolderByName(token: string, name: string) {
  const res = await driveGet("/files", { q: `name = '${esc(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false and 'root' in parents`, fields: "files(id,name)", pageSize: "5" }, token);
  if (!res.ok) return null;
  const d = (await res.json()) as { files?: { id: string; name: string }[] };
  return d.files?.[0] ?? null;
}

export type DriveItem = {
  id: string;
  name: string;
  kind: "folder" | "image" | "video" | "pdf" | "other";
  mime: string;
  size: number | null;
  modified: string;
  hasThumb: boolean;
  duration: number | null;
  width: number | null;
  height: number | null;
};

function kindOf(mime: string): DriveItem["kind"] {
  if (mime === FOLDER_MIME) return "folder";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return "other";
}

const parentCache = new Map<string, { parent: string | null; at: number }>();

/** True when `id` is the library folder itself or somewhere inside it (walks up through parents; capped depth). */
export async function isInsideRoot(id: string, root: string): Promise<boolean> {
  let cur: string | null = id;
  for (let depth = 0; depth < 12 && cur; depth++) {
    if (cur === root) return true;
    const hit = parentCache.get(cur);
    let parent: string | null;
    if (hit && Date.now() - hit.at < 300_000) parent = hit.parent;
    else {
      const res = await driveGet(`/files/${cur}`, { fields: "parents" });
      if (!res.ok) return false;
      const d = (await res.json()) as { parents?: string[] };
      parent = d.parents?.[0] ?? null;
      parentCache.set(cur, { parent, at: Date.now() });
    }
    cur = parent;
  }
  return false;
}

export async function listFolder(folderId: string, root: string, pageToken?: string) {
  if (!(await isInsideRoot(folderId, root))) throw new DriveError("outside_library", 403);
  const res = await driveGet("/files", {
    q: `'${folderId}' in parents and trashed = false`,
    fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,thumbnailLink,videoMediaMetadata(durationMillis,width,height),imageMediaMetadata(width,height))",
    orderBy: "modifiedTime desc",
    pageSize: "100",
    ...(pageToken ? { pageToken } : {}),
  });
  if (!res.ok) throw new DriveError("drive_list_failed");
  const d = (await res.json()) as {
    nextPageToken?: string;
    files?: { id: string; name: string; mimeType: string; size?: string; modifiedTime: string; thumbnailLink?: string; videoMediaMetadata?: { durationMillis?: string; width?: number; height?: number }; imageMediaMetadata?: { width?: number; height?: number } }[];
  };
  const items: DriveItem[] = (d.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    kind: kindOf(f.mimeType),
    mime: f.mimeType,
    size: f.size ? Number(f.size) : null,
    modified: f.modifiedTime,
    hasThumb: !!f.thumbnailLink,
    duration: f.videoMediaMetadata?.durationMillis ? Math.round(Number(f.videoMediaMetadata.durationMillis) / 1000) : null,
    width: f.videoMediaMetadata?.width ?? f.imageMediaMetadata?.width ?? null,
    height: f.videoMediaMetadata?.height ?? f.imageMediaMetadata?.height ?? null,
  }));
  return { items, nextPageToken: d.nextPageToken ?? null };
}

export async function folderInfo(folderId: string, root: string) {
  if (!(await isInsideRoot(folderId, root))) throw new DriveError("outside_library", 403);
  const res = await driveGet(`/files/${folderId}`, { fields: "id,name,parents,mimeType" });
  if (!res.ok) throw new DriveError("drive_get_failed");
  return (await res.json()) as { id: string; name: string; parents?: string[]; mimeType: string };
}

/** Small preview made by Drive. The access token never leaves the server. */
export async function fetchThumb(id: string, root: string, size: number) {
  if (!(await isInsideRoot(id, root))) throw new DriveError("outside_library", 403);
  const meta = await driveGet(`/files/${id}`, { fields: "thumbnailLink" });
  if (!meta.ok) throw new DriveError("drive_get_failed");
  const link = ((await meta.json()) as { thumbnailLink?: string }).thumbnailLink;
  if (!link) throw new DriveError("no_thumbnail", 404);
  const url = link.replace(/=s\d+$/, `=s${size}`);
  const img = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!img.ok) throw new DriveError("thumbnail_failed");
  return img;
}

/** Full file (images, PDFs, video with Range support so seeking works). */
export async function fetchContent(id: string, root: string, range: string | null) {
  if (!(await isInsideRoot(id, root))) throw new DriveError("outside_library", 403);
  const res = await driveGet(`/files/${id}`, { alt: "media" }, undefined, { headers: range ? { Range: range } : {} });
  if (!res.ok && res.status !== 206) throw new DriveError(res.status === 404 ? "not_found" : "drive_download_failed", res.status === 404 ? 404 : 502);
  return res;
}
