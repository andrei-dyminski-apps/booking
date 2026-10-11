import Link from "next/link";
import { notFound } from "next/navigation";
import { messageQuerySchema, Role, type MessageQuery } from "@repo/contracts";
import { cn } from "@repo/ui/lib/utils";
import { authorLabel, counterpartName } from "#entities/conversation";
import {
  conversationsApi,
  pageOrNullOnStaleCursor,
  requireUser,
  type ReadOptions,
} from "#shared/api";
import { ROUTES } from "#shared/config";
import {
  filtersHref,
  formatMoment,
  orNotFound,
  requireId,
  singleParam,
} from "#shared/lib";
import { BackLink, ButtonLink, StalePageNotice } from "#shared/ui";
import { MarkRead } from "./mark-read";
import { SendMessageForm } from "./send-message-form";

/** Personal, like every read of a thread: never cached, never tagged. */
const THREAD_READ: ReadOptions = { cache: "no-store" };

/**
 * One thread, read from its end. The API pages it newest first, so a page is turned the
 * other way round to be drawn in the order it was written, and "earlier" is the cursor the
 * last page issued. The address carries that cursor and nothing else.
 *
 * Who is speaking is said by name, never by address — see `entities/conversation`. Somebody who is
 * neither side gets the API's `404`, and an admin the same: the API refuses them the
 * route, and a thread is not a section of theirs.
 */
export const ConversationPage = async ({
  params,
  searchParams,
}: PageProps<"/messages/[id]">) => {
  const id = requireId((await params).id);
  const viewer = await requireUser(ROUTES.conversation(id));

  if (viewer.role === Role.ADMIN) notFound();

  const query: MessageQuery = messageQuerySchema.parse({
    cursor: singleParam((await searchParams).cursor),
  });

  const [conversation, page] = await Promise.all([
    orNotFound(conversationsApi.get(id, THREAD_READ)),
    orNotFound(
      pageOrNullOnStaleCursor(
        () => conversationsApi.messages(id, query, THREAD_READ),
        query.cursor,
      ),
    ),
  ]);
  const latestHref = ROUTES.conversation(id);
  const { side } = conversation;
  // The form is remounted whenever the thread gains a message, and that is how it empties
  // after a send: the action ends in a redirect to this page, which keeps a client
  // component's state, and a new newest message is the one thing that says the send landed.
  const latest = conversation.lastMessage.createdAt;
  // Only the newest page shows the end of the thread, and what it shows is what is read:
  // its first item, which may be newer or older than `latest` — the two reads race.
  const newestShown = query.cursor === undefined ? page?.items[0] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <BackLink href={ROUTES.messages}>All messages</BackLink>

        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {conversation.listing.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            Your conversation with {counterpartName(conversation)}.{" "}
            {/* The catalogue page answers 404 for a retired listing; the thread goes on. */}
            <Link
              href={ROUTES.listing(conversation.listingId)}
              className="text-primary underline-offset-4 hover:underline"
            >
              See the listing
            </Link>
          </p>
        </div>
      </div>

      {conversation.unread && newestShown !== undefined && (
        <MarkRead conversationId={id} upTo={newestShown.createdAt} />
      )}

      {page === null ? (
        <StalePageNotice firstPageHref={latestHref} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {page.nextCursor !== null && (
              <ButtonLink
                href={filtersHref(latestHref, {}, page.nextCursor)}
                variant="outline"
                size="sm"
              >
                Earlier messages
              </ButtonLink>
            )}
            {query.cursor !== undefined && (
              <ButtonLink href={latestHref} variant="ghost" size="sm">
                Back to the latest
              </ButtonLink>
            )}
          </div>

          <ol role="list" className="flex flex-col gap-3">
            {[...page.items].reverse().map((message) => {
              const mine = message.sender === side;

              return (
                <li
                  key={message.id}
                  className={cn(
                    "flex max-w-[85%] flex-col gap-1 sm:max-w-[70%]",
                    mine ? "items-end self-end" : "items-start self-start",
                  )}
                >
                  <span className="text-xs text-muted-foreground">
                    {authorLabel(conversation, message.sender)} ·{" "}
                    {formatMoment(message.createdAt)} UTC
                  </span>
                  <p
                    className={cn(
                      "rounded-xl px-3 py-2 text-sm break-words whitespace-pre-wrap",
                      mine
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {message.body}
                  </p>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <SendMessageForm key={latest} conversationId={id} />
    </div>
  );
};
