// Re-export checkout and payment functions from helius-sdk
import { CLI_USER_AGENT } from "../constants.js";
import { initializeCheckout as sdkInitializeCheckout } from "helius-sdk/auth/checkout";
import { pollCheckoutCompletion as sdkPollCheckoutCompletion } from "helius-sdk/auth/checkout";
import { executeCheckout as sdkExecuteCheckout } from "helius-sdk/auth/checkout";
import { getCheckoutPreview as sdkGetCheckoutPreview } from "helius-sdk/auth/checkout";
import { getPaymentIntent as sdkGetPaymentIntent } from "helius-sdk/auth/checkout";
import { executeUpgrade as sdkExecuteUpgrade } from "helius-sdk/auth/checkout";
import { executeRenewal as sdkExecuteRenewal } from "helius-sdk/auth/checkout";
import type {
  CheckoutInitializeRequest,
  CheckoutInitializeResponse,
  CheckoutStatusResponse,
  CheckoutPreviewResponse,
  CheckoutResult,
  CheckoutRequest,
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

export async function executeCheckout(
  secretKey: Uint8Array,
  jwt: string,
  request: CheckoutRequest,
  userAgent?: string,
  options?: { skipProjectPolling?: boolean },
): Promise<CheckoutResult> {
  return sdkExecuteCheckout(secretKey, jwt, request, userAgent ?? CLI_USER_AGENT, options);
}

export async function getCheckoutPreview(
  jwt: string,
  plan: string,
  period: "monthly" | "yearly",
  refId: string,
  couponCode?: string,
): Promise<CheckoutPreviewResponse> {
  return sdkGetCheckoutPreview(jwt, plan, period, refId, couponCode, CLI_USER_AGENT);
}

export async function getPaymentIntent(
  jwt: string,
  paymentIntentId: string,
): Promise<CheckoutInitializeResponse> {
  return sdkGetPaymentIntent(jwt, paymentIntentId, CLI_USER_AGENT);
}

export async function executeUpgrade(
  secretKey: Uint8Array,
  jwt: string,
  plan: string,
  period: "monthly" | "yearly",
  projectId: string,
  couponCode?: string,
): Promise<CheckoutResult> {
  return sdkExecuteUpgrade(secretKey, jwt, plan, period, projectId, couponCode, CLI_USER_AGENT);
}

export async function executeRenewal(
  secretKey: Uint8Array,
  jwt: string,
  paymentIntentId: string,
): Promise<CheckoutResult> {
  return sdkExecuteRenewal(secretKey, jwt, paymentIntentId, CLI_USER_AGENT);
}

export { payWithMemo } from "helius-sdk/auth/payWithMemo";
export { payPaymentIntent } from "helius-sdk/auth/checkout";
export { PLAN_CATALOG } from "helius-sdk/auth/planCatalog";

export type {
  CheckoutInitializeRequest,
  CheckoutInitializeResponse,
  CheckoutStatusResponse,
  CheckoutPreviewResponse,
  CheckoutResult,
  CheckoutRequest,
} from "helius-sdk/auth/types";
