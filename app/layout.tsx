import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Auto Insight｜汽车用户洞察引擎",
  description: "把海量用户声音变成可交互、可追溯的汽车产品洞察。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
