/**
 * The stand-in for Stripe on the hermetic stack: the part of Stripe's API the application
 * calls, kept in memory, on an address of this machine. The API's Stripe client is pointed
 * here (`STRIPE_STAND_IN_URL`), and the browser's calls to `api.stripe.com` are routed here by
 * the suite (`stand-in.ts`), so the integration runs unchanged on both sides — the adapters,
 * the payment form, the webhook inbox and its handlers — and only Stripe is not Stripe.
 *
 * It behaves the way Stripe does from the application's side, for the main path of a
 * payment and nothing beyond it: a card is accepted on confirmation, authorized for manual
 * capture as the API asks, captured, and refunded; each step is reported to the API's
 * webhook as Stripe reports it, signed with the secret the API checks, a refund a moment
 * after it was answered. A declined card and 3-D Secure are a payment's edge cases and are
 * not played. An idempotency key answers what it answered the first time, as Stripe's does,
 * because the API's retries rest on that.
 *
 * What it cannot play is a problem it keeps rather than only logs: a call it does not know
 * (the application started calling something new, which the stand-in has to learn before a
 * scenario rests on it), a delivery the API refused or never took, a request it refused or
 * failed on itself. The suite drains them after every test and once more at the end of the
 * run (`POST /problems/drain`, read by `stand-in.ts`) and fails on any, so a background call
 * of the API's that no page shows is caught as surely as the browser's. A drain first waits
 * for the deliveries still in hand, so what a test set going is laid at that test's door.
 *
 * Started by Playwright (`playwright.config.ts`) as a process of its own with `node`, which
 * strips the types, so it imports nothing but Node's own modules. Its state goes with the
 * process, like the database's with its container.
 */
import { createHmac, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

const PORT = Number(required("STRIPE_STAND_IN_PORT"));
const SECRET_KEY = required("STRIPE_SECRET_KEY");
const PUBLISHABLE_KEY = required("STRIPE_PUBLISHABLE_KEY");
const WEBHOOK_SECRET = required("STRIPE_PAYMENT_WEBHOOK_SECRET");
const WEBHOOK_URL = `${required("API_ORIGIN")}/payments/webhook`;

/** How much later than its answer a refund is reported: Stripe's news comes after its answer. */
const REFUND_REPORT_DELAY_MS = 500;

/** A delivery the API refused or never answered is sent again, as Stripe does, a few times. */
const DELIVERY_ATTEMPTS = 10;
const DELIVERY_RETRY_MS = 1_000;

/**
 * How long a drain waits for the deliveries still in hand. One the API takes lands within
 * milliseconds, so a delivery still going after this is a problem in itself — reported then,
 * to the test that set it going, and given up rather than left to fail the next one.
 */
const DRAIN_WAIT_MS = 5_000;

type IntentStatus =
  "requires_payment_method" | "requires_capture" | "succeeded" | "canceled";

type Intent = {
  id: string;
  clientSecret: string;
  amount: number;
  currency: string;
  metadata: Record<string, string>;
  status: IntentStatus;
  chargeId: string | null;
  amountRefunded: number;
  created: number;
  /** The version the API asked in, which its events are delivered in, as an endpoint pinned to it. */
  apiVersion: string | null;
};

type Refund = {
  id: string;
  intentId: string;
  chargeId: string;
  amount: number;
  metadata: Record<string, string>;
  created: number;
};

type Reply = { status: number; body: unknown };

/** A webhook delivery under way: due, being sent, or waiting to be sent again. */
type Delivery = { what: string; done: Promise<void>; abandoned: boolean };

/** What a request is: who sent it, where to, and with what. */
type Call = {
  method: string;
  path: string;
  params: URLSearchParams;
  /** `secret` for the API, `publishable` for Stripe.js in the browser. */
  key: "secret" | "publishable" | null;
  apiVersion: string | null;
};

const intents = new Map<string, Intent>();
const refunds: Refund[] = [];
/** Idempotency key → the request it was first used with and what it was answered. */
const replies = new Map<string, { fingerprint: string; reply: Reply }>();
const deliveries = new Set<Delivery>();
/** What went wrong since the suite last asked, oldest first. */
let problems: string[] = [];

// A failure of the stand-in's own is answered and kept as a problem, never left to reject
// unhandled: that would end the process, and every Stripe call after it would fail far from
// the cause.
const server = createServer((request, response) => {
  readCall(request)
    .then((call) => handle(call, request))
    .catch((error: unknown): Reply => {
      problem(
        `The stand-in failed on ${request.method ?? "?"} ${request.url ?? "?"}: ${String(error)}`,
      );

      return { status: 500, body: stripeError("api_error", String(error)) };
    })
    .then((reply) => {
      answer(response, reply);
    })
    .catch((error: unknown) => {
      console.error(`The stand-in could not answer: ${String(error)}`);
    });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Stripe stand-in on http://127.0.0.1:${String(PORT)}`);
});

async function handle(call: Call, request: IncomingMessage): Promise<Reply> {
  if (call.method === "GET" && call.path === "/health") {
    return { status: 200, body: { ok: true } };
  }

  // The suite's own question, on the suite's own path: Stripe has no `/problems`.
  if (call.method === "POST" && call.path === "/problems/drain") {
    await settleDeliveries();

    const drained = problems;

    problems = [];

    return { status: 200, body: { problems: drained } };
  }

  if (call.key === null) {
    return unauthorized(call);
  }

  const idempotencyKey = request.headers["idempotency-key"];

  if (call.method !== "POST" || typeof idempotencyKey !== "string") {
    return route(call);
  }

  const fingerprint = `${call.method} ${call.path} ${call.params.toString()}`;
  const earlier = replies.get(idempotencyKey);

  if (earlier !== undefined) {
    return earlier.fingerprint === fingerprint
      ? earlier.reply
      : {
          status: 400,
          body: stripeError(
            "idempotency_error",
            `Keys for idempotent requests can only be used with the same parameters they were first used with (${idempotencyKey}).`,
          ),
        };
  }

  const reply = route(call);

  // Stripe keeps an answer under its key, a refusal included, but not a failure of its own.
  if (reply.status < 500) replies.set(idempotencyKey, { fingerprint, reply });

  return reply;
}

function route(call: Call): Reply {
  const { method, path } = call;
  const intentPath = /^\/v1\/payment_intents\/([^/]+)(\/[a-z]+)?$/.exec(path);

  if (call.key === "publishable") {
    if (intentPath === null) return unknown(call);

    const [, id = "", action] = intentPath;

    if (method === "GET" && action === undefined) {
      return withClientSecret(id, call, (intent) => ok(clientView(intent)));
    }

    if (method === "POST" && action === "/confirm") {
      return withClientSecret(id, call, confirm);
    }

    return unknown(call);
  }

  if (method === "POST" && path === "/v1/payment_intents") {
    return createIntent(call);
  }

  if (method === "POST" && path === "/v1/refunds") {
    return createRefund(call);
  }

  if (method === "GET" && path === "/v1/refunds") {
    return listRefunds(call);
  }

  if (intentPath !== null) {
    const [, id = "", action] = intentPath;
    const intent = intents.get(id);

    if (intent === undefined) return missing("payment_intent", id);

    if (method === "GET" && action === undefined) {
      return ok(intentView(intent, call.params));
    }

    if (method === "POST" && action === "/capture") return capture(intent);
    if (method === "POST" && action === "/cancel") return cancel(intent);
  }

  return unknown(call);
}

function createIntent(call: Call): Reply {
  const id = `pi_${token()}`;
  const intent: Intent = {
    id,
    clientSecret: `${id}_secret_${token()}`,
    amount: Number(call.params.get("amount")),
    currency: call.params.get("currency") ?? "usd",
    metadata: metadataOf(call.params),
    status: "requires_payment_method",
    chargeId: null,
    amountRefunded: 0,
    created: now(),
    apiVersion: call.apiVersion,
  };

  intents.set(id, intent);

  return ok(intentView(intent));
}

/**
 * The guest's card, accepted: every method the API opens a hold with is captured by hand,
 * so the payment is authorized and waits for the API to take it, as a card's does.
 */
function confirm(intent: Intent): Reply {
  if (intent.status !== "requires_payment_method") {
    return unexpectedState(intent, "confirmed");
  }

  intent.status = "requires_capture";
  deliver(
    intent,
    "payment_intent.amount_capturable_updated",
    intentView(intent),
  );

  return ok(clientView(intent));
}

function capture(intent: Intent): Reply {
  if (intent.status !== "requires_capture") {
    return unexpectedState(intent, "captured");
  }

  intent.status = "succeeded";
  intent.chargeId = `ch_${token()}`;
  deliver(intent, "payment_intent.succeeded", intentView(intent));

  return ok(intentView(intent));
}

function cancel(intent: Intent): Reply {
  if (
    intent.status !== "requires_payment_method" &&
    intent.status !== "requires_capture"
  ) {
    return unexpectedState(intent, "canceled");
  }

  intent.status = "canceled";

  return ok(intentView(intent));
}

function createRefund(call: Call): Reply {
  const intentId = call.params.get("payment_intent") ?? "";
  const intent = intents.get(intentId);

  if (intent === undefined) return missing("payment_intent", intentId);

  if (intent.chargeId === null) {
    return invalidRequest(
      `PaymentIntent ${intent.id} has no charge to refund.`,
      "charge_not_captured",
    );
  }

  const left = intent.amount - intent.amountRefunded;
  const amount = Number(call.params.get("amount") ?? left);

  if (left === 0) {
    return invalidRequest(
      `Charge ${intent.chargeId} has already been refunded.`,
      "charge_already_refunded",
    );
  }

  if (amount > left) {
    return invalidRequest(
      `Refund amount (${String(amount)}) is greater than unrefunded amount on charge (${String(left)})`,
      "amount_too_large",
      "amount",
    );
  }

  const refund: Refund = {
    id: `re_${token()}`,
    intentId,
    chargeId: intent.chargeId,
    amount,
    metadata: metadataOf(call.params),
    created: now(),
  };

  refunds.push(refund);
  intent.amountRefunded += amount;

  const charge = chargeView(intent);

  deliver(intent, "charge.refunded", charge, REFUND_REPORT_DELAY_MS);

  return ok(refundView(refund));
}

/** Newest first, as Stripe lists them; never more than a page here. */
function listRefunds(call: Call): Reply {
  const intentId = call.params.get("payment_intent");
  const data = refunds
    .filter((refund) => intentId === null || refund.intentId === intentId)
    .reverse()
    .map(refundView);

  return ok({ object: "list", url: "/v1/refunds", has_more: false, data });
}

function intentView(intent: Intent, params?: URLSearchParams) {
  const expanded =
    params !== undefined &&
    [...params.entries()].some(
      ([name, value]) => name.startsWith("expand") && value === "latest_charge",
    );

  return {
    id: intent.id,
    object: "payment_intent",
    amount: intent.amount,
    amount_capturable: intent.status === "requires_capture" ? intent.amount : 0,
    amount_received: intent.status === "succeeded" ? intent.amount : 0,
    client_secret: intent.clientSecret,
    created: intent.created,
    currency: intent.currency,
    latest_charge:
      intent.chargeId !== null && expanded
        ? chargeView(intent)
        : intent.chargeId,
    livemode: false,
    metadata: intent.metadata,
    status: intent.status,
  };
}

/** What Stripe.js is shown of an intent: no metadata, as the publishable key reads it. */
function clientView(intent: Intent) {
  const view: Partial<ReturnType<typeof intentView>> = intentView(intent);

  delete view.metadata;
  delete view.latest_charge;

  return view;
}

function chargeView(intent: Intent) {
  return {
    id: intent.chargeId,
    object: "charge",
    amount: intent.amount,
    amount_captured: intent.amount,
    amount_refunded: intent.amountRefunded,
    currency: intent.currency,
    livemode: false,
    metadata: intent.metadata,
    paid: true,
    payment_intent: intent.id,
    refunded: intent.amountRefunded === intent.amount,
    status: "succeeded",
  };
}

function refundView(refund: Refund) {
  return {
    id: refund.id,
    object: "refund",
    amount: refund.amount,
    charge: refund.chargeId,
    created: refund.created,
    currency: intents.get(refund.intentId)?.currency ?? "usd",
    metadata: refund.metadata,
    payment_intent: refund.intentId,
    status: "succeeded",
  };
}

/**
 * A webhook delivery, signed as Stripe signs one (`t=…,v1=…` over the timestamp and the
 * body), sent once the answer that caused it is written — the handlers call this before
 * `answer`, so the first attempt waits for the turn after — and again until the API takes
 * it. An answer other than `2xx` is a problem at once: the inbox answers `200` to whatever
 * it could record, so anything else is a signature it refused or a write that failed. A
 * delivery that never reached the API is one once every attempt has failed. Under way, it
 * is one of `deliveries`, which a drain waits for.
 */
function deliver(
  intent: Intent,
  type: string,
  object: unknown,
  afterMs = 0,
): void {
  const payload = JSON.stringify({
    id: `evt_${token()}`,
    object: "event",
    api_version: intent.apiVersion,
    created: now(),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  });

  const what = `${type} for ${intent.id}`;
  const delivery: Delivery = {
    what,
    done: Promise.resolve(),
    abandoned: false,
  };

  delivery.done = (async () => {
    // A delay of 0 is the turn after: the answer that caused the delivery goes out first.
    await delay(afterMs);

    try {
      for (let attempt = 1; attempt <= DELIVERY_ATTEMPTS; attempt += 1) {
        if (delivery.abandoned) return;

        const timestamp = String(now());
        const signature = createHmac("sha256", WEBHOOK_SECRET)
          .update(`${timestamp}.${payload}`)
          .digest("hex");

        try {
          const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "stripe-signature": `t=${timestamp},v1=${signature}`,
            },
            body: payload,
          });

          // Once given up, what comes back is no longer any test's business.
          if (response.ok || delivery.abandoned) return;

          problem(
            `${what}: the webhook answered ${String(response.status)} (attempt ${String(attempt)})`,
          );
        } catch (error) {
          console.error(
            `${what}: the webhook could not be reached (attempt ${String(attempt)}): ${String(error)}`,
          );
        }

        await delay(DELIVERY_RETRY_MS);
      }

      if (!delivery.abandoned) {
        problem(
          `${what}: not delivered after ${String(DELIVERY_ATTEMPTS)} attempts`,
        );
      }
    } finally {
      deliveries.delete(delivery);
    }
  })();

  deliveries.add(delivery);
}

/**
 * Waits for the deliveries under way — a refund reported a moment late, one the API has yet
 * to take — up to `DRAIN_WAIT_MS`, a delivery the API's answer to them sets going included.
 * What is still under way then is a problem, and given up.
 */
async function settleDeliveries(): Promise<void> {
  let timeIsUp = false;
  const timeUp = delay(DRAIN_WAIT_MS).then(() => {
    timeIsUp = true;
  });

  while (deliveries.size > 0 && !timeIsUp) {
    await Promise.race([
      Promise.all([...deliveries].map((delivery) => delivery.done)),
      timeUp,
    ]);
  }

  for (const delivery of deliveries) {
    delivery.abandoned = true;
    deliveries.delete(delivery);
    problem(
      `${delivery.what}: still undelivered ${String(DRAIN_WAIT_MS)} ms after the test ended`,
    );
  }
}

function withClientSecret(
  id: string,
  call: Call,
  act: (intent: Intent) => Reply,
): Reply {
  const intent = intents.get(id);

  if (
    intent === undefined ||
    intent.clientSecret !== call.params.get("client_secret")
  ) {
    return missing("payment_intent", id);
  }

  return act(intent);
}

async function readCall(request: IncomingMessage): Promise<Call> {
  const url = new URL(request.url ?? "/", "http://stand-in");
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }

  // Stripe's own encoding: a form, in the body of a POST and the query of a GET.
  const params =
    request.method === "POST"
      ? new URLSearchParams(Buffer.concat(chunks).toString("utf8"))
      : url.searchParams;
  const authorization = request.headers.authorization;
  const version = request.headers["stripe-version"];
  const key =
    authorization === `Bearer ${SECRET_KEY}`
      ? "secret"
      : params.get("key") === PUBLISHABLE_KEY
        ? "publishable"
        : null;

  return {
    method: request.method ?? "GET",
    path: url.pathname,
    params,
    key,
    apiVersion: typeof version === "string" ? version : null,
  };
}

/**
 * Stripe.js reads its answers across origins; the suite's route hands them to the page as
 * they are, so the header that allows it is the stand-in's to send, as it is Stripe's.
 */
function answer(response: ServerResponse, reply: Reply): void {
  response.writeHead(reply.status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(reply.body));
}

function metadataOf(params: URLSearchParams): Record<string, string> {
  const metadata: Record<string, string> = {};

  for (const [name, value] of params) {
    const field = /^metadata\[(.+)\]$/.exec(name)?.[1];

    if (field !== undefined) metadata[field] = value;
  }

  return metadata;
}

function ok(body: unknown): Reply {
  return { status: 200, body };
}

function stripeError(
  type: string,
  message: string,
  code?: string,
  param?: string,
) {
  return { error: { type, message, code, param } };
}

function invalidRequest(message: string, code?: string, param?: string): Reply {
  return {
    status: 400,
    body: stripeError("invalid_request_error", message, code, param),
  };
}

function unexpectedState(
  intent: Intent,
  action: "confirmed" | "captured" | "canceled",
): Reply {
  return invalidRequest(
    `This PaymentIntent could not be ${action} because it has a status of ${intent.status}.`,
    "payment_intent_unexpected_state",
  );
}

function missing(resource: string, id: string): Reply {
  return {
    status: 404,
    body: stripeError(
      "invalid_request_error",
      `No such ${resource}: '${id}'`,
      "resource_missing",
    ),
  };
}

/** A request with neither key: nothing of the application's sends one, so it is a problem. */
function unauthorized(call: Call): Reply {
  problem(`Refused without a key: ${call.method} ${call.path}`);

  return {
    status: 401,
    body: stripeError("invalid_request_error", "Invalid API Key provided"),
  };
}

/**
 * A call the stand-in does not play. Said loudly, as a problem the suite fails on and in
 * the answer: either the application started calling something new, which the stand-in has
 * to learn before a scenario rests on it, or a scenario walked off its main path.
 */
function unknown(call: Call): Reply {
  problem(`Not played by the stand-in: ${call.method} ${call.path}`);

  return {
    status: 404,
    body: stripeError(
      "invalid_request_error",
      `Unrecognized request URL (${call.method}: ${call.path}): the Stripe stand-in does not play it`,
    ),
  };
}

/** Logged as it happens, and kept for the suite's next drain. */
function problem(line: string): void {
  console.error(line);
  problems.push(line);
}

function token(): string {
  return randomBytes(12).toString("hex");
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function required(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set — the stand-in is started by the browser suite's config`,
    );
  }

  return value;
}
