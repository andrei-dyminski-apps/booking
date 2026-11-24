import { expect, request } from "@playwright/test";
import { z } from "zod";

const mailpit = "http://127.0.0.1:8026/api/v1";
const summaries = z.object({
  messages: z.array(z.object({ ID: z.string(), Subject: z.string() })),
});
const message = z.object({ Text: z.string() });

export async function readMail(
  email: string,
  subject: string,
): Promise<string> {
  const inbox = await request.newContext();
  let id: string | undefined;

  try {
    await expect
      .poll(
        async () => {
          const result = await inbox.get(mailpit + "/search", {
            params: { query: "to:" + email },
          });
          id = summaries
            .parse(await result.json())
            .messages.find((letter) => letter.Subject === subject)?.ID;
          return id;
        },
        { timeout: 20_000 },
      )
      .toBeTruthy();
    if (!id) throw new Error("Mailpit did not receive " + subject);
    const result = await inbox.get(mailpit + "/message/" + id);
    return message.parse(await result.json()).Text;
  } finally {
    await inbox.dispose();
  }
}

export async function mailLink(
  email: string,
  subject: string,
  path: string,
): Promise<URL> {
  const text = await readMail(email, subject);
  const link = text
    .split("\n")
    .map((line) => URL.parse(line.trim()))
    .find(
      (url) =>
        url?.pathname === path && /^[a-f0-9]{64}$/.test(url.hash.slice(1)),
    );
  if (!link) throw new Error("Mailpit received a letter without a valid link");
  return link;
}

export function registrationLink(email: string) {
  return mailLink(
    email,
    "Finish creating your StayDesk account",
    "/complete-registration",
  );
}
