import {
  StayParty,
  type OpenMatter,
  type OpenMattersParams,
} from "@repo/contracts";
import { ROUTES } from "#shared/config";
import { filtersHref } from "#shared/lib";

export type OpenMatterLink = { href: string; label: string };

/** The two halves of the stays page, as the tabs of that page name them. */
const STAYS_OF: Record<StayParty, OpenMatterLink> = {
  [StayParty.GUEST]: { href: ROUTES.bookings, label: "Trips" },
  [StayParty.HOST]: {
    href: filtersHref(ROUTES.bookings, { side: StayParty.HOST }),
    label: "Hosting",
  },
};

const PAYOUTS: OpenMatterLink = { href: ROUTES.payouts, label: "Payouts" };

/**
 * Where a matter that keeps an account open is put right. A host's share and fee are on the
 * payouts page; a refund owed is the guest's, on their trips; a stay and a dispute are on the
 * half of the stays page the refusal says they are open on (`asGuest`, `asHost`) — both tabs
 * when both halves hold one. The sentence of each is the contract's (`OPEN_MATTER_MESSAGES`).
 */
export function openMatterLinks(
  matter: OpenMatter,
  { asGuest, asHost }: Pick<OpenMattersParams, "asGuest" | "asHost">,
): OpenMatterLink[] {
  switch (matter) {
    case "ACCOUNT_AWAITS_PAYOUT":
    case "ACCOUNT_OWES_HOST_FEE":
      return [PAYOUTS];
    case "ACCOUNT_AWAITS_REFUND":
      return [STAYS_OF[StayParty.GUEST]];
    case "ACCOUNT_HAS_OPEN_STAY":
    case "ACCOUNT_HAS_OPEN_DISPUTE":
      return [
        ...(asGuest.includes(matter) ? [STAYS_OF[StayParty.GUEST]] : []),
        ...(asHost.includes(matter) ? [STAYS_OF[StayParty.HOST]] : []),
      ];
  }
}
