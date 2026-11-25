import { z } from 'zod';
import type { RoutedPublicToolName } from './action-groups.js';
import { getActionHandlers } from './action-handlers.js';
import type { ActionName } from './actions.js';
import { ACTION_CATALOG } from './catalog.js';
import { ACTION_SUMMARIES, FIELD_DESCRIPTIONS, TOOL_NOTES } from './description-text.js';
import { ACTION_REQUIRED_PARAMS } from './required-params.js';
import { getStrippedParams, getSurfaceActions, type Surface } from './surface.js';

/**
 * Public tool definitions generated from their actions. A tool's description
 * lists every action on the surface with its required parameters. Each input
 * field gets one short description, taken from the actions that read it or,
 * where they disagree, from `FIELD_DESCRIPTIONS`; a field every reader takes as
 * an enum is typed as the union of their values. The text lives in
 * `description-text.ts`.
 */

const ROUTING_FIELD_DESCRIPTIONS: Record<string, string> = {
  action: 'The operation to run, from the list in the tool description.',
  detail: '"summary", "standard", or "full". Each action has a default.',
  args: 'Rarely needed: parameters as a JSON object. Top-level fields win.',
};

type JsonSchemaField = { description?: string; enum?: unknown[]; default?: unknown; type?: string };

function toJson(type: z.ZodType): JsonSchemaField {
  return z.toJSONSchema(type, { io: 'input', unrepresentable: 'any' }) as JsonSchemaField;
}

type FieldDoc = {
  description?: string;
  values?: string[];
  defaultValue?: unknown;
};

/** An action's field as its JSON Schema describes it: text, enum values, and default. */
function readFieldDoc(type: z.ZodType): FieldDoc {
  const json = toJson(type);
  return {
    description: json.description,
    values: Array.isArray(json.enum) ? json.enum.map(String) : undefined,
    defaultValue: json.default,
  };
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * An action's description of a field, with the default added when the text
 * leaves it out, and the enum values when the public field does not carry them.
 */
function renderFieldDoc(doc: FieldDoc, valuesInSchema: boolean): string {
  const parts = [doc.description ? sentence(doc.description) : ''];
  if (!valuesInSchema && doc.values && !doc.values.every((value) => doc.description?.includes(value))) {
    parts.push(`One of: ${doc.values.map((value) => `"${value}"`).join(', ')}.`);
  }
  if (doc.defaultValue !== undefined && !/default/i.test(doc.description ?? '')) {
    parts.push(`Default: ${JSON.stringify(doc.defaultValue)}.`);
  }
  return parts.filter(Boolean).join(' ');
}

type PublicField = {
  /** Union of the readers' enum values, when every reader takes an enum. */
  values?: [string, ...string[]];
  /** The distinct descriptions the readers give. */
  texts: Set<string>;
};

/**
 * What a tool's surface actions say about each of their input fields, leaving
 * out fields the surface strips.
 */
export function collectPublicFields(tool: RoutedPublicToolName, surface: Surface): Map<string, PublicField> {
  const handlers = getActionHandlers();
  const docs = new Map<string, FieldDoc[]>();
  for (const action of getSurfaceActions(tool, surface)) {
    const stripped = getStrippedParams(ACTION_CATALOG[action], surface);
    const shape = (handlers.get(action)?.inputSchema ?? {}) as Record<string, z.ZodType>;
    for (const [field, type] of Object.entries(shape)) {
      if (stripped.includes(field)) continue;
      docs.set(field, [...(docs.get(field) ?? []), readFieldDoc(type)]);
    }
  }

  const fields = new Map<string, PublicField>();
  for (const [field, readers] of docs) {
    const values = readers.every((doc) => doc.values)
      ? [...new Set(readers.flatMap((doc) => doc.values!))] as [string, ...string[]]
      : undefined;
    fields.set(field, {
      values,
      texts: new Set(readers.map((doc) => renderFieldDoc(doc, values !== undefined))),
    });
  }
  return fields;
}

/**
 * Tighten a hand-written public field to what its readers accept: a plain
 * string becomes the union of their enums. Other fields stay as written; the
 * per-action schemas still validate them at dispatch.
 */
function refineType(type: z.ZodType, field: PublicField | undefined): z.ZodType {
  if (!field?.values) return type;
  const json = toJson(type);
  return json.type === 'string' && !json.enum ? z.enum(field.values).optional() : type;
}

/**
 * Type and describe every field of a routed tool's public schema. Routing
 * fields get fixed descriptions; telemetry fields keep their own.
 */
export function refineSchemaFields(
  tool: RoutedPublicToolName,
  surface: Surface,
  schema: Record<string, z.ZodType>,
): Record<string, z.ZodType> {
  const fields = collectPublicFields(tool, surface);
  const overrides = FIELD_DESCRIPTIONS[tool] ?? {};
  const refined: Record<string, z.ZodType> = {};
  for (const [name, type] of Object.entries(schema)) {
    const routing = ROUTING_FIELD_DESCRIPTIONS[name];
    if (routing) {
      refined[name] = type.describe(routing);
      continue;
    }
    const field = fields.get(name);
    const text = overrides[name] ?? [...(field?.texts ?? [])].find(Boolean);
    const typed = refineType(type, field);
    refined[name] = text ? typed.describe(text) : typed;
  }
  return refined;
}

function requiredParams(action: ActionName): string[] {
  const shape = (getActionHandlers().get(action)?.inputSchema ?? {}) as Record<string, z.ZodType>;
  const required = Object.entries(shape)
    .filter(([, type]) => !type.safeParse(undefined).success)
    .map(([field]) => field);
  for (const field of ACTION_REQUIRED_PARAMS[action] ?? []) {
    if (!required.includes(field)) required.push(field);
  }
  return required;
}

/**
 * A routed tool's description: the intro, then one line per surface action
 * with its required parameters and whether it changes state, then the tool's
 * behavior notes.
 */
export function describeTool(tool: RoutedPublicToolName, surface: Surface, intro: string): string {
  const lines = getSurfaceActions(tool, surface).map((action) => {
    const entry = ACTION_CATALOG[action];
    const marker = entry.mutability === 'write' && !entry.nonDestructiveWrite ? ' [write]' : '';
    return `- ${action}(${requiredParams(action).join(', ')})${marker}: ${ACTION_SUMMARIES[action]}`;
  });
  const notes = TOOL_NOTES[tool];
  const note = surface === 'readOnly' ? notes?.readOnly ?? notes?.full : notes?.full;

  return [
    intro,
    'Actions, with required parameters in parentheses:',
    lines.join('\n'),
    note,
  ].filter(Boolean).join('\n\n');
}
