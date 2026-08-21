import { Module } from "@nestjs/common";
import { APP_GUARD, APP_PIPE } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule, minutes } from "@nestjs/throttler";
import { ZodValidationPipe } from "nestjs-zod";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard";
import { BookingModule } from "./booking/booking.module";

@Module({
  imports: [
    // A ceiling per address for the whole API. The tight limit that matters is on the auth
    // routes and lives next to them (@Throttle in AuthController) — this one only keeps a
    // single client from monopolising the service.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: minutes(1), limit: 120 }],
    }),
    AuthModule,
    BookingModule,
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
  ],
})
export class AppModule {}
