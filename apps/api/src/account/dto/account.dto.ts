import { createZodDto } from "nestjs-zod";
import { deleteAccountSchema } from "@repo/contracts";
import { withExample } from "../../common/api-example";

/** The request half, which the global pipe validates — see `booking.dto.ts` for why a class. */
export class DeleteAccountDto extends createZodDto(
  withExample(deleteAccountSchema, { password: "correct-horse-battery" }),
) {}
