import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
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
