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

export const RegisterPage = async ({
  searchParams,
}: PageProps<"/register">) => {
  const next = toLocalPath((await searchParams).next, ROUTES.profile);

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>
          Every account starts as a guest; the other two roles are granted in
          the database.
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
