import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { CompleteRegistrationForm } from "./complete-registration-form";
import { ROUTES } from "#shared/config";
import { toLocalPath } from "#shared/lib";

export const metadata: Metadata = {
  title: "Finish creating your account",
  robots: { index: false },
};

export async function CompleteRegistrationPage({
  searchParams,
}: PageProps<"/complete-registration">) {
  const next = toLocalPath((await searchParams).next, ROUTES.profile);
  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>Finish creating your account</CardTitle>
      </CardHeader>
      <CardContent>
        <CompleteRegistrationForm next={next} />
      </CardContent>
    </Card>
  );
}
