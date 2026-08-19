import { Module } from "@nestjs/common";
import { APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { BookingModule } from "./booking/booking.module";

@Module({
  imports: [BookingModule],
  controllers: [AppController],
  providers: [
    AppService,
    // Validates bodies and params against the @repo/contracts schemas on every route.
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule {}
