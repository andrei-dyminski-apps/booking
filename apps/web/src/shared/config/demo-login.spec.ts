import { describe, expect, it } from "vitest";
import { findDemoLogin } from "./demo-login";
import { ROUTES } from "./routes";

describe("demo login", () => {
  it.each([
    ["guest", "/listings"],
    ["host", "/dashboard"],
    ["admin", "/admin/payments"],
  ])("links the %s account to its destination", (id, destination) => {
    const demo = findDemoLogin(id);

    expect(demo && ROUTES.demoLogin(demo.id)).toBe(`/login?demo=${id}`);
    expect(demo && ROUTES[demo.next]).toBe(destination);
  });

  it.each(["", "unknown", "constructor", "__proto__"])(
    "keeps the regular sign-in form for %j",
    (id) => {
      expect(findDemoLogin(id)).toBeUndefined();
    },
  );
});
