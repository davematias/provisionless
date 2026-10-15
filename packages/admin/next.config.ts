import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@provisionless/design-system"],
};

export default nextConfig;
