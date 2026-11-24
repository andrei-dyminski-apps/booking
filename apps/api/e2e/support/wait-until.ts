/** Polls rather than sleeps: what is being waited for is a worker in another loop. */
export async function waitUntil(
  condition: () => Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) return;

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Condition was not met within ${String(timeoutMs)}ms`);
}
