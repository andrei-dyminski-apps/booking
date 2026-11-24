import type { ActorKind } from "@repo/contracts";

export type HostFeeAudience = (typeof ActorKind)["HOST" | "ADMIN"];
