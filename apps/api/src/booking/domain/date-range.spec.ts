import { nights } from "./date-range";

describe("date range rules", () => {
  describe("nights", () => {
    it("counts whole nights between check-in and check-out", () => {
      expect(nights("2026-09-01", "2026-09-05")).toBe(4);
      expect(nights("2026-09-01", "2026-09-02")).toBe(1);
    });

    it("counts across a month boundary", () => {
      expect(nights("2026-09-29", "2026-10-02")).toBe(3);
    });
  });
});
