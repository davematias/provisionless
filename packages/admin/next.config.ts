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
          apiUrl: process.env.NEXT_PUBLIC_API_URL,
          isDevelopment: process.env.NODE_ENV !== "production",
        }),
      },
    ];
  },
};

export default nextConfig;
