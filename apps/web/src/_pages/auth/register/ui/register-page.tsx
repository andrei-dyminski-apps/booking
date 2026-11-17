import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Skeleton } from "@repo/ui/components/skeleton";
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

/**
 * The card is the same for everybody and is part of the prerendered shell; the form
 * depends on `?next=`, so it is streamed. That is a trade the login page does not make —
 * this form validates in the browser and needs the script that reveals it anyway.
 */
export const RegisterPage = ({ searchParams }: PageProps<"/register">) => (
  <Card className="mx-auto w-full max-w-sm">
    <CardHeader>
      <CardTitle>Create an account</CardTitle>
      <CardDescription>
        Every account starts as a guest; the other two roles are granted in the
        database.
      </CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-6">
      <Suspense fallback={<RegisterFormSkeleton />}>
        <RegisterContent searchParams={searchParams} />
      </Suspense>
    </CardContent>
  </Card>
);

const RegisterContent = async ({
  searchParams,
}: Pick<PageProps<"/register">, "searchParams">) => {
  const next = toLocalPath((await searchParams).next, ROUTES.profile);

  return (
    <>
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
    </>
  );
};

/** Box for box: three fields and the second password, the button, the line under it. */
const RegisterFormSkeleton = () => (
  <>
    <div className="flex flex-col gap-6">
      {[0, 1, 2, 3].map((field) => (
        <div key={field} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-full rounded-lg" />
        </div>
      ))}
      <Skeleton className="h-9 w-full rounded-lg" />
    </div>
    <Skeleton className="h-5 w-48" />
  </>
);
