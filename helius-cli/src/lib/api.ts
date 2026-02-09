import { API_URL, CLI_USER_AGENT } from "../constants.js";

interface SignupResponse {
  token: string;
  refId: string;
  newUser: boolean;
}

interface Subscription {
  id: string;
  plan: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  cryptoSub: boolean;
  paymentServiceProvider: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface DnsRecord {
  id: string;
  dns: string;
  network: string;
  usageType: string;
}

interface ApiKey {
  keyId: string;
  keyName: string;
  walletId: string;
  projectId: string;
  usagePlan: string;
  createdAt: number;
  prepaidCredits: number;
}

interface CreditsUsage {
  totalCreditsUsed: number;
  remainingCredits: number;
  remainingPrepaidCredits: number;
  prepaidCreditsUsed: number;
  overageCreditsUsed: number;
  overageCost: number;
  webhookUsage: number;
  apiUsage: number;
  rpcUsage: number;
  rpcGPAUsage: number;
}

interface BillingCycle {
  start: string;
  end: string;
}

interface SubscriptionPlanDetails {
  currentPlan: string;
  upcomingPlan: string;
  isUpgrading: boolean;
}

// Project from GET /projects (list)
interface ProjectListItem {
  id: string;
  name: string;
  createdAt: string;
  verifiedEmail: string | null;
  subscription: Subscription;
  users: User[];
  dnsRecords: DnsRecord[];
}

// Project from GET /projects/{id} (details)
interface ProjectDetails {
  apiKeys: ApiKey[];
  creditsUsage: CreditsUsage;
  billingCycle: BillingCycle;
  subscriptionPlanDetails: SubscriptionPlanDetails;
  prepaidCreditsLink: string;
}

// Combined project type for internal use
export interface Project extends ProjectListItem {
  apiKeys?: ApiKey[];
  creditsUsage?: CreditsUsage;
  billingCycle?: BillingCycle;
  subscriptionPlanDetails?: SubscriptionPlanDetails;
  prepaidCreditsLink?: string;
}

export type { ApiKey, CreditsUsage, DnsRecord, Subscription, User, BillingCycle };

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": CLI_USER_AGENT,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

export async function signup(
  message: string,
  signature: string,
  userID: string
): Promise<SignupResponse> {
  return request<SignupResponse>("/wallet-signup", {
    method: "POST",
    body: JSON.stringify({ message, signature, userID }),
  });
}

export async function createProject(jwt: string): Promise<Project> {
  return request<Project>("/projects/create", {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({}),
  });
}

export async function listProjects(jwt: string): Promise<ProjectListItem[]> {
  return request<ProjectListItem[]>("/projects", {
    method: "GET",
    headers: { Authorization: `Bearer ${jwt}` },
  });
}

export async function getProject(jwt: string, id: string): Promise<ProjectDetails> {
  return request<ProjectDetails>(`/projects/${id}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${jwt}` },
  });
}

export async function createApiKey(
  jwt: string,
  projectId: string,
  walletAddress: string
): Promise<ApiKey> {
  return request<ApiKey>(`/projects/${projectId}/add-key`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ userId: walletAddress }),
  });
}
