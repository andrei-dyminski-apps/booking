import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { UnreadRepository } from "./unread.repository";
import { UnreadService } from "./unread.service";

/**
 * What an account has not read, across every feature that has something unread. The
 * writes count inside their own transactions through `countUnreadOf`; what this module
 * provides is the count with no write before it — the stream's opening `sync`.
 */
@Module({
  imports: [PrismaModule],
  providers: [UnreadRepository, UnreadService],
  exports: [UnreadService],
})
export class UnreadModule {}
