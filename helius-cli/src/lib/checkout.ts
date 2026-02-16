// Re-export checkout and payment functions from helius-sdk
import { CLI_USER_AGENT } from "../constants.js";
import { initializeCheckout as sdkInitializeCheckout } from "helius-sdk/auth/checkout";
import { pollCheckoutCompletion as sdkPollCheckoutCompletion } from "helius-sdk/auth/checkout";
import type {
  CheckoutInitializeRequest,
  CheckoutInitializeResponse,
  CheckoutStatusResponse,
} from "helius-sdk/auth/types";

export async function initializeCheckout(
  jwt: string,
  request: CheckoutInitializeRequest,
): Promise<CheckoutInitializeResponse> {
  return sdkInitializeCheckout(jwt, request, CLI_USER_AGENT);
}

export async function pollCheckoutCompletion(
  jwt: string,
  paymentIntentId: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<CheckoutStatusResponse> {
  return sdkPollCheckoutCompletion(jwt, paymentIntentId, CLI_USER_AGENT, options);
}

export { payWithMemo } from "helius-sdk/auth/payWithMemo";

export type {
  CheckoutInitializeRequest,
  CheckoutInitializeResponse,
  CheckoutStatusResponse,
} from "helius-sdk/auth/types";
