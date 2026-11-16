import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { ROUTES } from "#shared/config";
import { toLocalPath } from "#shared/lib";
import { LoginForm } from "./login-form";

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
  // Where the proxy wanted to send this visitor before it found no session.
  const next = toLocalPath((await searchParams).next, ROUTES.profile);

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Welcome back. Your session is a pair of httpOnly cookies — nothing is
          kept in this tab.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <LoginForm next={next} />

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
