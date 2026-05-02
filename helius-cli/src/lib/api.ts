// Re-export auth functions and types from helius-sdk
import { CLI_USER_AGENT } from "../constants.js";
import { walletSignup as sdkWalletSignup } from "helius-sdk/auth/walletSignup";
import { createProject as sdkCreateProject } from "helius-sdk/auth/createProject";
import { listProjects as sdkListProjects } from "helius-sdk/auth/listProjects";
import { getProject as sdkGetProject } from "helius-sdk/auth/getProject";
import { createApiKey as sdkCreateApiKey } from "helius-sdk/auth/createApiKey";
import { agenticSignup as sdkAgenticSignup } from "helius-sdk/auth/agenticSignup";
import { signup as sdkSignup } from "helius-sdk/auth/signup";
import { signupAndPay as sdkSignupAndPay } from "helius-sdk/auth/signupAndPay";
import { payPaymentLink as sdkPayPaymentLink } from "helius-sdk/auth/payPaymentLink";
import { getPaymentStatus as sdkGetPaymentStatus } from "helius-sdk/auth/checkout";
import {
  upgradePlan as sdkUpgradePlan,
  upgradePlanAndPay as sdkUpgradePlanAndPay,
} from "helius-sdk/auth/upgradePlan";
import {
  purchaseCredits as sdkPurchaseCredits,
  purchaseCreditsAndPay as sdkPurchaseCreditsAndPay,
} from "helius-sdk/auth/purchaseCredits";
import {
  payRenewal as sdkPayRenewal,
  payRenewalAndPay as sdkPayRenewalAndPay,
} from "helius-sdk/auth/payRenewal";
import type {
  SignupResponse,
  Project,
  ProjectListItem,
  ProjectDetails,
  ApiKey,
  AgenticSignupOptions,
  AgenticSignupResult,
  SignupOptions,
  SignupResult,
  SignupAndPayOptions,
  SignupAndPayResult,
  PaymentLink,
  CheckoutStatusResponse,
  UpgradePlanOptions,
  UpgradePlanResult,
  UpgradePlanAndPayOptions,
  UpgradePlanAndPayResult,
  PurchaseCreditsLinkOptions,
  PurchaseCreditsLinkResult,
  PurchaseCreditsAndPayOptions,
  PurchaseCreditsAndPayResult,
  PayRenewalResult,
  PayRenewalAndPayResult,
} from "helius-sdk/auth/types";

// Wrap SDK functions to pass CLI user agent.
//
// Renamed from `signup` → `walletSignup` to free the `signup` name for the new
// SDK signup flow (Phase 1). Existing callers in commands/login.ts, pay.ts,
// upgrade.ts use this for low-level wallet authentication only.
export async function walletSignup(
  message: string,
  signature: string,
  userID: string,
): Promise<SignupResponse> {
  return sdkWalletSignup(message, signature, userID, CLI_USER_AGENT);
}

export async function createProject(jwt: string): Promise<Project> {
  return sdkCreateProject(jwt, CLI_USER_AGENT);
}

export async function listProjects(jwt: string): Promise<ProjectListItem[]> {
  return sdkListProjects(jwt, CLI_USER_AGENT);
}

export async function getProject(jwt: string, id: string): Promise<ProjectDetails> {
  return sdkGetProject(jwt, id, CLI_USER_AGENT);
}

export async function createApiKey(
  jwt: string,
  projectId: string,
  walletAddress: string,
): Promise<ApiKey> {
  return sdkCreateApiKey(jwt, projectId, walletAddress, CLI_USER_AGENT);
}

export async function agenticSignup(
  options: Omit<AgenticSignupOptions, "userAgent">,
): Promise<AgenticSignupResult> {
  return sdkAgenticSignup({ ...options, userAgent: CLI_USER_AGENT });
}

// New Phase 1 signup surface — pass-through with no userAgent (the SDK doesn't
// thread one through these helpers yet; that's a Phase 2 cleanup).
export async function signup(options: SignupOptions): Promise<SignupResult> {
  return sdkSignup(options);
}

export async function signupAndPay(
  options: SignupAndPayOptions,
): Promise<SignupAndPayResult> {
  return sdkSignupAndPay(options);
}

export async function payPaymentLink(
  secretKey: Uint8Array,
  paymentLink: PaymentLink,
): Promise<{ txSignature: string }> {
  return sdkPayPaymentLink(secretKey, paymentLink);
}

export async function getPaymentStatus(
  jwt: string,
  paymentIntentId: string,
): Promise<CheckoutStatusResponse> {
  return sdkGetPaymentStatus(jwt, paymentIntentId, CLI_USER_AGENT);
}

// Phase 2 helpers — pass-through to the SDK.
export async function upgradePlan(
  options: UpgradePlanOptions,
): Promise<UpgradePlanResult> {
  return sdkUpgradePlan(options);
}
export async function upgradePlanAndPay(
  options: UpgradePlanAndPayOptions,
): Promise<UpgradePlanAndPayResult> {
  return sdkUpgradePlanAndPay(options);
}
export async function purchaseCredits(
  options: PurchaseCreditsLinkOptions,
): Promise<PurchaseCreditsLinkResult> {
  return sdkPurchaseCredits(options);
}
export async function purchaseCreditsAndPay(
  options: PurchaseCreditsAndPayOptions,
): Promise<PurchaseCreditsAndPayResult> {
  return sdkPurchaseCreditsAndPay(options);
}
export async function payRenewal(
  jwt: string,
  paymentIntentId: string,
  options: { paymentHost?: string } = {},
): Promise<PayRenewalResult> {
  return sdkPayRenewal(jwt, paymentIntentId, options);
}
export async function payRenewalAndPay(
  secretKey: Uint8Array,
  jwt: string,
  paymentIntentId: string,
  options: { paymentHost?: string } = {},
): Promise<PayRenewalAndPayResult> {
  return sdkPayRenewalAndPay(secretKey, jwt, paymentIntentId, options);
}

export type {
  Project,
  ProjectListItem,
  ProjectDetails,
  ApiKey,
  AgenticSignupResult,
  CreditsUsage,
  DnsRecord,
  Subscription,
  User,
  BillingCycle,
  SignupOptions,
  SignupResult,
  SignupAndPayOptions,
  SignupAndPayResult,
  PaymentLink,
  CheckoutStatusResponse,
  UpgradePlanOptions,
  UpgradePlanResult,
  UpgradePlanAndPayOptions,
  UpgradePlanAndPayResult,
  PurchaseCreditsLinkOptions,
  PurchaseCreditsLinkResult,
  PurchaseCreditsAndPayOptions,
  PurchaseCreditsAndPayResult,
  PayRenewalResult,
  PayRenewalAndPayResult,
} from "helius-sdk/auth/types";
