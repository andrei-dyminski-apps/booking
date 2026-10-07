import { createZodDto } from "nestjs-zod";
import {
  managedUserDetailSchema,
  managedUserSchema,
  updateUserSchema,
  userPageSchema,
  userQuerySchema,
} from "@repo/contracts";

/** The request halves, which the global pipe validates — see `booking.dto.ts` for why a class. */
export class UpdateUserDto extends createZodDto(updateUserSchema) {}

export class UserQueryDto extends createZodDto(userQuerySchema) {}

/** Response halves, for `/docs` only: the controller keeps returning the contract types. */
export class ManagedUserDto extends createZodDto(managedUserSchema) {}

export class ManagedUserDetailDto extends createZodDto(
  managedUserDetailSchema,
) {}

export class UserPageDto extends createZodDto(userPageSchema) {}
