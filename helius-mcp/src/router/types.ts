import type { ActionName } from './actions.js';
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

/**
 * Whether an auth requirement can only be satisfied by a secret held on the
 * host — a signing key or a dashboard session — as opposed to a credential the
 * caller presents with the request.
 *
 * The `switch` is exhaustive on purpose: a new `AuthRequirement` variant fails
 * to compile here rather than silently falling into one side of the split.
 */
export function needsHostSecret(auth: AuthRequirement): boolean {
  switch (auth) {
    case 'jwt':
    case 'signer':
    case 'jwtAndSigner':
      return true;
    case 'none':
    case 'apiKey':
      return false;
  }
}
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
  minimumPlan: 'agent' | 'developer' | 'business' | 'professional';
  predicate: GatePredicate;
  label: string;
};

export type CapabilityGate = {
  baseline: CapabilityVariant;
  variants?: CapabilityVariant[];
};

export type ActionCatalogEntry = {
  action: ActionName;
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
