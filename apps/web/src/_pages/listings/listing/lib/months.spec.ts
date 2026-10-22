import { describe, expect, it } from "vitest";
import { buildMonths, callsForWaitlist, overlapsBooked } from "./months";

const TODAY = "2030-09-10";

describe("buildMonths", () => {
  it("lays the anchor's month out in full, whichever day the window starts on", () => {
    const [september] = buildMonths(TODAY, 1, [], TODAY);

    expect(september?.label).toBe("September 2030");
    expect(september?.days).toHaveLength(30);
    expect(september?.days.at(0)?.day).toBe("2030-09-01");
    expect(september?.days.at(-1)?.day).toBe("2030-09-30");
  });

  it("counts the months forward and rolls over the year", () => {
    const labels = buildMonths("2030-11-20", 3, [], TODAY).map(
      (month) => month.label,
    );

    expect(labels).toEqual(["November 2030", "December 2030", "January 2031"]);
  });

  it("puts the 1st under the weekday it falls on, counting from Monday", () => {
    // 1 September 2030 is a Sunday: six blanks before it.
    expect(buildMonths(TODAY, 1, [], TODAY).at(0)?.offset).toBe(6);
    // 1 December 2030 is also a Sunday; 1 January 2031 is a Wednesday.
    expect(buildMonths("2031-01-05", 1, [], TODAY).at(0)?.offset).toBe(2);
  });

  it("takes the nights of a stay and leaves its check-out day free", () => {
    const [september] = buildMonths(
      TODAY,
      1,
      [{ from: "2030-09-12", to: "2030-09-15" }],
      TODAY,
    );
    const taken = september?.days
      .filter((day) => day.taken)
      .map((day) => day.day);

    expect(taken).toEqual(["2030-09-12", "2030-09-13", "2030-09-14"]);
  });

  it("draws two back-to-back stays as one run rather than as a conflict", () => {
    const [september] = buildMonths(
      TODAY,
      1,
      [
        { from: "2030-09-12", to: "2030-09-14" },
        { from: "2030-09-14", to: "2030-09-16" },
      ],
      TODAY,
    );
    const taken = september?.days
      .filter((day) => day.taken)
      .map((day) => day.day);

    expect(taken).toEqual([
      "2030-09-12",
      "2030-09-13",
      "2030-09-14",
      "2030-09-15",
    ]);
  });

  it("keeps taking nights from a stay that began before the window", () => {
    const [september] = buildMonths(
      "2030-09-10",
      1,
      [{ from: "2030-08-28", to: "2030-09-03" }],
      TODAY,
    );

    expect(september?.days.at(0)?.taken).toBe(true);
    expect(september?.days.at(2)?.taken).toBe(false);
  });

  it("marks the days before today as past and today itself as not", () => {
    const [september] = buildMonths(TODAY, 1, [], TODAY);

    expect(september?.days.at(8)?.past).toBe(true);
    expect(september?.days.at(9)).toEqual({
      day: TODAY,
      taken: false,
      past: false,
    });
  });
});

describe("overlapsBooked", () => {
  const booked = [{ from: "2030-09-12", to: "2030-09-15" }];

  it("finds a stay that shares a night with a taken range", () => {
    expect(overlapsBooked("2030-09-10", "2030-09-13", booked)).toBe(true);
    expect(overlapsBooked("2030-09-14", "2030-09-20", booked)).toBe(true);
    expect(overlapsBooked("2030-09-01", "2030-09-30", booked)).toBe(true);
  });

  it("lets a stay end on the check-in day and start on the check-out day", () => {
    expect(overlapsBooked("2030-09-10", "2030-09-12", booked)).toBe(false);
    expect(overlapsBooked("2030-09-15", "2030-09-18", booked)).toBe(false);
  });
});

describe("callsForWaitlist", () => {
  const booked = [{ from: "2030-09-12", to: "2030-09-15" }];
  const refused = { from: "2031-01-10", to: "2031-01-14" };

  it("waits for nights the calendar draws as taken", () => {
    expect(callsForWaitlist("2030-09-10", "2030-09-13", booked, null)).toBe(
      true,
    );
  });

  it("waits for exactly the nights a hold was refused for, past the window", () => {
    expect(callsForWaitlist(refused.from, refused.to, booked, refused)).toBe(
      true,
    );
    expect(callsForWaitlist(refused.from, "2031-01-13", booked, refused)).toBe(
      false,
    );
  });
});
