/**
 * Stripe.js as the stand-in plays it: what `@stripe/stripe-js` and `@stripe/react-stripe-js`
 * call on the payment form's path, and nothing else. The suite serves it in place of the
 * script at `js.stripe.com` (`stand-in.ts`), so the page loads it the way it loads Stripe's —
 * through `loadStripe`, under its Content Security Policy — and the payment form is the
 * production one.
 *
 * Stripe's card boxes are not drawn: their markup is Stripe's to change, and what the suite
 * proves is that the application pays, not that a card can be typed. The payment element
 * shows a line saying which card pays, and confirming the payment sends it to the stand-in
 * through `api.stripe.com` as Stripe.js does, with the publishable key in the form.
 *
 * Runs in the page, serialized: it may reach nothing outside its own body.
 */
export function installStripeStandIn(train: string): void {
  type Answer = Record<string, unknown> & {
    error?: { message?: string; type?: string; code?: string };
  };
  type Handler = (event: unknown) => void;

  const API = "https://api.stripe.com/v1";

  const unplayed = (name: string) => () => {
    throw new Error(`Stripe.js stand-in: ${name} is not played`);
  };

  const intentIdOf = (clientSecret: string) =>
    clientSecret.split("_secret_")[0] ?? "";

  const call = async (
    method: "GET" | "POST",
    path: string,
    params: Record<string, string>,
  ): Promise<Answer> => {
    const form = new URLSearchParams(params);
    const response =
      method === "GET"
        ? await fetch(`${API}${path}?${form.toString()}`)
        : await fetch(`${API}${path}`, {
            method,
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: form,
          });

    return (await response.json()) as Answer;
  };

  /** Stripe.js answers with the object or an error, never by throwing. */
  const intentAnswer = (answer: Answer) =>
    answer.error === undefined
      ? { paymentIntent: answer }
      : { error: answer.error };

  function Stripe(publishableKey: string) {
    const keyed = (clientSecret: string) => ({
      key: publishableKey,
      client_secret: clientSecret,
    });

    const elementsFor = (options: { clientSecret?: string } = {}) => {
      let mounted: HTMLElement | null = null;

      const elements = {
        clientSecret: options.clientSecret ?? "",
        update(next: { clientSecret?: string }) {
          if (next.clientSecret !== undefined) {
            elements.clientSecret = next.clientSecret;
          }
        },
        fetchUpdates: () => Promise.resolve({}),
        submit: () => Promise.resolve({}),
        getElement: () => null,
        get mounted() {
          return mounted;
        },
        create(type: string) {
          if (type !== "payment") unplayed(`the ${type} element`)();

          const handlers = new Map<string, Set<Handler>>();

          const emit = (event: string, payload: unknown) => {
            handlers.get(event)?.forEach((handler) => {
              handler(payload);
            });
          };

          return {
            mount(node: HTMLElement) {
              const line = document.createElement("p");

              line.textContent = "Test card ending in 4242";
              node.replaceChildren(line);
              mounted = node;
              queueMicrotask(() => {
                emit("ready", { elementType: type });
              });
            },
            unmount() {
              mounted?.replaceChildren();
              mounted = null;
            },
            destroy() {
              mounted?.replaceChildren();
              mounted = null;
            },
            update() {},
            on(event: string, handler: Handler) {
              const set = handlers.get(event) ?? new Set<Handler>();

              set.add(handler);
              handlers.set(event, set);
            },
            off(event: string, handler: Handler) {
              handlers.get(event)?.delete(handler);
            },
          };
        },
      };

      return elements;
    };

    return {
      _registerWrapper() {},
      registerAppInfo() {},
      elements: elementsFor,
      createToken: unplayed("createToken"),
      createPaymentMethod: unplayed("createPaymentMethod"),
      confirmCardPayment: unplayed("confirmCardPayment"),
      async retrievePaymentIntent(clientSecret: string) {
        return intentAnswer(
          await call(
            "GET",
            `/payment_intents/${intentIdOf(clientSecret)}`,
            keyed(clientSecret),
          ),
        );
      },
      async confirmPayment({
        elements,
      }: {
        elements: ReturnType<typeof elementsFor>;
      }) {
        if (elements.mounted === null) {
          return {
            error: {
              type: "validation_error",
              message: "The payment element is not on the page.",
            },
          };
        }

        return intentAnswer(
          await call(
            "POST",
            `/payment_intents/${intentIdOf(elements.clientSecret)}/confirm`,
            keyed(elements.clientSecret),
          ),
        );
      },
    };
  }

  // The release train the page asked for, which `loadStripe` compares with its own.
  Stripe.version = train;

  (window as unknown as { Stripe: typeof Stripe }).Stripe = Stripe;
}
