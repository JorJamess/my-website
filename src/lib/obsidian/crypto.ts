// Small crypto helpers (Web Crypto, works in Workers and Node). No framework imports.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sha256Hex(data: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(data));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Random token with 256 bits of entropy, URL safe. */
export function randomToken(bytes = 32): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Pairing code like K7QM-4XD2 (no look-alike characters). */
export function randomPairingCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export function normalizeCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function importKey(keyB64: string) {
  const raw = unb64(keyB64);
  if (raw.length !== 32) throw new Error("OBSIDIAN_PAYLOAD_KEY must be 32 bytes, base64 encoded");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-256-GCM with a fresh nonce. `aad` binds the ciphertext to one row (e.g. the command id). Format: v1.<nonce>.<ciphertext> */
export async function encryptPayload(keyB64: string, aad: string, plaintext: string): Promise<string> {
  const key = await importKey(keyB64);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: enc.encode(aad) }, key, enc.encode(plaintext));
  return `v1.${b64(nonce)}.${b64(new Uint8Array(ct))}`;
}

export async function decryptPayload(keyB64: string, aad: string, packed: string): Promise<string> {
  const [v, n, c] = packed.split(".");
  if (v !== "v1" || !n || !c) throw new Error("Unknown payload format");
  const key = await importKey(keyB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(n), additionalData: enc.encode(aad) }, key, unb64(c));
  return dec.decode(pt);
}
