import type { Metadata } from "next";
import { Suspense } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "万护 OneCare｜AI 用户服务闭环引擎",
  description: "万护 OneCare，面向海信智能家庭场景的 AI 用户服务全链路闭环方案。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/misans@4.1.0/lib/Normal/MiSans-Regular.min.css"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/misans@4.1.0/lib/Normal/MiSans-Demibold.min.css"
        />
      </head>
      <body className="font-misans">
        {/*
          Task 14 turns on `cacheComponents` (next.config.ts) so the VOC
          dashboard route can use `use cache`/`cacheLife`. Under that flag,
          any page reading `cookies()`/`searchParams` (home, /login) must sit
          behind a Suspense boundary or the build fails outright — before
          this flag, the same pages were already fully dynamic per request,
          this just makes that pre-existing behavior explicit. A `null`
          fallback keeps the static shell empty rather than approximating
          markup that would just be discarded a moment later.
        */}
        <Suspense fallback={null}>{children}</Suspense>
      </body>
    </html>
  );
}
