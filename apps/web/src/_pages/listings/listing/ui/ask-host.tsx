import type { ReactNode } from "react";
import type { Conversation } from "@repo/contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Skeleton } from "@repo/ui/components/skeleton";
import {
  ApiResponseError,
  ApiUnreachableError,
  conversationsApi,
} from "#shared/api";
import { ROUTES } from "#shared/config";
import { ButtonLink } from "#shared/ui";
import { AskHostForm } from "./ask-host-form";

/** The card every state of the box is drawn in: the sign-in link, the form, the way back. */
export const AskHostCard = ({ children }: { children: ReactNode }) => (
  <Card>
    <CardHeader>
      <CardTitle>Ask the host</CardTitle>
      <CardDescription>
        A question before you book, or about a stay you have. The answer arrives
        in your messages.
      </CardDescription>
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);

/** What the card holds while the thread is looked up — for a guest, who gets a box. */
export const AskHostSkeleton = () => (
  <AskHostCard>
    <Skeleton className="h-24 w-full rounded-xl" />
  </AskHostCard>
);

/**
 * Where a signed-in visitor writes to the host of this listing — or, once they have, the
 * way back to that thread. The page renders it inside a `Suspense` boundary, so the one
 * personal read here does not hold up the rest of the screen.
 *
 * A visitor has at most one thread per listing that is not their own, so asking for a page
 * of one filtered by it answers whether it exists; the page never renders this for the
 * listing's owner, whose threads about it are all a host's. The read is `no-store`, and it
 * is made only for a signed-in visitor: the cached reads of this page stay as public as
 * they were. The page renders it for a `USER` only — `POST /conversations` is
 * `@Roles(Role.USER)`, and an admin is a side of no thread.
 */
export const AskHost = async ({ listingId }: { listingId: string }) => {
  const existing = await existingThread(listingId);

  if (existing !== undefined) {
    return (
      <AskHostCard>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            You have already written to the host about this listing.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <ButtonLink href={ROUTES.conversation(existing.id)} size="lg">
              Open the conversation
            </ButtonLink>
          </div>
        </div>
      </AskHostCard>
    );
  }

  return (
    <AskHostCard>
      <AskHostForm listingId={listingId} />
    </AskHostCard>
  );
};

/**
 * The visitor's thread about this listing, or `undefined` — also when the API refuses or
 * cannot be reached, the way `readListingReviews` degrades: the box is a part of the screen
 * it can be drawn without. Falling back to the form costs nothing either, since a first
 * message about a listing that already has a thread continues it.
 */
async function existingThread(
  listingId: string,
): Promise<Conversation | undefined> {
  try {
    const { items } = await conversationsApi.page(
      { listingId, limit: 1 },
      { cache: "no-store" },
    );

    return items[0];
  } catch (error) {
    if (
      error instanceof ApiResponseError ||
      error instanceof ApiUnreachableError
    ) {
      return undefined;
    }

    throw error;
  }
}
