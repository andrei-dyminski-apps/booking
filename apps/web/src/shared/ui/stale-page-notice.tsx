import { LinkIcon } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import { ButtonLink } from "./button-link";

/**
 * What a keyset list shows in place of a page when the cursor in the URL is one the API
 * will not read — typed by hand, or written under an ordering that has since changed. The
 * search itself is unaffected; only the place in it was lost, so the way out is this
 * list's own first page.
 *
 * Both lists that page render it, which is why it sits in `shared/ui` rather than in
 * either slice.
 */
export const StalePageNotice = ({
  firstPageHref,
}: {
  firstPageHref: string;
}) => (
  <Empty className="border">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <LinkIcon />
      </EmptyMedia>
      <EmptyTitle>That page is no longer there</EmptyTitle>
      <EmptyDescription>
        The link points at a page that can no longer be found. The search itself
        still works.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <ButtonLink href={firstPageHref} variant="outline">
        Start from the first page
      </ButtonLink>
    </EmptyContent>
  </Empty>
);
