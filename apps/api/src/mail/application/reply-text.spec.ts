import { isAutomaticReply, replyText } from "./reply-text";

describe("replyText", () => {
  it.each([
    "Noon works.\n\nSent from my iPhone\n\nOn Nov 22, at 10:00 AM,\nStayDesk wrote:\n> Around noon?",
    "Noon works.\n\nOn Nov 22, at 10:00 AM,\nStayDesk wrote:\n> Around noon?",
    "Noon works.\n\nOn Sunday,\nStayDesk wrote:\n" +
      "Earlier mail. ".repeat(160),
    "Noon works.\r\n\r\nGet Outlook for iOS\r\n\r\nFrom: StayDesk\r\nSent: Sunday",
    "Noon works.\n\nFrom: StayDesk\nSent: Sunday\nTo: Host\nSubject: Stay",
    "Noon works.\n\nDe : StayDesk\nEnvoyé : dimanche\nÀ : Host\nObjet : Stay",
    "Noon works.\n\nVon: StayDesk\nGesendet: Sonntag\nAn: Host\nBetreff: Stay",
    "Noon works.\n\n-- \nHost",
  ])("removes signatures and quoted history", (text) => {
    expect(replyText({ to: [], text })).toBe("Noon works.");
  });

  it.each([
    "> Can we meet?\n\nNoon works.",
    "On Sunday StayDesk wrote:\n> Can we meet?\n\nNoon works.",
    "On Sunday,\nStayDesk wrote:\n\n> Can we meet?\n\nNoon works.",
    "On Sunday StayDesk wrote: > Can we meet?\n\nNoon works.",
  ])("keeps text written below a plain-text quote", (text) => {
    expect(replyText({ to: [], text })).toBe("Noon works.");
  });

  it("keeps interleaved answers while removing the quoted lines", () => {
    const text =
      "> Can we meet?\nNoon works.\n\n> Which door?\nUse the side door.";
    expect(replyText({ to: [], text })).toBe(
      "Noon works.\n\nUse the side door.",
    );
  });

  it("keeps a From line in the reply when no quoted headers follow", () => {
    const text = "From: noon onwards\nThe keys will be ready.";
    expect(replyText({ to: [], text })).toBe(text);
  });

  it("uses structured HTML to remove a quote with localized headers", () => {
    const text =
      "Noon works.\n\nVon: StayDesk\nGesendet: Sonntag\nEarlier mail";
    const html = "<div>Noon works.</div><blockquote>Earlier mail</blockquote>";
    expect(replyText({ to: [], text, html })).toBe("Noon works.");
  });

  it("keeps inline answers from the plain part when HTML wraps them in a quote", () => {
    const text = "Thanks.\n> Which station?\nCentral.\n> When?\nAt noon.";
    const html =
      "<p>Thanks.</p><blockquote>Which station?<div>Central.</div>When?<div>At noon.</div></blockquote>";
    expect(replyText({ to: [], text, html })).toBe(
      "Thanks.\nCentral.\nAt noon.",
    );
  });

  it("removes the header and the following quoted body from an Outlook reply", () => {
    const html =
      '<div>Ja, das passt.</div><hr><div id="divRplyFwdMsg"><b>Von:</b> StayDesk<br><b>Gesendet:</b> Sonntag</div>' +
      "<div>" +
      "Earlier mail. ".repeat(160) +
      "</div>";
    expect(replyText({ to: [], html })).toBe("Ja, das passt.");
  });

  it("keeps a reply from the plain part when removing the HTML quote leaves nothing", () => {
    const text = "Around noon.";
    const html = '<blockquote type="cite">Around noon.</blockquote>';
    expect(replyText({ to: [], text, html })).toBe(text);
  });

  it("keeps a reply below a structured Outlook quote", () => {
    const html =
      '<div id="divRplyFwdMsg">From: StayDesk</div><div><blockquote>When?</blockquote></div>' +
      "<p>Around noon.</p>";
    expect(replyText({ to: [], html })).toBe("Around noon.");
  });

  it("drops a quote-only reply with quoted text in both parts", () => {
    const text = "> Earlier mail";
    const html = "<blockquote>Earlier mail</blockquote>";
    expect(replyText({ to: [], text, html })).toBe("");
  });

  it("keeps the plain part when the HTML has no quote or signature markup", () => {
    const text = "Noon works.\nUse the side door.";
    const html = "<p>Noon works.</p>";
    expect(replyText({ to: [], text, html })).toBe(text);
  });

  it("redacts a reply address left in plain text or HTML", () => {
    const address = "Reply+" + "A".repeat(48) + "@mail.test";
    const text = `Reply-To: <${address}>`;
    const html = `<p>Reply-To: <a href="mailto:${address}">${address}</a></p>`;
    for (const letter of [
      { to: [], text },
      { to: [], html },
    ]) {
      const body = replyText(letter);
      expect(body).toContain("[reply address removed]");
      expect(body).not.toContain(address);
    }
  });
});

describe("isAutomaticReply", () => {
  it.each<Record<string, string>>([
    { "Auto-Submitted": "AUTO-REPLIED; owner-email=staff@mail.test" },
    { Precedence: "bulk" },
    { "X-Autoreply": "yes" },
    { "Return-Path": " <>" },
    { "Content-Type": "multipart/report; report-type=delivery-status" },
  ])("rejects an automatic reply marked by %o", (headers) => {
    expect(isAutomaticReply({ to: [], headers })).toBe(true);
  });

  it("accepts a reply whose sender explicitly sets Auto-Submitted to no", () => {
    expect(
      isAutomaticReply({ to: [], headers: { "Auto-Submitted": "no" } }),
    ).toBe(false);
  });
});
