import type { AuthUser } from "./types";

// 评委通道 的身份。One fixed identity rather than one per visitor: nothing is written on
// their behalf, so there is nothing to tell two of them apart for.
export const GUEST_USER: AuthUser = {
  openId: "guest",
  name: "评委",
  guest: true,
};

export function isGuest(user: AuthUser | null): boolean {
  return user?.guest === true;
}

// The refusal every write route gives a guest. Written once so the wording — and the
// fact that the check exists at all — cannot drift between the twelve routes that write
// something: the UI hides these controls, but a browser is not a trust boundary and a
// guest session is handed out to anyone who clicks a link on the front page.
export function refuseGuestWrite(): Response {
  return Response.json(
    {
      error: "forbidden",
      message: "评委通道是只读的：可以查看全部数据，不能修改工单或给同事发消息",
    },
    { status: 403 },
  );
}
