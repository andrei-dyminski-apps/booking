import type { INestApplication } from "@nestjs/common";
import { Role } from "@repo/contracts";
import request from "supertest";
import type { App } from "supertest/types";
import { PrismaService } from "./../src/prisma/prisma.service";

/** The credentials every e2e spec registers with; the tables are wiped before each test. */
export const testCredentials = {
  name: "E2E Guest",
  email: "e2e@example.com",
  password: "password123",
};

/** What registration takes; login reads the address and the password and ignores the name. */
export type Credentials = typeof testCredentials;

/** One address per role, so a spec can hold several agents at once. */
export const credentialsFor: Record<Role, Credentials> = {
  USER: testCredentials,
  OWNER: {
    name: "E2E Owner",
    email: "e2e-owner@example.com",
    password: "password123",
  },
  ADMIN: {
    name: "E2E Admin",
    email: "e2e-admin@example.com",
    password: "password123",
  },
};

export type Agent = ReturnType<typeof request.agent>;

/**
 * A supertest agent that keeps the auth cookies. Every route except the ones marked
 * @Public() is behind the global guard, so a spec that touches the API needs one.
 */
export async function signIn(
  app: INestApplication<App>,
  credentials = testCredentials,
): Promise<Agent> {
  const agent = request.agent(app.getHttpServer());

  await agent.post("/auth/register").send(credentials).expect(201);

  return agent;
}

/**
 * The same, for a role registration cannot produce: `/auth/register` always writes a USER,
 * which is the only safe default for a public endpoint. So the row is promoted directly
 * and the agent logs in again — the access token minted at registration still carries the
 * old role, and JwtStrategy reads no database, which is exactly the lag RolesGuard would
 * otherwise be tested against by accident.
 */
export async function signInAs(
  app: INestApplication<App>,
  role: Role,
  credentials = credentialsFor[role],
): Promise<Agent> {
  const agent = await signIn(app, credentials);

  if (role === Role.USER) return agent;

  await app
    .get(PrismaService)
    .user.update({ where: { email: credentials.email }, data: { role } });
  await agent.post("/auth/login").send(credentials).expect(200);

  return agent;
}

/** The value of a cookie the API has just set, without the attributes that follow it. */
export function readSetCookie(
  response: request.Response,
  name: string,
): string | null {
  const header = (response.headers as Record<string, unknown>)["set-cookie"];
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));

  if (match === undefined) return null;

  const value = match.slice(name.length + 1).split(";")[0] ?? "";

  return decodeURIComponent(value);
}
