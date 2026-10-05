import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { UserController } from "./user.controller";
import { UserRepository } from "./user.repository";
import { UserService } from "./user.service";

@Module({
  imports: [PrismaModule],
  controllers: [UserController],
  providers: [UserService, UserRepository],
  // AuthService reads the account behind a login, a refresh and `/auth/me` through it —
  // one repository per table, whichever module happens to need the rows.
  exports: [UserRepository],
})
export class UserModule {}
