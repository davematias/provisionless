import type { NextConfig } from "next";

import { securityHeaders } from "./src/lib/security-headers.ts";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@provisionless/design-system"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders({
          isDevelopment: process.env.NODE_ENV !== "production",
        }),
      },
    ];
  },
};

export default nextConfig;
