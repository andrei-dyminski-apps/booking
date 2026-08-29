import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { LogoutButton } from "#features/logout";
import { requireUser } from "#shared/api";
import { ROUTES } from "#shared/config";
import { formatDate } from "#shared/lib";

export const ProfilePage = async () => {
  const user = await requireUser(ROUTES.profile);

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
          <dt className="text-muted-foreground">Email</dt>
          <dd>{user.email}</dd>

          <dt className="text-muted-foreground">Role</dt>
          <dd>{user.role}</dd>

          <dt className="text-muted-foreground">Member since</dt>
          <dd>{formatDate(user.createdAt)}</dd>
        </dl>

        <LogoutButton />
      </CardContent>
    </Card>
  );
};
