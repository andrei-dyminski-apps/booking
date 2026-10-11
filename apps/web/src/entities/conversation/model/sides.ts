import { ConversationSide, type Conversation } from "@repo/contracts";

/**
 * Who is who in a thread, as the person reading it sees it. A message says only which side
 * wrote it, and the thread carries the name of each side — never an address, which neither
 * of the two is entitled to read. Read by the list of threads and by a thread itself, so
 * one person is named the same way on both.
 */

/** The name of one side of this thread. */
export function nameOf(
  conversation: Conversation,
  side: ConversationSide,
): string {
  return side === ConversationSide.GUEST
    ? conversation.guest.name
    : conversation.host.name;
}

/** The other person, as the one reading the thread calls them. */
export function counterpartName(conversation: Conversation): string {
  return nameOf(
    conversation,
    conversation.side === ConversationSide.GUEST
      ? ConversationSide.HOST
      : ConversationSide.GUEST,
  );
}

/** Who wrote a message: "You" for the reader's own, the other person's name otherwise. */
export function authorLabel(
  conversation: Conversation,
  sender: ConversationSide,
): string {
  return sender === conversation.side ? "You" : nameOf(conversation, sender);
}
