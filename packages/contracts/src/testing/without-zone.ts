import { vi } from "vitest";

const RealDateTimeFormat = Intl.DateTimeFormat;

/**
 * A runtime whose zone data predates `zone`'s rename: it knows the zone by its old name
 * only. A spy on `Intl.DateTimeFormat`, so the spec that calls it restores it
 * (`vi.restoreAllMocks()` after each case).
 */
export function withoutZone(zone: string): void {
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    if (options?.timeZone?.toLowerCase() === zone.toLowerCase()) {
      throw new RangeError(`Invalid time zone specified: ${zone}`);
    }

    return new RealDateTimeFormat(locales, options);
  } as typeof Intl.DateTimeFormat);
}
