import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { ACTION_GROUPS, type RoutedPublicToolName } from '../src/router/action-groups.js';
import { getActionHandlers } from '../src/router/action-handlers.js';
import { ACTION_NAMES } from '../src/router/actions.js';
import { ACTION_CATALOG } from '../src/router/catalog.js';
import { FIELD_DESCRIPTIONS } from '../src/router/description-text.js';
import { collectPublicFields } from '../src/router/descriptions.js';
import { ACTION_REQUIRED_PARAMS } from '../src/router/required-params.js';
import { getToolSchema } from '../src/router/schemas.js';
import { getStrippedParams, getSurfaceActions, type Surface } from '../src/router/surface.js';
import { TELEMETRY_FIELDS } from '../src/router/telemetry.js';

type ListedTool = {
  name: string;
  description?: string;
  inputSchema: { properties?: Record<string, { description?: string }> };
};

async function listTools(surface: Surface): Promise<Map<string, ListedTool>> {
  const server = createServer({ surface });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'tool-descriptions-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return new Map(tools.map((tool) => [tool.name, tool as ListedTool]));
}

const SURFACES: Surface[] = ['full', 'readOnly'];
const ROUTED = Object.keys(ACTION_GROUPS) as RoutedPublicToolName[];
const ROUTING_FIELDS = new Set(['action', 'detail', 'args', ...Object.keys(TELEMETRY_FIELDS)]);

/**
 * What a model receives from tools/list, in UTF-8 bytes. Raise these
 * deliberately: every byte is sent at the start of every session by clients
 * that load all tools. Set about 8% above the size when they were introduced
 * (66.4 KB full, heliusStreaming 11.8 KB), room for a few more actions.
 */
const BUDGET = { totalBytes: 72_000, perToolBytes: 13_000 };

type JsonType = { type?: string; enum?: unknown[]; anyOf?: JsonType[]; items?: JsonType };

function toJson(type: z.ZodType): JsonType {
  return z.toJSONSchema(type, { io: 'input', unrepresentable: 'any' }) as JsonType;
}

/**
 * Whether every value `reader` accepts passes `field`, so a public field never
 * rejects input its action takes. Arrays compare their items; anything else
 * compares its JSON type and enum values.
 */
function accepts(field: JsonType, reader: JsonType): boolean {
  if (reader.anyOf) return reader.anyOf.every((branch) => accepts(field, branch));
  if (field.anyOf) return field.anyOf.some((branch) => accepts(branch, reader));
  if (!field.type) return true;
  if (!reader.type) return false;
  const sameType = field.type === reader.type || (field.type === 'number' && reader.type === 'integer');
  if (!sameType) return false;
  if (field.enum && !(reader.enum ?? [undefined]).every((value) => field.enum!.includes(value))) return false;
  if (field.type === 'array') return accepts(field.items ?? {}, reader.items ?? {});
  return true;
}

describe('generated tool definitions', () => {
  it('has a public description for every field its actions describe differently', () => {
    for (const tool of ROUTED) {
      for (const [field, { texts }] of collectPublicFields(tool, 'full')) {
        if (texts.size > 1) {
          expect(FIELD_DESCRIPTIONS[tool]?.[field], `${tool}.${field} needs an entry in FIELD_DESCRIPTIONS: its actions describe it ${texts.size} ways`).toBeTruthy();
        }
      }
    }
  });

  it('has no FIELD_DESCRIPTIONS entry for a field the tool does not take', () => {
    for (const [tool, fields] of Object.entries(FIELD_DESCRIPTIONS) as Array<[RoutedPublicToolName, Record<string, string>]>) {
      const schema = getToolSchema(tool, 'full');
      for (const field of Object.keys(fields)) {
        expect(schema[field], `FIELD_DESCRIPTIONS.${tool}.${field} names a field the tool does not take`).toBeDefined();
      }
    }
  });

  it('only exposes fields that some action reads', () => {
    // A field no action declares is dropped before the handler sees it, so a
    // model that fills it in gets a confusing "missing parameter" error.
    const handlers = getActionHandlers();
    for (const tool of ROUTED) {
      const declared = new Set(ACTION_GROUPS[tool].flatMap((action) => Object.keys((handlers.get(action)?.inputSchema ?? {}) as object)));
      for (const field of Object.keys(getToolSchema(tool, 'full'))) {
        if (ROUTING_FIELDS.has(field)) continue;
        expect(declared.has(field), `${tool}.${field} is not read by any action`).toBe(true);
      }
    }
  });

  it('declares no action parameter under a routing field name', () => {
    // dispatch consumes action, detail, and args before the handler runs, so a
    // handler parameter with one of those names is unreachable at the top level.
    const handlers = getActionHandlers();
    for (const action of ACTION_NAMES) {
      for (const field of Object.keys((handlers.get(action)?.inputSchema ?? {}) as object)) {
        expect(ROUTING_FIELDS.has(field), `${action} declares ${field}, a routing field`).toBe(false);
      }
    }
  });

  it('requires only parameters the action declares', () => {
    const handlers = getActionHandlers();
    for (const action of ACTION_NAMES) {
      const fields = Object.keys((handlers.get(action)?.inputSchema ?? {}) as object);
      for (const field of ACTION_REQUIRED_PARAMS[action] ?? []) {
        expect(fields, `${action} requires ${field}, which its handler does not take`).toContain(field);
      }
    }
  });

  for (const surface of SURFACES) {
    describe(`${surface} surface`, () => {
      it('lists every parameter an action reads as a top-level field', async () => {
        // A field missing here is stripped by the SDK before dispatch, so a
        // model that sends it at the top level loses it without an error.
        const tools = await listTools(surface);
        const handlers = getActionHandlers();
        for (const tool of ROUTED) {
          if (!tools.has(tool)) continue; // a tool with no actions on this surface is not registered
          const fields = Object.keys(tools.get(tool)!.inputSchema.properties ?? {});
          for (const action of getSurfaceActions(tool, surface)) {
            const stripped = getStrippedParams(ACTION_CATALOG[action], surface);
            for (const field of Object.keys((handlers.get(action)?.inputSchema ?? {}) as object)) {
              if (stripped.includes(field)) continue;
              expect(fields, `${tool} has no top-level ${field} for ${action}`).toContain(field);
            }
          }
        }
      });

      it('types every field to accept whatever its actions accept', () => {
        // A public field narrower than an action's would make the SDK reject a
        // value the handler takes, before dispatch.
        const handlers = getActionHandlers();
        for (const tool of ROUTED) {
          const schema = getToolSchema(tool, surface);
          for (const action of getSurfaceActions(tool, surface)) {
            const shape = (handlers.get(action)?.inputSchema ?? {}) as Record<string, z.ZodType>;
            for (const [field, type] of Object.entries(shape)) {
              if (!schema[field]) continue; // stripped on this surface; checked above
              expect(
                accepts(toJson(schema[field]), toJson(type)),
                `${tool}.${field} rejects values ${action} takes`,
              ).toBe(true);
            }
          }
        }
      });

      it('describes every field of every tool', async () => {
        for (const [name, tool] of await listTools(surface)) {
          for (const [field, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
            expect(schema.description, `${name}.${field} has no description`).toBeTruthy();
          }
        }
      });

      it('lists exactly the actions on the surface and names no other', async () => {
        const tools = await listTools(surface);
        for (const tool of ROUTED) {
          if (!tools.has(tool)) continue;
          const listed = tools.get(tool)!;
          const text = `${listed.description}\n${JSON.stringify(listed.inputSchema)}`;
          const onSurface = getSurfaceActions(tool, surface);
          for (const action of ACTION_GROUPS[tool]) {
            if (onSurface.includes(action)) {
              expect(listed.description, `${tool} description omits ${action}`).toMatch(new RegExp(`\\n- ${action}\\(`));
            } else {
              expect(text, `${tool} names ${action}, which the ${surface} surface removes`).not.toMatch(new RegExp(`\\b${action}\\b`));
            }
          }
        }
      });

      it('stays within the size budget', async () => {
        let total = 0;
        for (const [name, tool] of await listTools(surface)) {
          const bytes = Buffer.byteLength(JSON.stringify(tool));
          total += bytes;
          expect(bytes, `${name} is ${bytes} bytes`).toBeLessThanOrEqual(BUDGET.perToolBytes);
        }
        expect(total, `tools/list is ${total} bytes`).toBeLessThanOrEqual(BUDGET.totalBytes);
      });
    });
  }

  it('shows required parameters and marks state-changing actions', async () => {
    const tools = await listTools('full');
    const account = tools.get('heliusAccount')!.description ?? '';
    expect(account).toContain('- compareHeliusPlans(category):');
    expect(account).toContain('- purchaseCredits() [write]:');
    expect(account).toContain('spend USDC');
    expect(tools.get('heliusTransaction')!.description).toContain('- parseTransactions(signatures):');
    expect(tools.get('heliusWallet')!.description).toContain('- batchWalletIdentity(entries):');
    expect(tools.get('heliusStreaming')!.description).toContain('- deleteWebhook(webhookID) [write]:');
  });

  it('types a field as an enum when every action that reads it takes one', async () => {
    const tools = await listTools('full');
    const property = (tool: string, field: string) =>
      (tools.get(tool)!.inputSchema.properties ?? {})[field] as { enum?: string[]; type?: string };
    // The union across actions: getHeliusPlanInfo adds "all".
    expect(property('heliusAccount', 'plan').enum).toEqual(['agent', 'developer', 'business', 'professional', 'all']);
    expect(property('heliusAccount', 'category').enum).toEqual(['rates', 'features', 'pricing']);
    // scanTransactionHistory takes an enum, getTransactionHistory a free string.
    expect(property('heliusTransaction', 'sortOrder').enum).toBeUndefined();
  });
});
