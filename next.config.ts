import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/judge": [
      "./data/regole-compatte.json",
      "./data/mtr-compatte.json",
      "./data/errata-locali.json",
    ],
  },
};

export default nextConfig;
