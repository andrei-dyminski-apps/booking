import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { App } from "supertest/types";
import {
  ConversationSide,
  Role,
  apiErrorSchema,
  conversationPageSchema,
  conversationSchema,
  messagePageSchema,
  messageSchema,
  type Conversation,
  type CreateListingInput,
} from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { resetDatabase } from "./database";
import { EventStream } from "./event-stream";
import { resetQueue } from "./queue";
import { credentialsFor, signInAs, type Agent } from "./session";

const listingInput: CreateListingInput = {
  title: "Loft above the harbour",
  description: "Two rooms under the roof and a wall of glass facing the water.",
  pricePerNight: 120,
  capacity: 4,
};

describe("ConversationController (e2e)", () => {
  let app: INestApplication<App>;
  let guest: Agent;
  let otherGuest: Agent;
  let owner: Agent;
  let otherOwner: Agent;
  let admin: Agent;

  let listingId: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    await resetDatabase(app);
    await resetQueue(app);

    guest = await signInAs(app, Role.USER);
    otherGuest = await signInAs(app, Role.USER, {
      name: "E2E Second Guest",
      email: "e2e-guest-2@example.com",
      password: "password123",
    });
    owner = await signInAs(app, Role.OWNER);
    otherOwner = await signInAs(app, Role.OWNER, {
      name: "E2E Second Owner",
      email: "e2e-owner-2@example.com",
      password: "password123",
    });
    admin = await signInAs(app, Role.ADMIN);

    const listing = await owner
      .post("/listings")
      .send(listingInput)
      .expect(201);

    listingId = (listing.body as { id: string }).id;
  });

  afterEach(async () => {
    await app.close();
  });

  const start = async (
    agent: Agent,
    body = "Is early check-in possible?",
  ): Promise<Conversation> =>
    conversationSchema.parse(
      (await agent.post("/conversations").send({ listingId, body }).expect(201))
        .body,
    );

  const threads = async (
    agent: Agent,
    search: Record<string, string> = {},
  ): Promise<Conversation[]> =>
    conversationPageSchema.parse(
      (await agent.get("/conversations").query(search).expect(200)).body,
    ).items;

  it("opens a thread a guest has read and its host has not", async () => {
    const started = await start(guest);

    expect(started).toMatchObject({
      listingId,
      listing: { title: listingInput.title },
      side: ConversationSide.GUEST,
      unread: false,
      lastMessage: { sender: ConversationSide.GUEST },
    });

    const [asHost] = await threads(owner);

    expect(asHost).toMatchObject({
      id: started.id,
      side: ConversationSide.HOST,
      unread: true,
    });
  });

  it("names both people of a thread and gives neither the other's address", async () => {
    const started = await start(guest);
    const names = {
      guest: { name: credentialsFor.USER.name },
      host: { name: credentialsFor.OWNER.name },
    };

    expect(started).toMatchObject(names);

    const asHost = await owner.get(`/conversations/${started.id}`).expect(200);

    expect(conversationSchema.parse(asHost.body)).toMatchObject(names);
    expect(JSON.stringify(asHost.body)).not.toContain(
      credentialsFor.USER.email,
    );
    expect(JSON.stringify(started)).not.toContain(credentialsFor.OWNER.email);
  });

  it("continues the guest's thread rather than opening a second one", async () => {
    const first = await start(guest, "One");
    const second = await start(guest, "Two");

    expect(second.id).toBe(first.id);
    expect(await threads(guest)).toHaveLength(1);
  });

  it("keeps each side to its own threads", async () => {
    const mine = await start(guest);

    await start(otherGuest);

    expect((await threads(guest)).map((thread) => thread.id)).toEqual([
      mine.id,
    ]);
    expect(await threads(owner)).toHaveLength(2);
    expect(await threads(otherOwner)).toEqual([]);
    expect(
      await threads(otherGuest, {
        listingId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toEqual([]);
  });

  it("pages one list over the threads an account has as a guest and as a host", async () => {
    const listingAt = async (agent: Agent): Promise<string> =>
      (
        (await agent.post("/listings").send(listingInput).expect(201)).body as {
          id: string;
        }
      ).id;
    const write = async (
      agent: Agent,
      about: string,
      body: string,
    ): Promise<string> =>
      conversationSchema.parse(
        (
          await agent
            .post("/conversations")
            .send({ listingId: about, body })
            .expect(201)
        ).body,
      ).id;

    const asGuestOld = await write(guest, listingId, "First");
    const asGuestNew = await write(guest, await listingAt(owner), "Second");

    // The guest becomes a host: the row is promoted and a new token says so.
    await app.get(PrismaService).user.update({
      where: { email: credentialsFor.USER.email },
      data: { role: Role.OWNER },
    });
    await guest.post("/auth/login").send(credentialsFor.USER).expect(200);

    const asHostOld = await write(otherGuest, await listingAt(guest), "Third");
    const asHostNew = await write(otherGuest, await listingAt(guest), "Fourth");

    // The oldest guest thread moves to the top: the two halves now interleave.
    await guest
      .post(`/conversations/${asGuestOld}/messages`)
      .send({ body: "Fifth" })
      .expect(201);

    const seen: [string, string][] = [];
    let cursor: string | null = null;

    do {
      const page = conversationPageSchema.parse(
        (
          await guest
            .get("/conversations")
            .query({ limit: "1", ...(cursor === null ? {} : { cursor }) })
            .expect(200)
        ).body,
      );

      seen.push(
        ...page.items.map(
          (thread) => [thread.id, thread.side] as [string, string],
        ),
      );
      cursor = page.nextCursor;
    } while (cursor !== null && seen.length < 10);

    expect(seen).toEqual([
      [asGuestOld, ConversationSide.GUEST],
      [asHostNew, ConversationSide.HOST],
      [asHostOld, ConversationSide.HOST],
      [asGuestNew, ConversationSide.GUEST],
    ]);
  });

  it("carries a reply to the other side and marks it read when opened", async () => {
    const started = await start(guest);
    const { id } = started;

    await owner
      .post(`/conversations/${id}/read`)
      .send({ upTo: started.lastMessage.createdAt })
      .expect(204);

    const reply = messageSchema.parse(
      (
        await owner
          .post(`/conversations/${id}/messages`)
          .send({ body: "  From noon.  " })
          .expect(201)
      ).body,
    );

    expect(reply).toMatchObject({
      sender: ConversationSide.HOST,
      body: "From noon.",
    });

    const [asGuest] = await threads(guest);

    expect(asGuest).toMatchObject({
      unread: true,
      lastMessage: { body: "From noon." },
    });

    await guest
      .post(`/conversations/${id}/read`)
      .send({ upTo: reply.createdAt })
      .expect(204);
    expect((await threads(guest))[0]?.unread).toBe(false);
  });

  it("pushes a message to the other side's stream with the unread threads, and the read after it", async () => {
    const stream = await EventStream.openAs(app, credentialsFor.OWNER);

    try {
      await expect(stream.next()).resolves.toMatchObject({
        type: "sync",
        unreadConversations: 0,
      });

      const started = await start(guest);

      await expect(stream.next()).resolves.toMatchObject({
        type: "message.created",
        message: {
          conversationId: started.id,
          sender: ConversationSide.GUEST,
        },
        unreadConversations: 1,
      });

      await owner
        .post(`/conversations/${started.id}/read`)
        .send({ upTo: started.lastMessage.createdAt })
        .expect(204);

      await expect(stream.next()).resolves.toMatchObject({
        type: "conversation.read",
        conversationId: started.id,
        unreadConversations: 0,
      });

      // The host's own reply reaches their stream too — their other tabs redraw the thread.
      await owner
        .post(`/conversations/${started.id}/messages`)
        .send({ body: "From noon." })
        .expect(201);

      await expect(stream.next()).resolves.toMatchObject({
        type: "message.created",
        message: { sender: ConversationSide.HOST },
        unreadConversations: 0,
      });
    } finally {
      stream.close();
    }
  });

  it("marks read only up to the message the screen showed", async () => {
    const started = await start(guest, "One");
    const { id } = started;

    await start(guest, "Two");
    await owner
      .post(`/conversations/${id}/read`)
      .send({ upTo: started.lastMessage.createdAt })
      .expect(204);

    expect((await threads(owner))[0]?.unread).toBe(true);
  });

  it("keeps the newest message the thread's moment when both sides write at once", async () => {
    const { id } = await start(guest);

    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        (index % 2 === 0 ? guest : owner)
          .post(`/conversations/${id}/messages`)
          .send({ body: `Message ${index}` })
          .expect(201),
      ),
    );

    const page = messagePageSchema.parse(
      (await guest.get(`/conversations/${id}/messages`).expect(200)).body,
    );
    const moments = page.items.map((message) => message.createdAt);
    const [asGuest] = await threads(guest);
    const [asHost] = await threads(owner);

    // Every message a moment of its own, and the thread as recent as the newest of them.
    expect(new Set(moments).size).toBe(moments.length);
    expect(asGuest?.lastMessage).toEqual({
      sender: page.items[0]?.sender,
      body: page.items[0]?.body,
      createdAt: page.items[0]?.createdAt,
    });
    // Whoever wrote last has read it; the other side has something new.
    expect([asGuest?.unread, asHost?.unread].sort()).toEqual([false, true]);
  });

  it("puts first messages sent at once into one thread", async () => {
    const started = await Promise.all(
      Array.from({ length: 5 }, (_, index) => start(guest, `Hello ${index}`)),
    );

    expect(new Set(started.map((thread) => thread.id)).size).toBe(1);

    const page = messagePageSchema.parse(
      (
        await guest
          .get(`/conversations/${started[0]?.id ?? ""}/messages`)
          .expect(200)
      ).body,
    );

    expect(page.items).toHaveLength(5);
  });

  it("orders the list by the newest message and pages the thread from its end", async () => {
    const older = await start(guest, "First");
    const newer = await start(otherGuest, "Second");

    expect((await threads(owner)).map((thread) => thread.id)).toEqual([
      newer.id,
      older.id,
    ]);

    await owner
      .post(`/conversations/${older.id}/messages`)
      .send({ body: "Third" })
      .expect(201);

    expect((await threads(owner)).map((thread) => thread.id)).toEqual([
      older.id,
      newer.id,
    ]);

    const first = messagePageSchema.parse(
      (
        await guest
          .get(`/conversations/${older.id}/messages`)
          .query({ limit: "1" })
          .expect(200)
      ).body,
    );

    expect(first.items.map((message) => message.body)).toEqual(["Third"]);

    const rest = messagePageSchema.parse(
      (
        await guest
          .get(`/conversations/${older.id}/messages`)
          .query({ limit: "1", cursor: first.nextCursor ?? "" })
          .expect(200)
      ).body,
    );

    expect(rest.items.map((message) => message.body)).toEqual(["First"]);
    expect(rest.nextCursor).toBeNull();
  });

  it("answers anybody who is neither side with a 404", async () => {
    const { id } = await start(guest);

    for (const outsider of [otherGuest, otherOwner]) {
      await outsider.get(`/conversations/${id}`).expect(404);
      await outsider.get(`/conversations/${id}/messages`).expect(404);
      await outsider
        .post(`/conversations/${id}/messages`)
        .send({ body: "Hi" })
        .expect(404);
      await outsider
        .post(`/conversations/${id}/read`)
        .send({ upTo: new Date().toISOString() })
        .expect(404);
    }

    await admin.get(`/conversations/${id}`).expect(403);
    await admin.get("/conversations").expect(403);
  });

  it("lets only a guest start a thread, about a listing on offer", async () => {
    await owner
      .post("/conversations")
      .send({ listingId, body: "Hello" })
      .expect(403);

    await owner.delete(`/listings/${listingId}`).expect(204);

    const refused = await guest
      .post("/conversations")
      .send({ listingId, body: "Hello" })
      .expect(404);

    expect(apiErrorSchema.parse(refused.body).statusCode).toBe(404);
  });

  it("keeps a thread open after its listing is retired", async () => {
    const { id } = await start(guest);

    await owner.delete(`/listings/${listingId}`).expect(204);

    await owner
      .post(`/conversations/${id}/messages`)
      .send({ body: "It is no longer offered, but your stay stands." })
      .expect(201);
    expect((await threads(guest))[0]?.listing.title).toBe(listingInput.title);
  });

  it("refuses an empty message under its field", async () => {
    const refused = await guest
      .post("/conversations")
      .send({ listingId, body: "   " })
      .expect(400);

    expect(
      apiErrorSchema.parse(refused.body).errors?.map((issue) => issue.path),
    ).toContainEqual(["body"]);
  });
});
