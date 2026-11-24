import { AsyncLocalStorage } from "node:async_hooks";
export const mailRequestContext = new AsyncLocalStorage<string>();
