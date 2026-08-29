import { formatDay } from "#shared/lib";
import { WEEKDAYS, type CalendarMonth } from "../lib/months";

/**
 * What the API says is already taken, drawn. It decides nothing — the form beside it will
 * happily submit dates that overlap, and the answer to that is the `409` the locking
 * transaction gives, which is the only place the question can be settled without a race.
 *
 * A server component: nothing here reacts to a click, and the whole point of the read
 * behind it is that it is cached by URL and shared between visitors.
 */
export const AvailabilityCalendar = ({
  months,
}: {
  months: CalendarMonth[];
}) => (
  <div className="flex flex-col gap-4">
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {months.map((month) => (
        <div key={month.label} className="flex flex-col gap-2">
          <p className="text-sm font-medium">{month.label}</p>

          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {WEEKDAYS.map((weekday) => (
              <span key={weekday} className="py-1 text-muted-foreground">
                {weekday}
              </span>
            ))}

            {Array.from({ length: month.offset }, (_, index) => (
              <span key={`blank-${String(index)}`} />
            ))}

            {month.days.map((day) => (
              <span
                key={day.day}
                className={
                  day.taken
                    ? "rounded-md bg-muted py-1 text-muted-foreground line-through"
                    : day.past
                      ? "py-1 text-muted-foreground/50"
                      : "rounded-md bg-primary/10 py-1 font-medium"
                }
              >
                {/*
                  Text of the cell rather than an `aria-label` on it: a `span` carries no
                  role, so it has no accessible name for a label to become, and the whole
                  sentence would be dropped in favour of the bare number. The number is
                  what says nothing on its own — which month it belongs to and whether it
                  is still on offer are exactly what a reader cannot see here — so the
                  hidden half is the real content and the digits are decoration.
                */}
                <span className="sr-only">
                  {formatDay(day.day)}:{" "}
                  {day.past ? "past" : day.taken ? "booked" : "free"}
                </span>
                <span aria-hidden="true">{day.day.slice(-2)}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>

    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm bg-primary/10" /> free
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm bg-muted" /> booked
      </span>
      {/*
        The third state the grid draws, and the one a swatch cannot show: a past day has
        no fill at all, only dimmed digits — so the sample is a digit.
      */}
      <span className="flex items-center gap-1.5">
        <span className="text-muted-foreground/50" aria-hidden="true">
          01
        </span>{" "}
        past
      </span>
    </div>
  </div>
);
