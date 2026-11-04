import { z } from "zod";
import {
  cancelBookingSchema,
  hostCancelBookingSchema,
  type CancelBookingInput,
} from "@repo/contracts";

/** The one box of a cancellation: why, as typed — blank until somebody writes something. */
export type CancelFormValues = { reason: string };

type CancelFormSchema = z.ZodType<CancelBookingInput, CancelFormValues>;

const HOST_CANCEL_FORM: CancelFormSchema = hostCancelBookingSchema;

const CANCEL_FORM: CancelFormSchema = z.object({
  reason: cancelBookingSchema.shape.reason.unwrap(),
});

/**
 * The contract's body for the box: the host's, where the reason is required, or everybody
 * else's, where a blank one is nothing — its rule for the reason, which a box always holds.
 * The words are the contract's either way, and the API refuses a host's blank reason with
 * the same sentence. Built once rather than per render, so the form's resolver keeps one
 * schema for as long as it is on the screen.
 */
export function cancelFormSchema(asHost: boolean): CancelFormSchema {
  return asHost ? HOST_CANCEL_FORM : CANCEL_FORM;
}
