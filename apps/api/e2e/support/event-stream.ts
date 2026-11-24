import type { INestApplication } from "@nestjs/common";
import { serverEventSchema, type ServerEvent } from "@repo/contracts";
import type { Credentials } from "./session";

/**
 * The applications already listening: a second `listen` on one of them throws
 * `ERR_SERVER_ALREADY_LISTEN`, and a spec opens a stream per side of a thread.
 */
const listening = new WeakSet<INestApplication>();

/**
 * The events of one account's stream, read off a real connection: the stream is the one
 * route supertest cannot wait for — it never ends — so the spec listens on a port and reads
 * the body as it arrives, the way a browser's `EventSource` does.
 */
export class EventStream {
  private buffer = "";
  private readonly decoder = new TextDecoder();

  private constructor(
    private readonly reader: ReadableStreamDefaultReader<Uint8Array>,
    private readonly controller: AbortController,
  ) {}

  /**
   * Listens on a port of its own — once per application, however many accounts open a
   * stream — and signs in over `fetch`, because the stream has to be read off a real socket
   * and the session agents of `session.ts` hold their cookies inside supertest.
   */
  static async openAs(
    app: INestApplication,
    credentials: Credentials,
  ): Promise<EventStream> {
    if (!listening.has(app)) {
      await app.listen(0, "127.0.0.1");
      listening.add(app);
    }

    const baseUrl = await app.getUrl();
    const login = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password,
      }),
    });
    const cookie = login.headers
      .getSetCookie()
      .map((header) => header.split(";")[0])
      .join("; ");

    return EventStream.open(baseUrl, cookie);
  }

  static async open(baseUrl: string, cookie: string): Promise<EventStream> {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/events`, {
      headers: { cookie },
      signal: controller.signal,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);

    if (response.body === null) throw new Error("The stream has no body");

    return new EventStream(response.body.getReader(), controller);
  }

  /** The next `data:` line, parsed by the contract; comments and ids are skipped. */
  async next(): Promise<ServerEvent> {
    for (;;) {
      const end = this.buffer.indexOf("\n\n");

      if (end >= 0) {
        const frame = this.buffer.slice(0, end);

        this.buffer = this.buffer.slice(end + 2);

        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trim())
          .join("\n");

        if (data !== "") return serverEventSchema.parse(JSON.parse(data));

        continue;
      }

      const { value, done } = await this.reader.read();

      if (done) throw new Error("The stream ended");

      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }

  close(): void {
    this.controller.abort();
  }
}
