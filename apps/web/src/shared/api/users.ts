import {
  managedUserSchema,
  userPageSchema,
  type ManagedUser,
  type UpdateUserInput,
  type UserPage,
  type UserQuery,
} from "@repo/contracts";
import { apiRequest, queryString, type ReadOptions } from "./http-client";

/**
 * The accounts, as the admin's section reads and changes them — written down once like
 * every other resource. Every route behind it is `@Roles(Role.ADMIN)` on the API side, and
 * nothing here repeats that: a call from any other session is a `403` on its own merits.
 */
export const usersApi = {
  /**
   * One page of accounts. The filters, the ordering and the cursor travel in the query
   * string for the reason the stays' do: the search lives in the address bar.
   */
  page: (query: UserQuery, read: ReadOptions): Promise<UserPage> =>
    apiRequest({
      method: "GET",
      path: `/users${queryString(query)}`,
      schema: userPageSchema,
      read,
    }),

  update: (id: string, input: UpdateUserInput): Promise<ManagedUser> =>
    apiRequest({
      method: "PATCH",
      path: `/users/${encodeURIComponent(id)}`,
      schema: managedUserSchema,
      body: input,
    }),
};
