import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Enables the `use cache` directive and `cacheLife`/`cacheTag`, which the
  // public VOC dashboard route needs so an anonymous visitor's page load
  // never triggers a fresh cross-border Bitable read (task 14).
  cacheComponents: true,
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
