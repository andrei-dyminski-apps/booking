import { afterEach, describe, expect, it, vi } from "vitest";
import { withoutZone } from "./testing/without-zone.js";
import { canonicalTimeZone, runtimeTimeZone } from "./time-zone.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runtimeTimeZone", () => {
  it("is the stored name itself where the runtime knows it", () => {
    expect(runtimeTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
  });

  it("is the older name IANA keeps as a link where the runtime predates the rename", () => {
    withoutZone("Pacific/Kanton");

    expect(runtimeTimeZone("Pacific/Kanton")).toBe("Pacific/Enderbury");
  });

  it("is null for a zone newer than the runtime's data", () => {
    expect(runtimeTimeZone("Mars/Olympus_Mons")).toBeNull();
  });
});

describe("canonicalTimeZone", () => {
  it("lets a runtime that predates a rename check a form whose zone it knows only by the older name", () => {
    withoutZone("America/Nuuk");

    expect(canonicalTimeZone("America/Nuuk")).toBe("America/Nuuk");
  });
});
