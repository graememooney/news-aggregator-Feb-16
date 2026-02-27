import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**", // allow all https sources (fine for this app)
      },
    ],
  },
};

export default nextConfig;
