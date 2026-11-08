import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { TZ_OFFSET } from "@/lib/time";

export async function getEnv(): Promise<CloudflareEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env as CloudflareEnv;
}

export async function getTzOffset() {
  return TZ_OFFSET;
}
