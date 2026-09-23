/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    cpus: 1,
  },
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost", port: "8000" },
      { protocol: "http", hostname: "127.0.0.1", port: "8000" },
    ],
  },
  async redirects() {
    return [
      // Canonical delivery routes. Keep legacy URLs working without
      // creating duplicate pages that confuse navigation and the AI assistant.
      { source: "/deliveries", destination: "/delivery/deliveries", permanent: false },
      { source: "/history", destination: "/delivery/history", permanent: false },
    ];
  },
};

module.exports = nextConfig;
