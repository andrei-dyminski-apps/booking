import { Suspense } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { DELETED_USER_NAME } from "@repo/contracts";
import { ReviewSummary } from "#entities/review";
import { LogoutButton } from "#features/logout";
import { mailApi, requireUser } from "#shared/api";
import { ROUTES } from "#shared/config";
import { formatDate, readerTimeZone } from "#shared/lib";
import { ButtonLink } from "#shared/ui";
import { readReviewSummaryOf } from "../api/read-review-summary-of";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { EmailChangeDialog } from "./email-change-dialog";
import { EmailSettings } from "./email-settings";
import { PasswordChangeDialog } from "./password-change-dialog";

export const ProfilePage = async () => {
  const user = await requireUser(ROUTES.profile);
  const [reviews, zone] = await Promise.all([
    readReviewSummaryOf(user.id),
    readerTimeZone(),
  ]);
  // What hosts said about this account as a guest — any account that has stayed somewhere.
  const reviewed = reviews !== null && reviews.count > 0;

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          Read from `/auth/me` on the server, with the session cookie of this
          request forwarded straight to the API.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd>{user.name}</dd>

          <dt className="text-muted-foreground">Email</dt>
          <dd>{user.email}</dd>

          <dt className="text-muted-foreground">Role</dt>
          <dd>{user.role}</dd>

          <dt className="text-muted-foreground">Member since</dt>
          <dd>{formatDate(user.createdAt, zone)}</dd>

          {reviewed && (
            <>
              <dt className="text-muted-foreground">Reviews</dt>
              <dd>
                <ReviewSummary summary={reviews} />
              </dd>
            </>
          )}
        </dl>

        {/* What hosts said about this account — a guest's half of the reviews is not
            public, and this is where its subject reads it, whatever their role now. */}
        {reviewed && (
          <ButtonLink href={ROUTES.guestReviews(user.id)} variant="outline">
            Reviews of you
          </ButtonLink>
        )}

        <EmailChangeDialog />
        <PasswordChangeDialog email={user.email} />
        <Suspense fallback={null}>
          <ProfileEmailSettings />
        </Suspense>
        <LogoutButton />

        {/* At the end, under everything that can be undone. What it erases and what it
            keeps is said before the dialog is opened, not only inside it. */}
        <section
          aria-labelledby="delete-account-heading"
          className="flex flex-col gap-3 border-t pt-6"
        >
          <h2 id="delete-account-heading" className="text-sm font-medium">
            Delete account
          </h2>
          <p className="text-sm text-muted-foreground">
            Your name, email address and password are erased, every session ends
            and your listings come off the catalogue. The stays you took or
            hosted, their payments and their reviews stay on record under
            &ldquo;{DELETED_USER_NAME}&rdquo; — they are the other side&rsquo;s
            history too. A payout account opened with Stripe is not closed here:
            it stays with Stripe, which keeps its own records, and your share of
            a stay still owed is paid out to it after the deletion. While a
            stay, a dispute, a refund or a fee is still open, or a share is owed
            that no payout account can receive, the account cannot be deleted.
          </p>
          <DeleteAccountDialog />
        </section>
      </CardContent>
    </Card>
  );
};

async function ProfileEmailSettings() {
  const settings = await mailApi.settings().catch(() => null);
  if (settings) return <EmailSettings settings={settings} />;

  return (
    <section
      aria-labelledby="email-heading"
      className="grid gap-3 border-t pt-5"
    >
      <h2 id="email-heading" className="font-medium">
        Email notifications
      </h2>
      <p className="text-sm">Email settings are temporarily unavailable.</p>
    </section>
  );
}
