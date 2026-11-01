import { lookupOptionSchema } from "@repo/contracts";

/**
 * An id no lookup named, cut to its first block — enough for a chip to tell two apart.
 * Only a uuid is cut: anything else is a value the contract refused, and cutting it would
 * hide what was typed — the chip is what takes that refusal off again.
 */
export function shortId(value: string): string {
  return lookupOptionSchema.shape.id.safeParse(value).success
    ? `${value.slice(0, 8)}…`
    : value;
}
