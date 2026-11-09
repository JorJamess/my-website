// ใช้ได้ทั้งใน custom-worker.ts และ API routes — ห้าม import อะไรที่ผูกกับ Next
const BOT = /bot|crawl|spider|slurp|headless|curl|wget|python|node-fetch|monitor|uptime|lighthouse|preview/i;

export function isCountableView(request: Request) {
  if (request.method !== "GET") return false;
  if (BOT.test(request.headers.get("user-agent") ?? "")) return false;
  // เจ้าของเว็บที่ login อยู่ไม่นับ
  if (/(?:^|;\s*)mw_session=/.test(request.headers.get("cookie") ?? "")) return false;
  return true;
}

export async function recordView(db: D1Database, request: Request, path: string) {
  const now = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  let ref = "";
  try {
    const r = request.headers.get("referer");
    if (r) {
      const host = new URL(r).hostname.replace(/^www\./, "");
      if (host !== new URL(request.url).hostname) ref = host;
    }
  } catch {}
  const country = ((request as Request & { cf?: { country?: string } }).cf?.country ?? "").slice(0, 2);
  await db
    .prepare(
      `INSERT INTO page_views (day, path, ref, country, views) VALUES (?1, ?2, ?3, ?4, 1)
       ON CONFLICT(day, path, ref, country) DO UPDATE SET views = views + 1`,
    )
    .bind(now, path, ref, country)
    .run();
}

export type VisitStats = {
  days: number;
  total: number;
  byDay: { day: string; views: number }[];
  byLang: { en: number; th: number };
  topRefs: { ref: string; views: number }[];
  topCountries: { country: string; views: number }[];
};

export async function getVisitStats(db: D1Database, days = 14): Promise<VisitStats> {
  const from = new Date(Date.now() + 7 * 3_600_000 - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const [byDay, byPath, refs, countries] = await db.batch([
    db.prepare("SELECT day, SUM(views) AS views FROM page_views WHERE day >= ?1 GROUP BY day ORDER BY day").bind(from),
    db.prepare("SELECT path, SUM(views) AS views FROM page_views WHERE day >= ?1 GROUP BY path").bind(from),
    db.prepare("SELECT ref, SUM(views) AS views FROM page_views WHERE day >= ?1 AND ref != '' GROUP BY ref ORDER BY views DESC LIMIT 6").bind(from),
    db.prepare("SELECT country, SUM(views) AS views FROM page_views WHERE day >= ?1 AND country != '' GROUP BY country ORDER BY views DESC LIMIT 5").bind(from),
  ]);
  const paths = Object.fromEntries((byPath.results as { path: string; views: number }[]).map((r) => [r.path, r.views]));
  const rows = byDay.results as { day: string; views: number }[];
  return {
    days,
    total: rows.reduce((s, r) => s + r.views, 0),
    byDay: rows,
    byLang: { en: paths["/"] ?? 0, th: paths["/th"] ?? 0 },
    topRefs: refs.results as { ref: string; views: number }[],
    topCountries: countries.results as { country: string; views: number }[],
  };
}
