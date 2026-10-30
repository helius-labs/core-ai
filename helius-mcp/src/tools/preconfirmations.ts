import type { ActionRegistry } from '../router/action-registry.js';
import { GATEKEEPER_RPC_URL, hasApiKey, rpcRequest } from '../utils/helius.js';
import { noApiKeyResponse } from './shared.js';
import { mcpText, handleToolError } from '../utils/errors.js';
import { contextFromExtra } from '../utils/request-context.js';

type PreConfCoverage = { networkSharePercent: number; coverageByRegion: Record<string, number> };

export function registerPreconfirmationTools(registry: ActionRegistry) {
  registry.registerAction(
    'getPreConfCoverage',
    'BEST FOR: deciding whether Preconfirmations will see enough of the network for a use case. Returns the share of mainnet stake that Preconfirmations covers (Helius and Jito BAM combined) and how that covered stake splits across regions, for choosing a subscription region. Coverage is by stake, not by share of transactions delivered.',
    {},
    async (_args, extra) => {
      const ctx = contextFromExtra(extra);
      if (!hasApiKey(ctx)) return noApiKeyResponse();

      let coverage: PreConfCoverage;
      try {
        // Gatekeeper serves mainnet only, so this is mainnet coverage on any network setting.
        coverage = await rpcRequest<PreConfCoverage>('getPreConfCoverage', undefined, ctx, GATEKEEPER_RPC_URL);
      } catch (err) {
        return handleToolError(err, 'Preconfirmations Coverage Error');
      }

      const regions = Object.entries(coverage.coverageByRegion ?? {}).sort(([, a], [, b]) => b - a);
      const lines = [
        '**Preconfirmations Coverage (mainnet)**',
        '',
        `**Network stake covered:** ${coverage.networkSharePercent}%`,
      ];
      if (regions.length > 0) {
        lines.push('', '**Covered stake by region:**');
        for (const [region, share] of regions) {
          lines.push(`- \`${region}\`: ${(share * 100).toFixed(0)}%`);
        }
      }
      lines.push('', '_Coverage is measured by stake. It does not guarantee a continuous stream or a share of transactions delivered._');
      return mcpText(lines.join('\n'));
    },
  );
}
