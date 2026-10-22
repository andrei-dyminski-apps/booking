import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";

/**
 * The card every screen of this form draws it in, and its wait as well. The title and the
 * line under it are the screen's — each passes its own, once, from the frame both its
 * page and its skeleton use — while the width and the spacing are spelled only here.
 */
export const ListingFormCard = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) => (
  <Card className="mx-auto w-full max-w-xl">
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);
