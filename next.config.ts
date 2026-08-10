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
  // `/dashboard` used to be a one-line Server Component (`redirect("/login")`)
  // with no route segment config escape hatch: `export const dynamic =
  // "force-dynamic"` is itself rejected under `cacheComponents` ("Route
  // segment config \"dynamic\" is not compatible with nextConfig.
  // cacheComponents"). With `cacheComponents` on, Next prerenders that
  // page as static output and bakes the `redirect()` into the RSC payload
  // as a client-side navigation (a meta-refresh plus a NEXT_REDIRECT digest)
  // instead of emitting a real HTTP redirect — confirmed by diffing
  // `next start` responses before/after task 14 turned cacheComponents on;
  // a non-JS caller (curl, a search crawler, tests/runtime/auth-routes.
  // test.ts) got a 200 instead of a 307. A path with no logic beyond
  // "go somewhere else" belongs in routing config, not a rendered page: this
  // redirect is resolved before any route matching or rendering happens, so
  // it is unaffected by Cache Components either way and works for every
  // caller. `permanent: false` (307) preserves the original redirect()
  // default and keeps this reversible — nothing here claims `/dashboard` is
  // gone forever, and a 308/301 would let clients and crawlers cache that
  // claim past the point we could undo it. The source is the exact path
  // `/dashboard` (no wildcard), so it does not touch `/dashboard/voc`, the
  // public VOC dashboard added in task 14.
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/login",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
