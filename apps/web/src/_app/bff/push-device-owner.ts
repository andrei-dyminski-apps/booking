import { currentUser, pushDeviceAccount } from "#shared/api";

export async function readPushDeviceOwner(): Promise<Response> {
  const owner = await pushDeviceAccount(
    async () => (await currentUser())?.id ?? null,
  );
  return Response.json(owner, {
    headers: { "Cache-Control": "no-store" },
  });
}
