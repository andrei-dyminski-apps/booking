import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { UserModule } from "../user/user.module";
import { AccountController } from "./account.controller";
import { AccountRepository } from "./account.repository";
import { AccountService } from "./account.service";

@Module({
  // AuthModule for the cookie attributes the answer clears, UserModule for the hash the
  // password is checked against.
  imports: [PrismaModule, AuthModule, UserModule],
  controllers: [AccountController],
  providers: [AccountService, AccountRepository],
})
export class AccountModule {}
