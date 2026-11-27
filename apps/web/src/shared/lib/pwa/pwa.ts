/**
 * What the browser offers an installable site and its pushes, behind feature checks:
 * every one of these is missing somewhere — Firefox has no install prompt, Safari on an
 * iPhone pushes only to a site added to the home screen.
 */

/** Chromium's `beforeinstallprompt`, which no DOM typing describes yet. */
type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/**
 * Keeps the browser's install offer for a button to use later. It fires once, early, on
 * whichever page the visit starts on, so the shell listens on every page and a screen
 * reads what it kept. The browser's own offer is left alone — no `preventDefault` — and
 * the button is a second way to the same prompt.
 */
export function captureInstallPrompt(): () => void {
  const offered = (event: Event) => {
    deferredPrompt = event as InstallPromptEvent;
    announce();
  };

  const installed = () => {
    deferredPrompt = null;
    announce();
  };

  window.addEventListener("beforeinstallprompt", offered);
  window.addEventListener("appinstalled", installed);

  return () => {
    window.removeEventListener("beforeinstallprompt", offered);
    window.removeEventListener("appinstalled", installed);
  };
}

/** For `useSyncExternalStore`: whether an install offer is waiting. */
export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function canPromptInstall(): boolean {
  return deferredPrompt !== null;
}

/** Shows the browser's install dialog; an offer is good for one prompt. */
export async function promptInstall(): Promise<boolean> {
  const prompt = deferredPrompt;

  if (prompt === null) return false;

  deferredPrompt = null;
  announce();
  await prompt.prompt();

  return (await prompt.userChoice).outcome === "accepted";
}

/** Running as the installed app rather than in a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true)
  );
}

/**
 * An iPhone or an iPad, where a site is installed by hand from the share sheet and nothing
 * fires `beforeinstallprompt`. An iPad asks for the desktop site and reads as a Mac,
 * which a touch screen gives away.
 */
export function isAppleMobile(userAgent: string, touchPoints: number): boolean {
  return (
    /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && touchPoints > 1)
  );
}

/** Whether this browser can be pushed to at all. */
export function supportsPush(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
}

/** The VAPID key as `pushManager.subscribe` takes it: base64url text to bytes. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
