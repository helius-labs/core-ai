import type { LegacyActionName } from './legacy-actions.js';
import type { RoutedPublicToolName } from './action-groups.js';

export type DetailLevel = 'summary' | 'standard' | 'full';
export type ResponseFamily =
  | 'scalar'
  | 'mutationReceipt'
  | 'record'
  | 'list'
  | 'history'
  | 'document'
  | 'streamingConfig'
  | 'catalog';

export type AuthRequirement = 'none' | 'apiKey' | 'jwt' | 'signer' | 'jwtAndSigner';
export type Mutability = 'read' | 'write';
export type ContinuationModel = 'none' | 'transactionHistory' | 'page';

export type GatePredicate =
  | { kind: 'always' }
  | { kind: 'network'; oneOf: Array<'devnet' | 'mainnet-beta'> }
  | { kind: 'paramPresent'; field: string }
  | { kind: 'paramEquals'; field: string; value: string | number | boolean }
  | { kind: 'and'; all: GatePredicate[] };

export type CapabilityVariant = {
  id: string;
  minimumPlan: 'free' | 'developer' | 'business' | 'professional';
  predicate: GatePredicate;
  label: string;
};

export type CapabilityGate = {
  baseline: CapabilityVariant;
  variants?: CapabilityVariant[];
};

export type ActionCatalogEntry = {
  action: LegacyActionName;
  publicTool: RoutedPublicToolName;
  aliases?: string[];
  authRequirement: AuthRequirement;
  capabilityGate: CapabilityGate;
  mutability: Mutability;
  responseFamily: ResponseFamily;
  defaultDetail: DetailLevel;
  handleEligibility: boolean;
  normalizer: ResponseFamily;
  continuationModel: ContinuationModel;
};
