import {
  ConversationSide,
  type Conversation,
  type Message,
} from "@repo/contracts";
import { encodeParts } from "../common/paging";
import {
  decodeConversationCursor,
  decodeMessageCursor,
  encodeConversationCursor,
  encodeMessageCursor,
} from "./conversation-cursor";

const conversation: Conversation = {
  id: "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a",
  listingId: "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b",
  listing: { title: "Loft above the harbour" },
  guestId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  guest: { name: "Maya Lindqvist" },
  host: { name: "Tomas Berg" },
  side: ConversationSide.GUEST,
  lastMessage: {
    sender: ConversationSide.HOST,
    body: "Welcome",
    createdAt: "2026-08-20T12:00:00.000Z",
  },
  unread: true,
  createdAt: "2026-08-19T12:00:00.000Z",
};

const message: Message = {
  id: "4d3c2b1a-0f9e-4d7c-8b6a-5f4e3d2c1b0a",
  conversationId: conversation.id,
  sender: ConversationSide.GUEST,
  body: "Hello",
  createdAt: "2026-08-20T11:00:00.000Z",
};

/** A cursor spelled by hand, with the resource tag the envelope adds. */
const raw = (resource: string, ...parts: string[]): string =>
  Buffer.from([resource, ...parts].join("|")).toString("base64url");

/** Untrusted input like every other cursor here, so what matters is what it refuses. */
describe("conversation cursor", () => {
  it("carries the moment of the newest message and the id", () => {
    expect(
      decodeConversationCursor(encodeConversationCursor(conversation)),
    ).toEqual({
      sort: "recent",
      lastMessageAt: new Date(conversation.lastMessage.createdAt),
      id: conversation.id,
    });
  });

  it("refuses anything it did not write", () => {
    const { createdAt } = conversation.lastMessage;

    for (const value of [
      "",
      "not-a-cursor",
      raw("conversations", "newest", createdAt, conversation.id),
      raw("conversations", "recent", "yesterday", conversation.id),
      raw("conversations", "recent", createdAt, "not-a-uuid"),
      raw("conversations", "recent", createdAt),
    ]) {
      expect(decodeConversationCursor(value)).toBeNull();
    }
  });

  it("refuses a cursor another list of this API issued", () => {
    expect(decodeConversationCursor(encodeMessageCursor(message))).toBeNull();
    expect(
      decodeConversationCursor(
        encodeParts("bookings", "recent", message.createdAt, message.id),
      ),
    ).toBeNull();
  });
});

describe("message cursor", () => {
  it("carries the moment the message was written and the id", () => {
    expect(decodeMessageCursor(encodeMessageCursor(message))).toEqual({
      sort: "newest",
      createdAt: new Date(message.createdAt),
      id: message.id,
    });
  });

  it("refuses anything it did not write", () => {
    for (const value of [
      "",
      raw("messages", "oldest", message.createdAt, message.id),
      raw("messages", "newest", "yesterday", message.id),
      raw("messages", "newest", message.createdAt, "not-a-uuid"),
    ]) {
      expect(decodeMessageCursor(value)).toBeNull();
    }
  });

  /** The `newest` of the stays is a timestamp and a uuid as well; the tag tells them apart. */
  it("refuses a cursor another list of this API issued", () => {
    expect(
      decodeMessageCursor(
        encodeParts("bookings", "newest", message.createdAt, message.id),
      ),
    ).toBeNull();
    expect(
      decodeMessageCursor(encodeConversationCursor(conversation)),
    ).toBeNull();
  });
});
