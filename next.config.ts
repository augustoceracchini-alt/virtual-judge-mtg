import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/judge": ["./data/regole-compatte.json"],
  },
};

export default nextConfig;
