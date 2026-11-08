import type { NextConfig } from "next";
import path from "node:path";
const mediaDirectory = path
  .relative(process.cwd(), path.resolve(process.env.MEDIA_ROOT || ".data"))
  .replaceAll("\\", "/");
const config: NextConfig = {
  output: "standalone",
  // Runtime references, derived masks and private env files are never build assets.
  outputFileTracingExcludes: {
    "/*": [
      "./.data/**/*",
      "./output/**/*",
      "./.env*",
      ...(mediaDirectory && !mediaDirectory.startsWith("..")
        ? ["./" + mediaDirectory + "/**/*"]
        : []),
    ],
  },
  poweredByHeader: false,
  turbopack: {
    rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } },
  },
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
