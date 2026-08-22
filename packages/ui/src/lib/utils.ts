import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges conditional class names and lets a later Tailwind utility win over an earlier one. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
