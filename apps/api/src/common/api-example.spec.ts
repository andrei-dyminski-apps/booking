import { globSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

type Example = { name: string; schema: z.ZodType; example: unknown };

const SOURCES = join(__dirname, "..");

/**
 * Every example a DTO hands to /docs, found by loading the DTO files rather than listed
 * here, so a new one is checked by existing.
 */
function examples(): Example[] {
  const modules = globSync("**/dto/*.dto.ts", { cwd: SOURCES }).map((file) =>
    jest.requireActual<Record<string, unknown>>(join(SOURCES, file)),
  );

  return modules.flatMap((exported) =>
    Object.entries(exported).flatMap(([name, value]): Example[] => {
      const schema: unknown =
        typeof value === "function" && "schema" in value
          ? value.schema
          : undefined;

      if (!(schema instanceof z.ZodType)) return [];

      const meta = schema.meta();

      return meta !== undefined && "example" in meta
        ? [{ name, schema, example: meta.example }]
        : [];
    }),
  );
}

describe("withExample", () => {
  // The type keeps an example to the shape of the contract; a length, a range or a rule
  // across fields only parsing can see, and /docs offering a body the API refuses is the
  // bug this exists to stop.
  it("offers only bodies their own schemas accept", () => {
    const found = examples();

    expect(found.length).toBeGreaterThanOrEqual(16);
    expect(
      found
        .filter(({ schema, example }) => !schema.safeParse(example).success)
        .map(({ name }) => name),
    ).toEqual([]);
  });
});
