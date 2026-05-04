// Re-export payment and balance functions from helius-sdk
export { checkSolBalance, checkUsdcBalance } from "helius-sdk/auth/checkBalances";
export { MIN_SOL_FOR_TX } from "helius-sdk/auth/constants";

import { getPaymentStatus, type CheckoutStatusResponse } from "./api.js";
import type ora from "ora";

type Spinner = ReturnType<typeof ora> | null | undefined;

export type RefreshVerdict = "cleared" | "completed" | "still_payable";

/**
 * Shared backend-status check used by signup/upgrade/credits when a stored
 * payment intent's local `expiresAt` has passed. The backend is the source
 * of truth — local clocks lie, and a user could pay just before backend
 * expiry yet return after.
 *
 * - `cleared`     — backend reports expired/failed/410-Gone; caller should
 *                   clear the stored intent and decide whether to fall
 *                   through to a fresh-intent path.
 * - `completed`   — backend reports the payment has settled (regardless of
 *                   `readyToRedirect`); caller should drive its own
 *                   poll-and-emit / poll-and-provision flow.
 * - `still_payable` — backend reports `pending`; caller should re-print the
 *                   existing payment link.
 */
export async function checkBackendForRefresh(
  jwt: string,
  paymentIntentId: string,
  spinner?: Spinner,
): Promise<{ verdict: RefreshVerdict; status?: CheckoutStatusResponse }> {
  spinner?.start("Stored payment link is past its local expiry — checking backend...");
  let status: CheckoutStatusResponse;
  try {
    status = await getPaymentStatus(jwt, paymentIntentId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("410")) {
      spinner?.succeed("Stored intent expired on the backend");
      return { verdict: "cleared" };
    }
    throw error;
  }
  spinner?.succeed(`Backend status: ${status.phase}`);

  if (status.phase === "expired" || status.phase === "failed") {
    return { verdict: "cleared", status };
  }
  if (status.status === "completed" || status.readyToRedirect) {
    return { verdict: "completed", status };
  }
  return { verdict: "still_payable", status };
}
