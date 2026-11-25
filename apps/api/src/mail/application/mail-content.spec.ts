import {
  accountMailToken,
  mailSiteOrigin,
  renderLetter,
  replyAddress,
  replyTokenHash,
} from "./mail-content";

describe("mail content", () => {
  const savedEnv = process.env;

  beforeEach(() => {
    // A copy rather than the object itself, so no variable leaks into the next file.
    process.env = { ...savedEnv, JWT_REFRESH_SECRET: "test-signing-secret" };
    for (const name of [
      "SITE_ORIGIN",
      "WEB_ORIGIN",
      "WEB_PORT",
      "MAIL_SMTP_URL",
      "MAIL_REPLY_DOMAIN",
    ]) {
      delete process.env[name];
    }
    process.env.NODE_ENV = "test";
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  describe("mailSiteOrigin", () => {
    it("prefers SITE_ORIGIN over the CORS list", () => {
      process.env.SITE_ORIGIN = "staydesk.dev";
      process.env.WEB_ORIGIN = "http://localhost:3100";
      expect(mailSiteOrigin()).toBe("https://staydesk.dev");
    });

    it("takes the first usable origin of WEB_ORIGIN", () => {
      process.env.WEB_ORIGIN =
        "*, http://localhost:3100/, https://staydesk.dev";
      expect(mailSiteOrigin()).toBe("http://localhost:3100");
    });

    it("falls back to the local web port outside production", () => {
      process.env.WEB_PORT = "3100";
      expect(mailSiteOrigin()).toBe("http://localhost:3100");
    });

    it("refuses to guess an origin for a production API sending through Resend", () => {
      process.env.NODE_ENV = "production";
      expect(() => mailSiteOrigin()).toThrow(/SITE_ORIGIN or WEB_ORIGIN/);
    });
  });

  describe("renderLetter", () => {
    beforeEach(() => {
      process.env.SITE_ORIGIN = "https://staydesk.dev";
    });

    it("links to the path on the site and keeps the token in the fragment", () => {
      const letter = renderLetter(
        "Reset your StayDesk password",
        "Open this link.",
        "/reset-password#abc123",
      );
      expect(letter.text).toBe(
        "Reset your StayDesk password\n\nOpen this link.\n\nhttps://staydesk.dev/reset-password#abc123",
      );
      expect(letter.html).toContain(
        'href="https://staydesk.dev/reset-password#abc123"',
      );
    });

    it("escapes markup in the subject, the detail and the link", () => {
      const letter = renderLetter(
        "<b>Hi</b> & bye",
        'A "quote"\n<script>alert(1)</script>',
        '/x?next="><img src=x>',
      );
      expect(letter.html).not.toMatch(/<b>|<script>|<img/);
      expect(letter.html).toContain("&lt;b&gt;Hi&lt;/b&gt; &amp; bye");
      expect(letter.html).toContain(
        "A &quot;quote&quot;<br>&lt;script&gt;alert(1)&lt;/script&gt;",
      );
      // The attribute is closed only by the markup's own quote.
      expect(letter.html.match(/"/g)).toHaveLength(2);
    });

    it.each([
      "/\\evil.example/path",
      "//evil.example/path",
      "https://evil.example",
    ])("refuses a path that resolves off the site: %s", (path) => {
      expect(() => renderLetter("Subject", "Detail", path)).toThrow(
        "Email links stay on the site",
      );
    });
  });

  describe("reply addresses", () => {
    beforeEach(() => {
      process.env.MAIL_REPLY_DOMAIN = "mail.staydesk.dev";
    });

    it("issues none without a reply domain", () => {
      delete process.env.MAIL_REPLY_DOMAIN;
      expect(replyAddress("message-1")).toBeUndefined();
    });

    it("issues an address whose hash routes back to it, in any case", () => {
      const reply = replyAddress("message-1");
      expect(reply?.address).toMatch(
        /^reply\+[0-9a-f]{48}@mail\.staydesk\.dev$/,
      );
      expect(reply && replyTokenHash(reply.address)).toBe(reply?.hash);
      expect(reply && replyTokenHash(reply.address.toUpperCase())).toBe(
        reply?.hash,
      );
    });

    it("keeps the address on a retry and changes it for a new delivery round", () => {
      expect(replyAddress("message-1")).toEqual(replyAddress("message-1"));
      expect(replyAddress("message-1", 2)?.address).not.toBe(
        replyAddress("message-1")?.address,
      );
    });

    it("stays within SMTP's 64-character local part", () => {
      const local = replyAddress("m".repeat(36), 999)?.address.split("@")[0];
      expect(local?.length).toBeLessThanOrEqual(64);
    });

    it("routes nothing for another domain or a malformed token", () => {
      const reply = replyAddress("message-1");
      const token = reply?.address.split("@")[0] ?? "";
      expect(replyTokenHash(token + "@evil.example")).toBeNull();
      expect(replyTokenHash("reply+abc@mail.staydesk.dev")).toBeNull();
      expect(replyTokenHash("someone@mail.staydesk.dev")).toBeNull();
    });

    it("signs with the secret, so another key issues another address", () => {
      const first = replyAddress("message-1")?.address;
      process.env.JWT_REFRESH_SECRET = "another-secret";
      expect(replyAddress("message-1")?.address).not.toBe(first);
    });
  });

  describe("accountMailToken", () => {
    it("is stable for one request and differs between requests", () => {
      expect(accountMailToken("a")).toBe(accountMailToken("a"));
      expect(accountMailToken("a")).not.toBe(accountMailToken("b"));
      expect(accountMailToken("a")).toMatch(/^[0-9a-f]{64}$/);
    });

    it("refuses to sign without a key", () => {
      delete process.env.JWT_REFRESH_SECRET;
      expect(() => accountMailToken("a")).toThrow("Missing mail signing key");
    });
  });
});
