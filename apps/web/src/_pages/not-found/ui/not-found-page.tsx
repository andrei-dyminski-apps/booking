import Link from "next/link";
import { CompassIcon } from "lucide-react";
import { buttonVariants } from "@repo/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import { ROUTES } from "#shared/config";

/**
 * What `notFound()` renders, and it is reached far more often than by a mistyped URL:
 * every id that cannot name a row arrives here (`requireId`, `orNotFound`), so does a
 * retired listing, and so does an owner's section opened by somebody who is not one —
 * a wrong role is answered with nothing rather than with a message explaining what they
 * are missing.
 */
export const NotFoundPage = () => (
  <Empty className="border">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <CompassIcon />
      </EmptyMedia>
      <EmptyTitle>There is nothing at this address</EmptyTitle>
      <EmptyDescription>
        The page may have been retired, or the link may name a row that no
        longer exists.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Link href={ROUTES.catalogue} className={buttonVariants()}>
        Browse the stays
      </Link>
      <Link href={ROUTES.home} className={buttonVariants({ variant: "ghost" })}>
        Back to the start
      </Link>
    </EmptyContent>
  </Empty>
);
