import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  webpack(config, { dev }) {
    if (dev) {
      // SQLite writes to prisma/*.db would otherwise trigger a recompile on every request
      // that writes, racing in-flight renders and causing sporadic 500s in `next dev`.
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ["**/node_modules/**", "**/.git/**", "**/prisma/*.db*"],
      };
    }
    return config;
  },
};

export default nextConfig;
