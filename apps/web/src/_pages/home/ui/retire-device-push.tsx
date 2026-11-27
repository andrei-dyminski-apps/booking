"use client";

import { useEffect } from "react";
import { ACCOUNT_DELETED_COOKIE } from "#shared/config";
import { clearDevicePush, withDevicePushLock } from "#shared/lib";

function takeDeletedMark(): boolean {
  const { name } = ACCOUNT_DELETED_COOKIE;
  const present = document.cookie
    .split(";")
    .some((pair) => pair.trim().startsWith(`${name}=`));

  if (present) {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
  }

  return present;
}

/**
 * Retires this browser's push subscription once its account is gone. The delete action
 * ends in a redirect, so nothing in the dialog runs after it; the notice it lands on does
 * this instead — only when the action left its mark (`ACCOUNT_DELETED_COOKIE`), since the
 * address alone is a link anybody may send to a visitor whose access token has merely
 * lapsed. Until it runs the worker shows nothing private either: the action cleared the
 * session, and with it the account hint the worker checks before every push.
 */
export const RetireDevicePush = () => {
  useEffect(() => {
    if (!takeDeletedMark()) return;

    void withDevicePushLock(clearDevicePush).catch(() => undefined);
  }, []);

  return null;
};
