import { createHash, createHmac } from "node:crypto";
import { normalizeWebOrigin } from "@repo/contracts";

export function hashMailToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function signature(value: string): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error("Missing mail signing key");
  return createHmac("sha256", secret)
    .update("staydesk-mail/" + value)
    .digest("hex");
}

export function accountMailToken(id: string) {
  return signature("account/" + id);
}

export function replyAddress(messageId: string, deliveryRound = 0) {
  const domain = process.env.MAIL_REPLY_DOMAIN;
  if (!domain) return undefined;

  // Stable on a retry of the same digest, within SMTP's 64-character local part.
  const reference = deliveryRound ? `${messageId}/${deliveryRound}` : messageId;
  const token = signature("reply/v2/" + reference).slice(0, 48);
  return {
    address: "reply+" + token + "@" + domain,
    hash: hashMailToken(token),
  };
}

export function replyTokenHash(address: string) {
  const match = /^reply\+([0-9a-f]{48})@([^@]+)$/i.exec(address);
  const token = match?.[1];
  return token &&
    match[2]?.toLowerCase() === process.env.MAIL_REPLY_DOMAIN?.toLowerCase()
    ? hashMailToken(token.toLowerCase())
    : null;
}

export function mailSiteOrigin(): string {
  const origin =
    normalizeWebOrigin(process.env.SITE_ORIGIN) ??
    process.env.WEB_ORIGIN?.split(",")
      .map(normalizeWebOrigin)
      .find((candidate) => candidate !== null);
  if (origin) return origin;
  if (process.env.NODE_ENV === "production" && !process.env.MAIL_SMTP_URL)
    throw new Error("Set SITE_ORIGIN or WEB_ORIGIN for email links");

  return `http://localhost:${process.env.WEB_PORT || "3000"}`;
}

export function renderLetter(subject: string, detail: string, path: string) {
  const origin = mailSiteOrigin();
  const url = new URL(path, origin);
  // A path such as "/\host" resolves to another host; a letter only ever links to the site.
  if (url.origin !== origin) throw new Error("Email links stay on the site");
  const href = url.href;
  return {
    subject,
    text: subject + "\n\n" + detail + "\n\n" + href,
    html:
      "<h1>" +
      escapeHtml(subject) +
      "</h1><p>" +
      escapeHtml(detail).replaceAll("\n", "<br>") +
      '</p><a href="' +
      escapeHtml(href) +
      '">Open in StayDesk</a>',
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
