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
  async redirects() {
    return [
      {
        source: "/mercosur",
        destination: "/?region=mercosur",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
