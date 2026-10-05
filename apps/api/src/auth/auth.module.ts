import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { PrismaModule } from "../prisma/prisma.module";
import { AUTH_CONFIG, loadAuthConfig } from "./auth.config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { RefreshTokenRepository } from "./refresh-token.repository";
import { TokenService } from "./token.service";
import { UserModule } from "../user/user.module";

@Module({
  imports: [
    PrismaModule,
    // The accounts a session is opened for; the table and its repository are that module's.
    UserModule,
    PassportModule,
    // No secret here: the two token kinds are signed with two different keys, which
    // TokenService passes per call instead of registering the module twice.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    { provide: AUTH_CONFIG, useFactory: loadAuthConfig },
    AuthService,
    TokenService,
    RefreshTokenRepository,
    JwtStrategy,
  ],
  exports: [AuthService],
})
export class AuthModule {}
