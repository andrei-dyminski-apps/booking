import {
  ArrowRightIcon,
  BanknoteIcon,
  BracesIcon,
  CreditCardIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LayersIcon,
  RadioIcon,
  RocketIcon,
  SearchIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";
import { ActorKind } from "@repo/contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { currentUser } from "#shared/api";
import { ACCOUNT_DELETED_PARAM, ROUTES, SITE_NAME } from "#shared/config";
import { singleParam } from "#shared/lib";
import { ButtonLink } from "#shared/ui";

const REPOSITORY = "https://github.com/andrei-dyminski-apps/booking";

export const HomePage = async ({ searchParams }: PageProps<"/">) => {
  const user = await currentUser();
  const deleted =
    singleParam((await searchParams)[ACCOUNT_DELETED_PARAM.key]) ===
    ACCOUNT_DELETED_PARAM.value;

  return (
    <div className="flex flex-col gap-10 sm:gap-14">
      {user === null && deleted && (
        <p
          role="status"
          className="rounded-lg border bg-muted px-4 py-3 text-sm"
        >
          Your account has been deleted. Your past stays stay on record without
          your name, and the email address is free to register again.
        </p>
      )}

      <section className="flex flex-col items-start gap-6">
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Book a stay on {SITE_NAME}
          </h1>
          <p className="text-base text-pretty text-muted-foreground sm:text-lg">
            Find a place for your dates, hold it for 15 minutes and confirm your
            booking with a Stripe test payment.
          </p>
        </div>

        {user === null && process.env.DEMO_PASSWORD && (
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href={ROUTES.demoLogin(ActorKind.GUEST)} size="lg">
              Sign in as demo guest
              <ArrowRightIcon />
            </ButtonLink>
            <ButtonLink href={ROUTES.demoLogin(ActorKind.HOST)} size="lg">
              Sign in as demo host
              <ArrowRightIcon />
            </ButtonLink>
            <ButtonLink href={ROUTES.demoLogin(ActorKind.ADMIN)} size="lg">
              Sign in as demo admin
              <ArrowRightIcon />
            </ButtonLink>
          </div>
        )}
      </section>

      <section
        aria-labelledby="highlights-heading"
        className="flex flex-col gap-5"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2
            id="highlights-heading"
            className="text-xl font-semibold tracking-tight sm:text-2xl"
          >
            Under the hood, click for details
          </h2>
          <ButtonLink href={REPOSITORY} variant="outline">
            Source on GitHub
            <ExternalLinkIcon />
          </ButtonLink>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HIGHLIGHTS.map(({ title, description, section, icon: Icon }) => (
            <a
              key={title}
              href={`${REPOSITORY}#${section}`}
              target="_blank"
              className="flex rounded-xl outline-none focus-visible:ring-3 ring-ring/50 hover:ring-3 transition-shadow duration-200"
              rel="noreferrer"
            >
              <Card className="w-full">
                <CardHeader className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="grid size-8 place-items-center rounded-lg bg-muted"
                  >
                    <Icon className="size-4" />
                  </span>
                  <CardTitle>{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{description}</CardDescription>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
};

const HIGHLIGHTS: {
  title: string;
  description: string;
  /** The heading anchor of the root README the tile links to. */
  section: string;
  icon: LucideIcon;
}[] = [
  {
    title: "No double bookings",
    description:
      "A row lock queues competing holds, an EXCLUDE constraint over the date range makes overlapping stays unwritable, and a BullMQ job releases an unpaid hold on time.",
    section: "concurrent-booking",
    icon: ShieldCheckIcon,
  },
  {
    title: "Authorize, then capture",
    description:
      "The 15-minute hold is a Stripe authorization captured on confirmation; signed webhooks land in an inbox that an idempotent worker drains with backoff.",
    section: "payments",
    icon: CreditCardIcon,
  },
  {
    title: "Payouts through Connect",
    description:
      "Hosts are paid through Stripe Connect once a stay begins, with the fees they owe withheld, and refunds follow a cancellation policy frozen onto each stay.",
    section: "payments",
    icon: BanknoteIcon,
  },
  {
    title: "One contract, two sides",
    description:
      "Zod schemas validate requests in Nest, parse responses and forms in Next, hold the price and refund rules both sides compute with, and brand money as whole cents.",
    section: "api-contract",
    icon: BracesIcon,
  },
  {
    title: "Rotating sessions",
    description:
      "argon2id and a JWT pair in httpOnly cookies, re-issued by a same-origin BFF proxy; reusing a burned refresh token revokes its whole family.",
    section: "authentication",
    icon: KeyRoundIcon,
  },
  {
    title: "Live notifications",
    description:
      "One Server-Sent Events stream per browser, shared between its tabs, fanned out across API instances through Redis pub/sub and self-correcting on every event.",
    section: "notifications-and-the-event-stream",
    icon: RadioIcon,
  },
  {
    title: "Feature-sliced frontend",
    description:
      "Next.js 16 App Router laid out by Feature-Sliced Design and checked by Steiger, forms on react-hook-form posting to Server Actions, a shadcn design system as its own package.",
    section: "interface",
    icon: LayersIcon,
  },
  {
    title: "A catalogue worth linking",
    description:
      "Filters live in the URL, pages are keyset rather than offset, server renders are cached and tagged, and JSON-LD with a sitemap is there for crawlers.",
    section: "the-catalogue",
    icon: SearchIcon,
  },
  {
    title: "Tested and shipped",
    description:
      "Unit, API e2e and Playwright suites on a hermetic stack run in CI on every push; the web deploys to Vercel, the API to Railway as code, migrations first.",
    section: "continuous-integration",
    icon: RocketIcon,
  },
];
