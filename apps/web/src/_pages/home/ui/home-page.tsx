import { ArrowRightIcon } from "lucide-react";
import { ActorKind } from "@repo/contracts";
import { currentUser } from "#shared/api";
import { ACCOUNT_DELETED_PARAM, ROUTES, SITE_NAME } from "#shared/config";
import { singleParam } from "#shared/lib";
import { ButtonLink } from "#shared/ui";

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

      <section className="flex flex-col items-start gap-6 pt-2 sm:pt-6">
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Book a stay on {SITE_NAME}
          </h1>
          <p className="max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">
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
    </div>
  );
};
