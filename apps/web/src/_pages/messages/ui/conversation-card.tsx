import Link from "next/link";
import type { Conversation } from "@repo/contracts";
import { Badge } from "@repo/ui/components/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { authorLabel, counterpartName } from "#entities/conversation";
import { ROUTES } from "#shared/config";
import { formatMoment } from "#shared/lib";

/**
 * One thread: the listing it is about, the person on the other side of it — by name, so a
 * host with two guests asking about one listing can tell the threads apart — and the
 * newest message under it. The whole card is the link into the thread; the
 * listing's own page is not offered from here, because a retired listing is a `404` there
 * while its thread goes on.
 */
export const ConversationCard = ({
  conversation,
}: {
  conversation: Conversation;
}) => {
  const { lastMessage } = conversation;

  return (
    <Card className="relative transition-colors hover:bg-muted/50">
      <CardHeader>
        <CardTitle>
          {/* The link stretches over the card, so the title stays the accessible name. */}
          <Link
            href={ROUTES.conversation(conversation.id)}
            className="after:absolute after:inset-0"
          >
            {conversation.listing.title}
          </Link>
        </CardTitle>
        <CardDescription>
          With {counterpartName(conversation)} ·{" "}
          {formatMoment(lastMessage.createdAt)} UTC
        </CardDescription>
        {conversation.unread && (
          <CardAction>
            <Badge>New</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <p className="line-clamp-2 text-sm break-words text-muted-foreground">
          <span className="font-medium text-foreground">
            {authorLabel(conversation, lastMessage.sender)}:
          </span>{" "}
          {lastMessage.body}
        </p>
      </CardContent>
    </Card>
  );
};
