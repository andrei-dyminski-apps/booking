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
import { RegisterForm } from "./register-form";

/**
 * A form rather than content, and every `?next=` is another address of it: kept out of
 * the index with its links still followed. Not a `Disallow` in `robots.txt`, which would
 * stop a crawler from reading the `noindex` at all.
 */
export const metadata: Metadata = {
  title: "Create an account",
  robots: { index: false, follow: true },
};

export const RegisterPage = async ({
  searchParams,
}: PageProps<"/register">) => {
  const next = toLocalPath((await searchParams).next, ROUTES.profile);

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>
          Enter your email to get a link to finish creating your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <RegisterForm next={next} />

        <p className="text-sm text-muted-foreground">
          Already registered?{" "}
          <Link
            href={{ pathname: ROUTES.login, query: { next } }}
            className="text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
};
