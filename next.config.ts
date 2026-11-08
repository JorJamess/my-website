import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  env: {
    // Workers Builds ใส่ WORKERS_CI_COMMIT_SHA ให้ตอน build บน Cloudflare
    NEXT_PUBLIC_COMMIT: process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 7) ?? "local",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

// ให้ `next dev` เข้าถึง binding ของ Cloudflare (D1, vars, secrets) ผ่าน getCloudflareContext()
initOpenNextCloudflareForDev();
