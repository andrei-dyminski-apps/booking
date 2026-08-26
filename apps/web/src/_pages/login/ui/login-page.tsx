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
