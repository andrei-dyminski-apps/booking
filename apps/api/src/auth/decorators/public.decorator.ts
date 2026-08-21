import { SetMetadata, applyDecorators } from "@nestjs/common";
import { ApiSecurity } from "@nestjs/swagger";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Opens a route the global JwtAuthGuard would otherwise close.
 *
 * The OpenAPI half comes with it: main.ts declares the cookie as a document-wide security
 * requirement, so every route is drawn as protected unless the operation says otherwise —
 * and an empty requirement object is how OpenAPI 3 spells "this one needs no credential".
 * Tying the two together here is what keeps /docs from drifting away from the guard.
 */
export const Public = () =>
  applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), ApiSecurity({}));
