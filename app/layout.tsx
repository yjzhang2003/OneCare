import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "OneCare｜AI 用户服务闭环引擎",
  description: "面向海信智能家庭场景的 AI 用户服务全链路闭环方案。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
