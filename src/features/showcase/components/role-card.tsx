import type { Perspective } from "../content";
import { StatusTag } from "./status-tag";

export function RoleCard({ role }: { role: Perspective }) {
  return (
    <article className="role-card">
      <div className="role-card__topline">
        <span>{role.index}</span>
        <StatusTag>下一阶段开放</StatusTag>
      </div>
      <div className="role-card__signal" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h3>{role.title}</h3>
      <p>{role.value}</p>
      <ul aria-label={`${role.title}能力`}>
        {role.capabilities.map((capability) => (
          <li key={capability}>{capability}</li>
        ))}
      </ul>
      <span className="role-card__arrow" aria-hidden="true">
        ↗
      </span>
    </article>
  );
}
