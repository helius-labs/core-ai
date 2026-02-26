// Re-export auth functions and types from helius-sdk
import { CLI_USER_AGENT } from "../constants.js";
import { walletSignup } from "helius-sdk/auth/walletSignup";
import { createProject as sdkCreateProject } from "helius-sdk/auth/createProject";
import { listProjects as sdkListProjects } from "helius-sdk/auth/listProjects";
import { getProject as sdkGetProject } from "helius-sdk/auth/getProject";
import { createApiKey as sdkCreateApiKey } from "helius-sdk/auth/createApiKey";
import { agenticSignup as sdkAgenticSignup } from "helius-sdk/auth/agenticSignup";
import type {
  SignupResponse,
  Project,
  ProjectListItem,
  ProjectDetails,
  ApiKey,
  AgenticSignupOptions,
  AgenticSignupResult,
} from "helius-sdk/auth/types";

// Wrap SDK functions to pass CLI user agent
export async function signup(
  message: string,
  signature: string,
  userID: string,
): Promise<SignupResponse> {
  return walletSignup(message, signature, userID, CLI_USER_AGENT);
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
} from "helius-sdk/auth/types";
