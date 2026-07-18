import { getCurrentSession } from "../../src/features/auth/current-session";
import {
  LoginContent,
  type LoginSourceRole,
} from "./login-content";

const errorMessages: Record<string, string> = {
  configuration_error: "登录服务尚未完成配置，请稍后再试。",
  access_denied: "你已取消飞书授权，可以随时重新登录。",
  invalid_state: "登录请求已失效，请重新发起。",
  token_exchange_failed: "飞书登录暂时未完成，请重新尝试。",
  user_info_failed: "暂时无法读取飞书身份，请重新尝试。",
};

const sourceRoles = new Set<LoginSourceRole>([
  "agent",
  "engineer",
  "operations",
]);

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [user, parameters] = await Promise.all([
    getCurrentSession(),
    searchParams,
  ]);
  const errorCode = first(parameters.auth_error);
  const source = first(parameters.from);
  const sourceRole = sourceRoles.has(source as LoginSourceRole)
    ? (source as LoginSourceRole)
    : undefined;

  return (
    <LoginContent
      authError={errorCode ? errorMessages[errorCode] : undefined}
      sourceRole={sourceRole}
      user={user}
    />
  );
}
