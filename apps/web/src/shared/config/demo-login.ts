import {
  ActorKind,
  DEMO_ACCOUNT_EMAILS,
  type DemoAccountId,
} from "@repo/contracts";

const DEMO_DESTINATIONS = {
  [ActorKind.GUEST]: "catalogue",
  [ActorKind.HOST]: "dashboard",
  [ActorKind.ADMIN]: "adminPayments",
} as const satisfies Record<DemoAccountId, string>;

function isDemoAccountId(value: string): value is DemoAccountId {
  return Object.hasOwn(DEMO_ACCOUNT_EMAILS, value);
}

export function findDemoLogin(value: string) {
  if (!isDemoAccountId(value)) return undefined;

  return {
    id: value,
    email: DEMO_ACCOUNT_EMAILS[value],
    next: DEMO_DESTINATIONS[value],
  };
}
