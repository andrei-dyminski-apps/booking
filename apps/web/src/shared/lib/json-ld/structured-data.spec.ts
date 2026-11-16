import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "./structured-data";

const listing = (name: string) => ({ "@type": "VacationRental", name });

describe("serializeJsonLd", () => {
  it("leaves no `</script` for an owner's title to close the block with", () => {
    const text = serializeJsonLd(
      listing("Loft</script><script>alert(1)</script>"),
    );

    expect(text).not.toMatch(/<\/script/i);
    expect(text).not.toContain("<");
  });

  it("leaves no `<!--`, which would open a comment inside the script", () => {
    expect(serializeJsonLd(listing("Cabin <!-- quiet -->"))).not.toContain(
      "<!--",
    );
  });

  it("reads back as the very text that went in", () => {
    const name = 'Loft </script> & <b>garden</b> \u2028 "quoted"';

    expect(JSON.parse(serializeJsonLd(listing(name)))).toEqual({
      "@context": "https://schema.org",
      "@type": "VacationRental",
      name,
    });
  });

  it("writes several nodes as one document's graph", () => {
    expect(
      JSON.parse(
        serializeJsonLd([
          { "@type": "Organization", name: "Booking" },
          { "@type": "WebSite", name: "Booking" },
        ]),
      ),
    ).toEqual({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Booking" },
        { "@type": "WebSite", name: "Booking" },
      ],
    });
  });

  it("leaves out a property whose value is absent", () => {
    expect(
      JSON.parse(
        serializeJsonLd({ "@type": "Thing", aggregateRating: undefined }),
      ),
    ).toEqual({ "@context": "https://schema.org", "@type": "Thing" });
  });
});
