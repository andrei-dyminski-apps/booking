import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { requireGuest } from "#shared/api";
import { DEMO_LOGIN_PARAM, ROUTES } from "#shared/config";
import { singleParam, toLocalPath } from "#shared/lib";
import { loginAction } from "../api/login-action";
import { LoginForm } from "./login-form";

// Public demo accounts from the seed and the README.
const DEMO_PASSWORD = "password123";
const DEMO_LOGINS = {
  guest: { email: "guest@example.com", next: ROUTES.catalogue },
  host: { email: "owner@example.com", next: ROUTES.dashboard },
  admin: { email: "admin@example.com", next: ROUTES.adminPayments },
} as const;

/**
 * A form rather than content, and every `?next=` is another address of it: kept out of
 * the index with its links still followed. Not a `Disallow` in `robots.txt`, which would
 * stop a crawler from reading the `noindex` at all.
 */
export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: true },
};

export const LoginPage = async ({ searchParams }: PageProps<"/login">) => {
  await requireGuest();

  const params = await searchParams;
  const role = singleParam(params[DEMO_LOGIN_PARAM]);
  const demo =
    role === "guest" || role === "host" || role === "admin"
      ? DEMO_LOGINS[role]
      : undefined;
  const next = toLocalPath(params.next, ROUTES.profile);

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          {demo
            ? `The demo ${role} account is prefilled. Sign in to continue.`
            : "Welcome back. Your session is a pair of httpOnly cookies — nothing is kept in this tab."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {params.passwordReset === "1" && (
          <p role="status" className="text-sm">
            Password updated. Sign in with your new password.
          </p>
        )}
        <LoginForm
          key={demo?.email ?? "regular"}
          next={next}
          action={loginAction.bind(null, next, demo)}
          initialCredentials={
            demo ? { email: demo.email, password: DEMO_PASSWORD } : undefined
          }
        />

        <Link
          href={ROUTES.forgotPassword}
          className="text-sm underline underline-offset-4"
        >
          Forgot password?
        </Link>

        <p className="text-sm text-muted-foreground">
          No account yet?{" "}
          <Link
            href={{ pathname: ROUTES.register, query: { next } }}
            className="text-foreground underline underline-offset-4"
          >
            Create one
          </Link>
        </p>
      </CardContent>
    </Card>
  );
};
