import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@fedistack/ui"],
  reactStrictMode: true
};

export default nextConfig;
