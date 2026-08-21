import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { App } from "supertest/types";

/** The credentials every e2e spec registers with; the tables are wiped before each test. */
export const testCredentials = {
  email: "e2e@example.com",
  password: "password123",
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
