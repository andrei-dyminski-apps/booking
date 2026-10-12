"use server";

import { refresh } from "next/cache";
import { notificationsApi } from "#shared/api";
import { NO_FORM_ERRORS, toFormErrors, type FormErrors } from "#shared/lib";

/**
 * Marking the whole feed read. The page is read `no-store`, so `refresh()` is all it takes
 * to redraw it; the bell in every open tab hears about it from the API's event stream.
 */
export async function markAllReadAction(): Promise<FormErrors> {
  try {
    await notificationsApi.markAllRead();
  } catch (error) {
    return toFormErrors(error);
  }

  refresh();

  return NO_FORM_ERRORS;
}
