import type { NextConfig } from "next";

const BACKEND = process.env.PAPER_LENS_BACKEND ?? "http://localhost:8766";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
