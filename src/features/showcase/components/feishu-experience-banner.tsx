import type { ReactNode } from "react";

type FeishuExperienceRole = "agent" | "engineer" | "operations";

type FeishuExperienceBannerProps = Readonly<{
  role: FeishuExperienceRole;
  children: ReactNode;
}>;

export function FeishuExperienceBanner({
  role,
  children,
}: FeishuExperienceBannerProps) {
  return (
    <aside className="feishu-experience-banner" aria-label="飞书体验计划">
      <div>
        <span>计划接入飞书</span>
        <strong>{children}</strong>
      </div>
      <a
        className="feishu-experience-banner__action"
        href={`/login?from=${role}`}
      >
        登录体验
      </a>
    </aside>
  );
}
