import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import { PrismaService } from "./../src/prisma/prisma.service";

/**
 * The e2e specs share one database (hence `maxWorkers: 1` in jest-e2e.json), so each of
 * them starts from an empty one. The order is the point and the reason this lives in one
 * place rather than in every `beforeEach`: bookings reference listings with
 * `onDelete: Restrict`, and listings reference their owner the same way, so deleting the
 * users first fails on the foreign key rather than taking the rows with it. Refresh
 * tokens and notifications go with their user, reviews with their booking and waitlist
 * entries with either their listing or their user (`onDelete: Cascade`), so none of them
 * needs a line of its own.
 */
export async function resetDatabase(app: INestApplication<App>): Promise<void> {
  const prismaService = app.get(PrismaService);

  await prismaService.booking.deleteMany();
  // Restricts its listing like a booking does; the messages go with it (`Cascade`).
  await prismaService.conversation.deleteMany();
  await prismaService.listing.deleteMany();
  await prismaService.user.deleteMany();
  // The webhook ledger names no row, so nothing cascades into it; left behind, an event id
  // a later spec reuses would be skipped as already handled.
  await prismaService.paymentEvent.deleteMany();
  // Names no row either, and a refund id a later spec reuses would be skipped as recorded.
  await prismaService.refundFailure.deleteMany();
}
