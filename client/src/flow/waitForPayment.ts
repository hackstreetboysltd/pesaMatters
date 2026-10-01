import { api, type Receipt } from "../api";

/** Poll until Daraja (or the in-pot send) settles. Stops after about 80 seconds. */
export async function waitForPayment(id: string): Promise<Receipt> {
  let latest: Receipt | null = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 2000);
      });
    }
    latest = await api.checkPayment(id);
    if (latest.status === "succeeded" || latest.status === "failed") return latest;
  }
  if (latest === null) return api.payment(id);
  return latest;
}
