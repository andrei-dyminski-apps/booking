import { z } from "zod";
import {
  CancellationPolicy,
  createListingSchema,
  type CancellationPolicy as PolicyName,
  type CreateListingInput,
  type ListingDetail,
  type Weekday,
  weekdaySchema,
} from "@repo/contracts";
import { centsFromInput, inputOfCents } from "#shared/lib";

/**
 * What the boxes of the listing form hold. A price is typed in the currency — `120.50` —
 * and travels in cents, so its box holds the text as typed and the schema below converts
 * it. The boxes keep the contract's names (`pricePerNightCents`, `priceCents`) although
 * what they hold is not cents yet: a refusal comes back under the contract's path, from
 * the browser's parse and from the API's alike, and one name for both is what puts it
 * under the right box.
 */
export type ListingFormValues = {
  title: string;
  description: string;
  pricePerNightCents: string;
  /** `setValueAs: toNumber` has already made it a number, or `undefined` for an empty box. */
  capacity: number | undefined;
  cancellationPolicy: PolicyName;
  pricing: {
    weekdays: Partial<Record<Weekday, string>>;
    dates: { date: string; priceCents: string }[];
  };
};

const priceBox = z.string().catch("");

/**
 * The boxes onto the contract: every price through `centsFromInput`, everything else as it
 * is, and then `createListingSchema` — which is what refuses and words every rule, so the
 * form states none of its own. The step in between is typed `unknown` on purpose: what it
 * produces is a claim the contract is about to judge, not a `CreateListingInput` yet.
 */
export const listingFormSchema = z
  .object({
    // Only the shape the conversion reads is checked here; what the boxes hold is judged by
    // the contract below, so the rest passes through untouched. A price that is not text at
    // all — a box set or reset to nothing — reads as an empty one, so the refusal is the
    // contract's "required" rather than zod's own "expected string".
    title: z.custom<string>(),
    description: z.custom<string>(),
    pricePerNightCents: priceBox,
    capacity: z.custom<number | undefined>(),
    cancellationPolicy: z.custom<PolicyName>(),
    pricing: z.object({
      weekdays: z.partialRecord(weekdaySchema, priceBox),
      dates: z.array(
        z.object({ date: z.custom<string>(), priceCents: priceBox }),
      ),
    }),
  })
  .transform((values): unknown => ({
    ...values,
    pricePerNightCents: centsFromInput(values.pricePerNightCents),
    pricing: {
      weekdays: Object.fromEntries(
        Object.entries(values.pricing.weekdays).map(([weekday, price]) => [
          weekday,
          price === undefined ? undefined : centsFromInput(price),
        ]),
      ),
      dates: values.pricing.dates.map(({ date, priceCents }) => ({
        date,
        priceCents: centsFromInput(priceCents),
      })),
    },
  }))
  .pipe(createListingSchema) satisfies z.ZodType<
  CreateListingInput,
  ListingFormValues
>;

/**
 * The boxes of a listing being edited, or empty ones for a new listing. A date price
 * before `earliest` cannot be saved, and the cached row this form is filled from can still
 * hold one that has passed since it was read — those are left off rather than handed back
 * to be refused.
 */
export function listingFormValues(
  listing: ListingDetail | undefined,
  earliest: string,
): ListingFormValues {
  return {
    title: listing?.title ?? "",
    description: listing?.description ?? "",
    pricePerNightCents:
      listing === undefined ? "" : inputOfCents(listing.pricePerNightCents),
    capacity: listing?.capacity,
    // A new listing starts on the database's own default.
    cancellationPolicy:
      listing?.cancellationPolicy ?? CancellationPolicy.FLEXIBLE,
    pricing: {
      weekdays: Object.fromEntries(
        Object.entries(listing?.pricing.weekdays ?? {}).map(
          ([weekday, price]) => [
            weekday,
            price === undefined ? undefined : inputOfCents(price),
          ],
        ),
      ),
      dates: (listing?.pricing.dates ?? [])
        .filter(({ date }) => date >= earliest)
        .map(({ date, priceCents }) => ({
          date,
          priceCents: inputOfCents(priceCents),
        })),
    },
  };
}
