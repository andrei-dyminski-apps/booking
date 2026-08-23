import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import { PrismaService } from "./../src/prisma/prisma.service";

/**
 * The e2e specs share one database (hence `maxWorkers: 1` in jest-e2e.json), so each of
 * them starts from an empty one. The order is the point and the reason this lives in one
 * place rather than in every `beforeEach`: bookings reference listings with
 * `onDelete: Restrict`, and listings reference their owner the same way, so deleting the
 * users first fails on the foreign key rather than taking the rows with it. Refresh
 * tokens are the one thing that does go with its user (`onDelete: Cascade`).
 */
export async function resetDatabase(app: INestApplication<App>): Promise<void> {
  const prismaService = app.get(PrismaService);

  await prismaService.booking.deleteMany();
  await prismaService.listing.deleteMany();
  await prismaService.user.deleteMany();
}
