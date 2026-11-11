// Optional secret for the Obsidian integration (set with `wrangler secret put OBSIDIAN_PAYLOAD_KEY`; 32 random bytes, base64).
interface CloudflareEnv {
  OBSIDIAN_PAYLOAD_KEY?: string;
}
