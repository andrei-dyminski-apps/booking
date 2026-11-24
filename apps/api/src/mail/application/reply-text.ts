import { htmlToText } from "html-to-text";
import type { ReceivedLetter } from "./ports/mail-gateway";

const OUTLOOK_HEADER = "\u0000";
const OUTLOOK_QUOTED_BODY = "\u0001";

export function isAutomaticReply(letter: ReceivedLetter): boolean {
  const headers = new Map(
    Object.entries(letter.headers ?? {}).map(([name, value]) => [
      name.toLowerCase(),
      value.trim().toLowerCase(),
    ]),
  );
  const submitted = headers.get("auto-submitted")?.split(";")[0]?.trim();
  const precedence = headers.get("precedence");
  const contentType = headers.get("content-type") ?? "";
  return (
    (!!submitted && submitted !== "no") ||
    precedence === "bulk" ||
    precedence === "junk" ||
    precedence === "list" ||
    headers.has("x-autoreply") ||
    headers.has("x-autorespond") ||
    headers.get("return-path") === "<>" ||
    contentType.startsWith("multipart/report") ||
    contentType.startsWith("message/delivery-status")
  );
}

function replyHtml(html: string) {
  let removedHistory = false;
  let outlookHeaderSeen = false;
  let outlookBodyMarked = false;
  const text = htmlToText(html, {
    wordwrap: false,
    formatters: {
      omitHistory: () => {
        removedHistory = true;
      },
      blockquote: (_element, _walk, builder) => {
        removedHistory = true;
        if (outlookHeaderSeen && !outlookBodyMarked) {
          builder.addLiteral(OUTLOOK_QUOTED_BODY);
          outlookBodyMarked = true;
        }
      },
      outlookHeader: (_element, _walk, builder) => {
        removedHistory = true;
        outlookHeaderSeen = true;
        builder.addLiteral(OUTLOOK_HEADER);
      },
    },
    selectors: [
      { selector: "blockquote", format: "blockquote" },
      { selector: ".gmail_quote", format: "omitHistory" },
      { selector: ".gmail_attr", format: "omitHistory" },
      { selector: ".gmail_signature", format: "omitHistory" },
      { selector: ".moz-cite-prefix", format: "omitHistory" },
      { selector: ".moz-signature", format: "omitHistory" },
      { selector: "#AppleMailSignature", format: "omitHistory" },
      { selector: "#divRplyFwdMsg", format: "outlookHeader" },
      { selector: "img", format: "skip" },
    ],
  });
  const [beforeHeader = "", afterHeader] = text.split(OUTLOOK_HEADER, 2);
  if (afterHeader === undefined) return { text, removedHistory };

  // A leading blockquote marks the end of Outlook history. Without that
  // boundary, the body following the header can be entirely quoted text.
  const beforeQuote = beforeHeader.replace(/(?:^|\n)[ \t]*-{3,}\s*$/, "");
  const afterQuote = afterHeader.trimStart();
  return {
    text: afterQuote.startsWith(OUTLOOK_QUOTED_BODY)
      ? [beforeQuote, afterQuote.slice(1)].join("\n\n")
      : beforeQuote,
    removedHistory,
  };
}

export function replyText(letter: ReceivedLetter) {
  const html = letter.html ? replyHtml(letter.html) : undefined;
  const plain = stripPlainHistory(letter.text ?? "");
  // Some clients put inline answers inside the HTML quote, while the plain
  // part still marks the quoted lines individually.
  const reply =
    html && (html.removedHistory ? !plain.hasInlineReply : !letter.text?.trim())
      ? stripPlainHistory(html.text).text || plain.text
      : plain.text;
  // An address left over from quoted history can still authorize a reply.
  return reply.replace(
    /(?:mailto:)?reply\+[0-9a-f]{48}@[a-z0-9-]+(?:\.[a-z0-9-]+)*/gi,
    "[reply address removed]",
  );
}

function stripPlainHistory(value: string) {
  const lines = value.split(/\r?\n/);
  const reply: string[] = [];
  let sawQuote = false;
  let hasInlineReply = false;
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] ?? "";
    const line = raw.trim();
    if (line.startsWith(">")) {
      sawQuote = true;
      continue;
    }
    if (/^(?:--$|_{4,}|-{3,}\s*(?:Original|Forwarded) Message)/i.test(line))
      break;
    if (
      /^(?:Sent from (?:my (?:iPhone|iPad|Android(?: device)?)|Mail for Windows)|Get Outlook for (?:iOS|Android))[.!]?$/i.test(
        line,
      )
    )
      break;

    if (/^(?:On|Le)\s/i.test(line)) {
      const attributionEnd = lines
        .slice(index, index + 3)
        .findIndex((part) => /(?:\bwrote|\ba écrit)\s*:\s*(?:>|$)/i.test(part));
      if (attributionEnd >= 0) {
        const following = lines
          .slice(index + attributionEnd + 1)
          .find((part) => part.trim());
        // A quote with explicit markers can be stripped line by line.
        if (
          /:\s*>/.test(lines[index + attributionEnd] ?? "") ||
          following?.trimStart().startsWith(">")
        ) {
          sawQuote ||= /:\s*>/.test(lines[index + attributionEnd] ?? "");
          index += attributionEnd;
          continue;
        }
        break;
      }
    }
    const next = lines[index + 1]?.trim();
    if (
      /^(?:From|De|Von)\s*:\s/i.test(line) &&
      /^(?:Sent|Date|To|Subject|Envoyé|À|Objet|Gesendet|An|Betreff)\s*:\s/i.test(
        next ?? "",
      )
    )
      break;
    if (line && sawQuote) hasInlineReply = true;
    reply.push(raw);
  }
  return { text: reply.join("\n").trim(), hasInlineReply };
}
