import type { ReactNode } from "react";

type FeishuExperienceRole = "agent" | "engineer" | "operations";

type FeishuExperienceBannerProps = Readonly<{
  // Kept in the signature because every call site names the perspective it sits under,
  // and losing that would make the three banners look interchangeable. It no longer
  // changes the link: authorization is the same door for all three.
  role: FeishuExperienceRole;
  children: ReactNode;
}>;

export function FeishuExperienceBanner({
  role: _role,
  children,
}: FeishuExperienceBannerProps) {
  return (
    <aside className="feishu-experience-banner" aria-label="飞书登录">
      <div>
        <span>飞书</span>
        <strong>{children}</strong>
      </div>
      <a
        className="feishu-experience-banner__action"
        href="/api/auth/feishu/start"
      >
        飞书登录
      </a>
    </aside>
  );
}
