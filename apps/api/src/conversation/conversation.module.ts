import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ConversationController } from "./conversation.controller";
import { ConversationRepository } from "./conversation.repository";
import { ConversationService } from "./conversation.service";

@Module({
  imports: [PrismaModule],
  controllers: [ConversationController],
  providers: [ConversationService, ConversationRepository],
})
export class ConversationModule {}
