import { notFound } from "next/navigation";
import { MessagesSquareIcon } from "lucide-react";
import {
  conversationQuerySchema,
  Role,
  type ConversationQuery,
} from "@repo/contracts";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import {
  conversationsApi,
  pageOrNullOnStaleCursor,
  requireUser,
} from "#shared/api";
import { ROUTES } from "#shared/config";
import { filtersHref, singleParam } from "#shared/lib";
import {
  ButtonLink,
  LiveRefresh,
  PageHeading,
  Pager,
  StalePageNotice,
} from "#shared/ui";
import { ConversationCard } from "./conversation-card";

/**
 * The threads the visitor is a side of, the most recently written-to first. Unlike
 * `/bookings`, the scope is the account's rather than the role's: `GET /conversations`
 * answers the threads the caller started as a guest and the ones about their listings,
 * so a host promoted from a guest keeps what they wrote before. The role only decides
 * what to call the list. An admin is a side of none of them, and the API refuses them
 * the route; to them this is a URL with nothing behind it.
 *
 * The read is personal, so it is `no-store` and carries no tag. The only parameter the
 * address carries is the cursor: the list has one ordering and nothing to filter by.
 */
const SCOPE = {
  [Role.USER]: {
    title: "Messages",
    lead: "Your conversations with hosts, the most recent first.",
    empty:
      "You have not written to a host yet. Every listing has a box for a question.",
  },
  [Role.OWNER]: {
    title: "Messages",
    lead: "What guests have asked about your listings, and what you asked hosts, the most recent first.",
    empty: "No guest has written about your listings yet.",
  },
} as const;

export const MessagesPage = async ({
  searchParams,
}: PageProps<"/messages">) => {
  const viewer = await requireUser(ROUTES.messages);

  if (viewer.role === Role.ADMIN) notFound();

  const query: ConversationQuery = conversationQuerySchema.parse({
    cursor: singleParam((await searchParams).cursor),
  });
  const page = await pageOrNullOnStaleCursor(
    () => conversationsApi.page(query, { cache: "no-store" }),
    query.cursor,
  );
  const scope = SCOPE[viewer.role];

  return (
    <div className="flex flex-col gap-6">
      <PageHeading title={scope.title} description={scope.lead} />

      {/* A new message moves its thread to the top; a read elsewhere un-bolds it. */}
      {query.cursor === undefined && (
        <LiveRefresh on={["message.created", "conversation.read"]} />
      )}

      {page === null && <StalePageNotice firstPageHref={ROUTES.messages} />}

      {page !== null &&
        (page.items.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessagesSquareIcon />
              </EmptyMedia>
              <EmptyTitle>No conversations yet</EmptyTitle>
              <EmptyDescription>{scope.empty}</EmptyDescription>
            </EmptyHeader>
            {viewer.role === Role.USER && (
              <EmptyContent>
                <ButtonLink href={ROUTES.catalogue}>
                  Browse the stays
                </ButtonLink>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <ul role="list" className="flex flex-col gap-3">
            {page.items.map((conversation) => (
              <li key={conversation.id}>
                <ConversationCard conversation={conversation} />
              </li>
            ))}
          </ul>
        ))}

      {page !== null && (
        <Pager
          nextHref={
            page.nextCursor !== null
              ? filtersHref(ROUTES.messages, {}, page.nextCursor)
              : null
          }
          firstHref={query.cursor !== undefined ? ROUTES.messages : null}
        />
      )}
    </div>
  );
};
