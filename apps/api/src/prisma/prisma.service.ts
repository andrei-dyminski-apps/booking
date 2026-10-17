import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

/**
 * How long a query waits for a connection of the pool — a free one, or a new one being
 * opened — before it fails. `pg` waits forever by default, and Prisma's own `maxWait` covers
 * `$transaction` alone: with the pool exhausted every other query would hang until the
 * frontend gave up on it (the BFF at nine seconds, the transport at ten) and then run for
 * nobody. Under those deadlines, so the API answers the `500` itself; the same five seconds
 * Prisma 6 gave a new connection.
 */
const POOL_CONNECTION_TIMEOUT_MS = 5_000;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (connectionString === undefined) {
      throw new Error("DATABASE_URL is not set — copy .env.example to .env");
    }

    super({
      adapter: new PrismaPg({
        connectionString,
        connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
