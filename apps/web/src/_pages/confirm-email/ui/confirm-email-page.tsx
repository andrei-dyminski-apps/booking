import { ConfirmEmailForm } from "./confirm-email-form";

export async function ConfirmEmailPage({
  searchParams,
}: PageProps<"/confirm-email">) {
  return <ConfirmEmailForm change={(await searchParams).change === "1"} />;
}
