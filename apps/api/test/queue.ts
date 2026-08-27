import { getQueueToken } from "@nestjs/bullmq";
import type { INestApplication } from "@nestjs/common";
import type { Queue } from "bullmq";
import type { App } from "supertest/types";
import { BOOKING_EXPIRY_QUEUE } from "./../src/booking/booking-expiry.queue";

/**
 * The e2e specs share one Redis as they share one database. A booking's hold-expiry job is
 * delayed 15 minutes and keyed by the (fresh) booking id, so a leftover from a previous
 * run is harmless — but it still piles up in Redis. Draining the queue before each test
 * keeps that clean, the same intent as `resetDatabase`.
 */
export async function resetQueue(app: INestApplication<App>): Promise<void> {
  await bookingExpiryQueue(app).obliterate({ force: true });
}

/** The queue itself, for the spec that drives a job rather than the API in front of it. */
export function bookingExpiryQueue(app: INestApplication<App>): Queue {
  return app.get<Queue>(getQueueToken(BOOKING_EXPIRY_QUEUE));
}
