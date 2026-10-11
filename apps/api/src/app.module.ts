import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { APP_GUARD, APP_PIPE } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule, minutes } from "@nestjs/throttler";
import { ZodValidationPipe } from "nestjs-zod";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard";
import { RolesGuard } from "./auth/guards/roles.guard";
import { BookingModule } from "./booking/booking.module";
import { ConversationModule } from "./conversation/conversation.module";
import { ListingModule } from "./listing/listing.module";
import { LookupModule } from "./lookup/lookup.module";
import { ReviewModule } from "./review/review.module";
import { UserModule } from "./user/user.module";

@Module({
  imports: [
    // A ceiling per address for the whole API: this one only keeps a single client from
    // monopolising the service. What a route actually needs lives next to it, in both
    // directions — @Throttle in AuthController tightens it to 10 where an attempt costs
    // 64 MB of argon2, and in ListingController it widens it for the three public reads,
    // whose address is the frontend's rather than a visitor's once they are cached there.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: minutes(1), limit: 120 }],
    }),
    // Backs the delayed job that releases an unpaid hold. No fallback URL, the same rule
    // as the JWT secrets and DATABASE_URL: a missing REDIS_URL stops the process at boot.
    // Read in a factory rather than in the decorator argument, because the argument is
    // evaluated when this file is imported: the throw would then be an import error, and
    // every spec that so much as mentions AppModule would fail before Nest is involved.
    BullModule.forRootAsync({
      useFactory: () => ({ connection: { url: requireRedisUrl() } }),
    }),
    AuthModule,
    BookingModule,
    ConversationModule,
    ListingModule,
    LookupModule,
    ReviewModule,
    UserModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Validates bodies and params against the @repo/contracts schemas on every route.
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // Order matters: guards run in the order they are registered, and the limiter has to
    // answer 429 before JwtAuthGuard verifies anything — an unauthenticated flood of
    // /auth/login is otherwise a flood of argon2 hashes, 64 MB of memory each.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Closes every route by default; @Public() is what opens one.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // After it, and for the same reason the limiter comes first: this one reads the user
    // JwtAuthGuard put on the request. It does nothing until a route carries @Roles().
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}

function requireRedisUrl(): string {
  const url = process.env.REDIS_URL;

  if (url === undefined || url === "") {
    throw new Error("REDIS_URL is not set — copy .env.example to .env");
  }

  return url;
}
