import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import { PrismaService } from "./../src/prisma/prisma.service";

/**
 * The e2e specs share one database (hence `maxWorkers: 1` in jest-e2e.json), so each of
 * them starts from an empty one. The order is the point and the reason this lives in one
 * place rather than in every `beforeEach`: bookings reference listings with
 * `onDelete: Restrict`, and deleting the users first would cascade into listings the
 * bookings still point at. Refresh tokens go with their user (`onDelete: Cascade`).
 */
export async function resetDatabase(app: INestApplication<App>): Promise<void> {
  const prismaService = app.get(PrismaService);

  await prismaService.booking.deleteMany();
  await prismaService.listing.deleteMany();
  await prismaService.user.deleteMany();
}
