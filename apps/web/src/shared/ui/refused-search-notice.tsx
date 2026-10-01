import { CompassIcon } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";

/**
 * What a list shows in place of itself when the search in the URL is one the contract
 * refuses. Nothing was asked of the API — the messages under the boxes say what is wrong,
 * and a list beside them would read as the answer to a question nobody could ask.
 *
 * The sibling of `StalePageNotice`, and here for the same reason: that one is a cursor the
 * API will not read, this one is the whole search, and both lists that page render both.
 */
export const RefusedSearchNotice = () => (
  <Empty className="border">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <CompassIcon />
      </EmptyMedia>
      <EmptyTitle>This search cannot be answered</EmptyTitle>
      <EmptyDescription>
        The messages above say what is wrong with it. Nothing was asked of the
        API — a list beside them would read as the answer.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);
