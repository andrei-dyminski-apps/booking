import { tz } from "@date-fns/tz";
import { addDays, addMonths, startOfDay, startOfMonth } from "date-fns";

const utc = { in: tz("UTC") };

export function resendQuotaRetryAt(
  reason: string | null | undefined,
  at: Date,
) {
  switch (reason) {
    case "daily_quota_exceeded":
    case "reached_daily_quota":
      return startOfDay(addDays(at, 1, utc), utc);
    case "monthly_quota_exceeded":
    case "reached_monthly_quota":
      return startOfMonth(addMonths(at, 1, utc), utc);
  }
}
