#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };
type StepExpectation = 'success' | 'error' | 'any';

type CaptureRule = {
  path?: string;
  regex?: string;
  source?: 'text' | 'json';
};

type BenchmarkStep = {
  name: string;
  label?: string;
  arguments?: JsonObject;
  expectation?: StepExpectation;
  expectError?: boolean;
  capture?: Record<string, CaptureRule>;
};

type BenchmarkScenario = {
  id: string;
  description?: string;
  requiredEnv?: string[];
  steps?: BenchmarkStep[];
  baseline?: BenchmarkStep[];
  candidate?: BenchmarkStep[];
};

type BenchmarkFile = {
  scenarios: BenchmarkScenario[];
};

type CliOptions = {
  baselineLabel: string;
  baselineCommand: string;
  baselineArgs: string[];
  baselineCwd?: string;
  candidateLabel: string;
  candidateCommand: string;
  candidateArgs: string[];
  candidateCwd?: string;
  casesPath?: string;
  outputPath?: string;
  listOnly: boolean;
  startupTimeoutMs: number;
  callTimeoutMs: number;
  passEnv: string[];
  restartPerScenario: boolean;
  isolateHome: boolean;
};

type ToolSummary = {
  name: string;
  descriptionChars: number;
  inputSchemaChars: number;
  paramDescriptionChars: number;
  topLevelPropertyCount: number;
  requiredFieldCount: number;
  actionEnumCount: number;
};

type SurfaceSummary = {
  toolCount: number;
  toolsListJsonChars: number;
  toolsListJsonBytes: number;
  toolsListEstimatedTokens: number;
  instructionsChars: number;
  instructionsEstimatedTokens: number;
  totalToolDescriptionChars: number;
  totalInputSchemaChars: number;
  totalParamDescriptionChars: number;
  toolsWithActionEnum: number;
  totalActionEnumValues: number;
  largestSchemas: Array<{ name: string; inputSchemaChars: number }>;
  tools: ToolSummary[];
};

type StepResult = {
  name: string;
  label?: string;
  expectation: StepExpectation;
  success: boolean;
  isError: boolean;
  latencyMs: number;
  responseJsonChars: number;
  responseJsonBytes: number;
  responseEstimatedTokens: number;
  responseTextChars: number;
  responseTextEstimatedTokens: number;
  responseTextPreview?: string;
  captured: Record<string, string>;
  error?: string;
};

type ScenarioResult = {
  id: string;
  description?: string;
  skipped?: boolean;
  skipReason?: string;
  steps: StepResult[];
  totalLatencyMs: number;
  totalResponseJsonChars: number;
  totalResponseTextChars: number;
  success: boolean;
};

type AggregateSummary = {
  scenarioCount: number;
  executedScenarioCount: number;
  skippedScenarioCount: number;
  successfulScenarioCount: number;
  failedScenarioCount: number;
  totalLatencyMs: number;
  medianScenarioLatencyMs: number;
  totalResponseJsonChars: number;
  totalResponseTextChars: number;
};

type TargetReport = {
  label: string;
  command: string;
  args: string[];
  cwd?: string;
  homeDir?: string;
  startupMs?: number;
  listToolsMs?: number;
  connectRssKb?: number;
  finalRssKb?: number;
  surface?: SurfaceSummary;
  scenarios: ScenarioResult[];
  aggregate?: AggregateSummary;
  stderrTail: string[];
  error?: string;
};

type BenchmarkReport = {
  generatedAt: string;
  packageRoot: string;
  options: Omit<CliOptions, 'passEnv'> & { passEnv: string[] };
  baseline: TargetReport;
  candidate: TargetReport;
  deltas?: {
    toolCount?: number;
    toolsListEstimatedTokens?: number;
    instructionsEstimatedTokens?: number;
    totalToolDescriptionChars?: number;
    totalParamDescriptionChars?: number;
    totalResponseTextChars?: number;
    medianScenarioLatencyMs?: number;
  };
};

type TargetConfig = {
  label: string;
  command: string;
  args: string[];
  cwd?: string;
};

type StartedSession = {
  client: Client;
  transport: StdioClientTransport;
  stderrLines: string[];
  homeDir?: string;
};

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_OUTPUT_DIR = resolve(PACKAGE_ROOT, 'benchmark-reports');
const DEFAULT_TELEMETRY_ARGS: JsonObject = {
  _feedback: 'Automated benchmark harness call.',
  _feedbackTool: 'none',
  _model: 'benchmark-harness',
};

const DEFAULT_SCENARIOS: BenchmarkScenario[] = [
  {
    id: 'get-started',
    description: 'Mapped old vs new onboarding/status call.',
    baseline: [{ name: 'getStarted', expectation: 'success' }],
    candidate: [{ name: 'heliusAccount', arguments: { action: 'getStarted' }, expectation: 'success' }],
  },
  {
    id: 'plan-info',
    description: 'Mapped old vs new plan-catalog call.',
    baseline: [{ name: 'getHeliusPlanInfo', arguments: { plan: 'all' }, expectation: 'any' }],
    candidate: [{ name: 'heliusAccount', arguments: { action: 'getHeliusPlanInfo', plan: 'all' }, expectation: 'any' }],
  },
  {
    id: 'rate-limit-info',
    description: 'Mapped old vs new rate-limit info call.',
    baseline: [{ name: 'getRateLimitInfo', expectation: 'any' }],
    candidate: [{ name: 'heliusKnowledge', arguments: { action: 'getRateLimitInfo' }, expectation: 'any' }],
  },
  {
    id: 'sol-balance',
    description: 'Mapped old vs new SOL-balance call if BENCHMARK_WALLET is set.',
    requiredEnv: ['BENCHMARK_WALLET'],
    baseline: [{ name: 'getBalance', arguments: { address: '${env:BENCHMARK_WALLET}' }, expectation: 'any' }],
    candidate: [{ name: 'heliusWallet', arguments: { action: 'getBalance', address: '${env:BENCHMARK_WALLET}' }, expectation: 'any' }],
  },
];

function printUsage(): void {
  console.log(`Usage: node dist/scripts/benchmark-mcp.js [options]

Benchmarks two MCP server targets:
- baseline defaults to: npx -y helius-mcp@latest
- candidate defaults to: node dist/index.js (cwd = helius-mcp package root)

Options:
  --cases <path>                 JSON file with scenarios to execute
  --output <path>                Write full JSON report to this path
  --list-only                    Only collect tools/list and instruction metrics
  --startup-timeout-ms <ms>      Request timeout for initialization and tools/list (default: 60000)
  --call-timeout-ms <ms>         Request timeout for tool calls (default: 60000)
  --pass-env <NAME>              Pass env var through to both server targets (repeatable)
  --restart-per-scenario         Restart the MCP server for every scenario
  --isolate-home                 Run each target in an isolated temp HOME directory
  --no-isolate-home              Disable isolated HOME directories

  --baseline-label <label>
  --baseline-command <command>
  --baseline-args-json <json-array>
  --baseline-cwd <path>

  --candidate-label <label>
  --candidate-command <command>
  --candidate-args-json <json-array>
  --candidate-cwd <path>

Examples:
  pnpm benchmark:mcp
  node dist/scripts/benchmark-mcp.js --list-only
  node dist/scripts/benchmark-mcp.js --cases benchmarks/router-ab.example.json
  node dist/scripts/benchmark-mcp.js --restart-per-scenario --isolate-home
`);
}

function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = {
    baselineLabel: 'baseline-npm',
    baselineCommand: 'npx',
    baselineArgs: ['-y', 'helius-mcp@latest'],
    baselineCwd: undefined,
    candidateLabel: 'candidate-local',
    candidateCommand: 'node',
    candidateArgs: ['dist/index.js'],
    candidateCwd: PACKAGE_ROOT,
    casesPath: undefined,
    outputPath: undefined,
    listOnly: false,
    startupTimeoutMs: 60_000,
    callTimeoutMs: 60_000,
    passEnv: ['HELIUS_API_KEY'],
    restartPerScenario: false,
    isolateHome: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    const nextValue = (): string => {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case '--cases':
        options.casesPath = resolve(process.cwd(), nextValue());
        break;
      case '--output':
        options.outputPath = resolve(process.cwd(), nextValue());
        break;
      case '--list-only':
        options.listOnly = true;
        break;
      case '--startup-timeout-ms':
        options.startupTimeoutMs = Number.parseInt(nextValue(), 10);
        break;
      case '--call-timeout-ms':
        options.callTimeoutMs = Number.parseInt(nextValue(), 10);
        break;
      case '--pass-env':
        options.passEnv.push(nextValue());
        break;
      case '--restart-per-scenario':
        options.restartPerScenario = true;
        break;
      case '--isolate-home':
        options.isolateHome = true;
        break;
      case '--no-isolate-home':
        options.isolateHome = false;
        break;
      case '--baseline-label':
        options.baselineLabel = nextValue();
        break;
      case '--baseline-command':
        options.baselineCommand = nextValue();
        break;
      case '--baseline-args-json':
        options.baselineArgs = parseStringArray(nextValue(), '--baseline-args-json');
        break;
      case '--baseline-cwd':
        options.baselineCwd = resolve(process.cwd(), nextValue());
        break;
      case '--candidate-label':
        options.candidateLabel = nextValue();
        break;
      case '--candidate-command':
        options.candidateCommand = nextValue();
        break;
      case '--candidate-args-json':
        options.candidateArgs = parseStringArray(nextValue(), '--candidate-args-json');
        break;
      case '--candidate-cwd':
        options.candidateCwd = resolve(process.cwd(), nextValue());
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.passEnv = Array.from(new Set(options.passEnv.filter(Boolean)));
  return options;
}

function parseStringArray(raw: string, optionName: string): string[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
    throw new Error(`${optionName} must be a JSON string array`);
  }
  return parsed;
}

async function loadScenarios(casesPath?: string): Promise<BenchmarkScenario[]> {
  if (!casesPath) {
    return DEFAULT_SCENARIOS;
  }

  const raw = await readFile(casesPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;

  if (Array.isArray(parsed)) {
    return parsed as BenchmarkScenario[];
  }

  if (isRecord(parsed) && Array.isArray(parsed.scenarios)) {
    return (parsed as BenchmarkFile).scenarios;
  }

  throw new Error(`Case file must be an array of scenarios or an object with a "scenarios" array: ${casesPath}`);
}

function pickEnv(names: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return env;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function safeJsonStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, currentValue) => {
      if (typeof currentValue === 'bigint') {
        return currentValue.toString();
      }
      return currentValue;
    },
    2,
  );
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRssKb(pid: number | null): number | undefined {
  if (!pid) {
    return undefined;
  }

  try {
    const output = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim();
    const rssKb = Number.parseInt(output, 10);
    return Number.isFinite(rssKb) ? rssKb : undefined;
  } catch {
    return undefined;
  }
}

function getTransportPid(transport: StdioClientTransport): number | null {
  const typedPid = transport.pid;
  if (typeof typedPid === 'number') {
    return typedPid;
  }

  const internalPid = (transport as unknown as { _process?: { pid?: number } })._process?.pid;
  return typeof internalPid === 'number' ? internalPid : null;
}

function collectDescriptionChars(value: unknown): number {
  let total = 0;
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }
      return;
    }

    if (!isRecord(current)) {
      return;
    }

    if (typeof current.description === 'string') {
      total += current.description.length;
    }

    for (const item of Object.values(current)) {
      visit(item);
    }
  };

  visit(value);
  return total;
}

function extractTextContent(result: unknown): string {
  if (!isRecord(result)) {
    return '';
  }

  const parts: string[] = [];
  const content = result.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (isRecord(item) && typeof item.text === 'string') {
        parts.push(item.text);
      }
    }
  }

  if (parts.length === 0 && result.structuredContent !== undefined) {
    parts.push(safeJsonStringify(result.structuredContent));
  }

  return parts.join('\n\n').trim();
}

function getByPath(value: unknown, path: string | undefined): unknown {
  if (!path) {
    return value;
  }

  const parts = path.split('.');
  let current: unknown = value;

  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (!isRecord(current)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

function applyCaptureRules(result: unknown, capture?: Record<string, CaptureRule>): Record<string, string> {
  if (!capture) {
    return {};
  }

  const captured: Record<string, string> = {};

  for (const [name, rule] of Object.entries(capture)) {
    const sourceValue =
      rule.source === 'text'
        ? extractTextContent(result)
        : rule.source === 'json'
          ? safeJsonStringify(result)
          : getByPath(result, rule.path);

    const baseValue =
      typeof sourceValue === 'string'
        ? sourceValue
        : sourceValue === undefined
          ? ''
          : safeJsonStringify(sourceValue);

    if (rule.regex) {
      const match = new RegExp(rule.regex).exec(baseValue);
      if (!match || !match[1]) {
        throw new Error(`Capture "${name}" did not match regex ${rule.regex}`);
      }
      captured[name] = match[1];
      continue;
    }

    if (baseValue === '') {
      throw new Error(`Capture "${name}" did not resolve to a value`);
    }

    captured[name] = baseValue;
  }

  return captured;
}

function resolveTemplates(value: JsonValue | undefined, captures: Record<string, string>): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    const fullMatch = value.match(/^\$\{(env|capture):([^}]+)\}$/);
    if (fullMatch) {
      const resolved = resolveTemplateToken(fullMatch[1], fullMatch[2], captures);
      return resolved ?? value;
    }

    return value.replace(/\$\{(env|capture):([^}]+)\}/g, (_match, kind, key) => {
      const resolved = resolveTemplateToken(kind, key, captures);
      return resolved ?? '';
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplates(item, captures) as JsonValue);
  }

  if (isRecord(value)) {
    const next: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      next[key] = resolveTemplates(item as JsonValue, captures) as JsonValue;
    }
    return next;
  }

  return value;
}

function resolveTemplateToken(kind: string, key: string, captures: Record<string, string>): string | undefined {
  if (kind === 'env') {
    return process.env[key];
  }

  if (kind === 'capture') {
    return captures[key];
  }

  return undefined;
}

function buildSurfaceSummary(listToolsResult: { tools: Array<Record<string, unknown>> }, instructions: string | undefined): SurfaceSummary {
  const serializedList = safeJsonStringify(listToolsResult);
  const tools: ToolSummary[] = listToolsResult.tools.map((tool) => {
    const inputSchema = isRecord(tool.inputSchema) ? tool.inputSchema : {};
    const inputSchemaSerialized = safeJsonStringify(inputSchema);
    const properties = isRecord(inputSchema.properties) ? inputSchema.properties : {};
    const actionProperty = isRecord(properties.action) ? properties.action : undefined;
    const actionEnumCount = Array.isArray(actionProperty?.enum) ? actionProperty.enum.length : 0;
    const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];

    return {
      name: String(tool.name),
      descriptionChars: typeof tool.description === 'string' ? tool.description.length : 0,
      inputSchemaChars: inputSchemaSerialized.length,
      paramDescriptionChars: collectDescriptionChars(inputSchema),
      topLevelPropertyCount: Object.keys(properties).length,
      requiredFieldCount: required.length,
      actionEnumCount,
    };
  });

  const largestSchemas = [...tools]
    .sort((left, right) => right.inputSchemaChars - left.inputSchemaChars)
    .slice(0, 10)
    .map((tool) => ({
      name: tool.name,
      inputSchemaChars: tool.inputSchemaChars,
    }));

  return {
    toolCount: tools.length,
    toolsListJsonChars: serializedList.length,
    toolsListJsonBytes: byteLength(serializedList),
    toolsListEstimatedTokens: estimateTokens(serializedList),
    instructionsChars: instructions?.length ?? 0,
    instructionsEstimatedTokens: estimateTokens(instructions ?? ''),
    totalToolDescriptionChars: tools.reduce((total, tool) => total + tool.descriptionChars, 0),
    totalInputSchemaChars: tools.reduce((total, tool) => total + tool.inputSchemaChars, 0),
    totalParamDescriptionChars: tools.reduce((total, tool) => total + tool.paramDescriptionChars, 0),
    toolsWithActionEnum: tools.filter((tool) => tool.actionEnumCount > 0).length,
    totalActionEnumValues: tools.reduce((total, tool) => total + tool.actionEnumCount, 0),
    largestSchemas,
    tools,
  };
}

function getScenarioSteps(scenario: BenchmarkScenario, kind: 'baseline' | 'candidate'): BenchmarkStep[] {
  if (kind === 'baseline' && scenario.baseline) {
    return scenario.baseline;
  }
  if (kind === 'candidate' && scenario.candidate) {
    return scenario.candidate;
  }
  return scenario.steps ?? [];
}

function withDefaultTelemetry(argumentsObject: JsonObject | undefined): JsonObject {
  return {
    ...DEFAULT_TELEMETRY_ARGS,
    ...(argumentsObject ?? {}),
  };
}

function normalizeExpectation(step: BenchmarkStep): StepExpectation {
  if (step.expectation) {
    return step.expectation;
  }
  return step.expectError ? 'error' : 'success';
}

function isExpectedStepOutcome(expectation: StepExpectation, isError: boolean, thrownError?: string): boolean {
  if (thrownError && thrownError.toLowerCase().includes('timed out')) {
    return false;
  }

  switch (expectation) {
    case 'success':
      return !isError && !thrownError;
    case 'error':
      return isError || Boolean(thrownError);
    case 'any':
      return true;
    default:
      return false;
  }
}

function previewText(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, 160);
}

function formatDurationMs(value: number): string {
  if (value < 1000) {
    return `${value.toFixed(0)}ms`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

function formatEtaMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0s';
  }
  if (value < 60_000) {
    return `${Math.ceil(value / 1000)}s`;
  }
  return `${(value / 60_000).toFixed(1)}m`;
}

function summarizeScenarioResults(scenarios: ScenarioResult[]): AggregateSummary {
  const executed = scenarios.filter((scenario) => !scenario.skipped);
  const latencies = executed.map((scenario) => scenario.totalLatencyMs).sort((left, right) => left - right);
  const medianIndex = latencies.length === 0 ? -1 : Math.floor(latencies.length / 2);

  return {
    scenarioCount: scenarios.length,
    executedScenarioCount: executed.length,
    skippedScenarioCount: scenarios.filter((scenario) => scenario.skipped).length,
    successfulScenarioCount: executed.filter((scenario) => scenario.success).length,
    failedScenarioCount: executed.filter((scenario) => !scenario.success).length,
    totalLatencyMs: executed.reduce((total, scenario) => total + scenario.totalLatencyMs, 0),
    medianScenarioLatencyMs: medianIndex >= 0 ? latencies[medianIndex] : 0,
    totalResponseJsonChars: executed.reduce((total, scenario) => total + scenario.totalResponseJsonChars, 0),
    totalResponseTextChars: executed.reduce((total, scenario) => total + scenario.totalResponseTextChars, 0),
  };
}

async function createHomeDir(label: string): Promise<string> {
  const slug = label.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  return await mkdtemp(resolve(os.tmpdir(), `helius-mcp-benchmark-${slug}-`));
}

function buildSessionEnv(options: CliOptions, homeDir?: string): Record<string, string> {
  const env = pickEnv(options.passEnv);
  if (homeDir) {
    env.HOME = homeDir;
    env.USERPROFILE = homeDir;
    env.XDG_CONFIG_HOME = resolve(homeDir, '.config');
  }
  return env;
}

async function startSession(target: TargetConfig, options: CliOptions, homeDir?: string): Promise<StartedSession> {
  const transport = new StdioClientTransport({
    command: target.command,
    args: target.args,
    cwd: target.cwd,
    env: buildSessionEnv(options, homeDir),
    stderr: 'pipe',
  });

  const stderrLines: string[] = [];
  transport.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    stderrLines.push(...text.split(/\r?\n/).filter(Boolean));
    if (stderrLines.length > 50) {
      stderrLines.splice(0, stderrLines.length - 50);
    }
  });

  const client = new Client(
    {
      name: 'helius-mcp-benchmark',
      version: '0.1.0',
    },
    {
      capabilities: {},
    },
  );

  await client.connect(transport, { timeout: options.startupTimeoutMs });
  return { client, transport, stderrLines, homeDir };
}

async function closeSession(session: StartedSession): Promise<void> {
  await session.transport.close();
}

async function runTarget(target: TargetConfig, scenarios: BenchmarkScenario[], options: CliOptions): Promise<TargetReport> {
  const report: TargetReport = {
    label: target.label,
    command: target.command,
    args: target.args,
    cwd: target.cwd,
    scenarios: [],
    stderrTail: [],
  };

  let surfaceSession: StartedSession | null = null;

  try {
    const surfaceHomeDir = options.isolateHome ? await createHomeDir(`${target.label}-surface`) : undefined;
    console.log(`[${target.label}] starting server${surfaceHomeDir ? ` with isolated HOME at ${surfaceHomeDir}` : ''}`);
    const connectStart = performance.now();
    surfaceSession = await startSession(target, options, surfaceHomeDir);
    report.homeDir = surfaceHomeDir;
    report.startupMs = Number((performance.now() - connectStart).toFixed(2));
    report.connectRssKb = getRssKb(getTransportPid(surfaceSession.transport));

    const listStart = performance.now();
    const listToolsResult = await surfaceSession.client.listTools(undefined, { timeout: options.startupTimeoutMs });
    report.listToolsMs = Number((performance.now() - listStart).toFixed(2));
    report.surface = buildSurfaceSummary(listToolsResult as { tools: Array<Record<string, unknown>> }, surfaceSession.client.getInstructions());
    console.log(
      `[${target.label}] surface loaded: ${report.surface.toolCount} tools, ` +
        `${report.surface.toolsListEstimatedTokens} tools/list est tokens, ` +
        `startup ${formatDurationMs(report.startupMs)}`,
    );

    if (!options.listOnly) {
      if (options.restartPerScenario) {
        await closeSession(surfaceSession);
        report.stderrTail.push(...surfaceSession.stderrLines.slice(-20));
        surfaceSession = null;

        const runStart = performance.now();
        for (const [index, scenario] of scenarios.entries()) {
          console.log(`[${target.label}] (${index + 1}/${scenarios.length}) starting ${scenario.id}`);
          const scenarioHomeDir = options.isolateHome ? await createHomeDir(`${target.label}-${scenario.id}`) : undefined;
          const scenarioSession = await startSession(target, options, scenarioHomeDir);
          try {
            const scenarioResult = await runScenario(
              scenarioSession.client,
              scenario,
              target.label === options.baselineLabel ? 'baseline' : 'candidate',
              options,
            );
            report.scenarios.push(scenarioResult);

            const completed = index + 1;
            const elapsedMs = performance.now() - runStart;
            const averageMs = elapsedMs / completed;
            const remainingMs = averageMs * (scenarios.length - completed);
            const status = scenarioResult.skipped ? 'skipped' : scenarioResult.success ? 'ok' : 'fail';
            console.log(
              `[${target.label}] (${completed}/${scenarios.length}) ${scenario.id}: ${status} ` +
                `in ${formatDurationMs(scenarioResult.totalLatencyMs)} | ETA ${formatEtaMs(remainingMs)}`,
            );
          } finally {
            report.stderrTail.push(...scenarioSession.stderrLines.slice(-5));
            await closeSession(scenarioSession);
          }
        }
      } else if (surfaceSession) {
        const runStart = performance.now();
        for (const [index, scenario] of scenarios.entries()) {
          console.log(`[${target.label}] (${index + 1}/${scenarios.length}) starting ${scenario.id}`);
          const scenarioResult = await runScenario(
            surfaceSession.client,
            scenario,
            target.label === options.baselineLabel ? 'baseline' : 'candidate',
            options,
          );
          report.scenarios.push(scenarioResult);

          const completed = index + 1;
          const elapsedMs = performance.now() - runStart;
          const averageMs = elapsedMs / completed;
          const remainingMs = averageMs * (scenarios.length - completed);
          const status = scenarioResult.skipped ? 'skipped' : scenarioResult.success ? 'ok' : 'fail';
          console.log(
            `[${target.label}] (${completed}/${scenarios.length}) ${scenario.id}: ${status} ` +
              `in ${formatDurationMs(scenarioResult.totalLatencyMs)} | ETA ${formatEtaMs(remainingMs)}`,
          );
        }
        report.finalRssKb = getRssKb(getTransportPid(surfaceSession.transport));
      }
    } else if (surfaceSession) {
      report.finalRssKb = getRssKb(getTransportPid(surfaceSession.transport));
    }

    report.aggregate = summarizeScenarioResults(report.scenarios);
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (surfaceSession) {
      report.stderrTail.push(...surfaceSession.stderrLines.slice(-20));
      await closeSession(surfaceSession);
    }
    if (report.stderrTail.length > 20) {
      report.stderrTail = report.stderrTail.slice(-20);
    }
  }

  return report;
}

async function runScenario(
  client: Client,
  scenario: BenchmarkScenario,
  kind: 'baseline' | 'candidate',
  options: CliOptions,
): Promise<ScenarioResult> {
  const missingEnv = (scenario.requiredEnv ?? []).filter((name) => !process.env[name]);
  if (missingEnv.length > 0) {
    return {
      id: scenario.id,
      description: scenario.description,
      skipped: true,
      skipReason: `Missing env: ${missingEnv.join(', ')}`,
      steps: [],
      totalLatencyMs: 0,
      totalResponseJsonChars: 0,
      totalResponseTextChars: 0,
      success: true,
    };
  }

  const steps = getScenarioSteps(scenario, kind);
  const captures: Record<string, string> = {};
  const results: StepResult[] = [];

  for (const step of steps) {
    const expectation = normalizeExpectation(step);
    const resolvedArguments = withDefaultTelemetry(resolveTemplates(step.arguments, captures) as JsonObject | undefined);
    const stepStart = performance.now();

    try {
      const result = await client.callTool(
        {
          name: step.name,
          arguments: resolvedArguments,
        },
        undefined,
        { timeout: options.callTimeoutMs },
      );
      const latencyMs = Number((performance.now() - stepStart).toFixed(2));
      const responseJson = safeJsonStringify(result);
      const responseText = extractTextContent(result);
      const captured = applyCaptureRules(result, step.capture);
      Object.assign(captures, captured);

      results.push({
        name: step.name,
        label: step.label,
        expectation,
        success: isExpectedStepOutcome(expectation, Boolean(result.isError)),
        isError: Boolean(result.isError),
        latencyMs,
        responseJsonChars: responseJson.length,
        responseJsonBytes: byteLength(responseJson),
        responseEstimatedTokens: estimateTokens(responseJson),
        responseTextChars: responseText.length,
        responseTextEstimatedTokens: estimateTokens(responseText),
        responseTextPreview: previewText(responseText),
        captured,
      });
    } catch (error) {
      const latencyMs = Number((performance.now() - stepStart).toFixed(2));
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        name: step.name,
        label: step.label,
        expectation,
        success: isExpectedStepOutcome(expectation, true, message),
        isError: true,
        latencyMs,
        responseJsonChars: 0,
        responseJsonBytes: 0,
        responseEstimatedTokens: 0,
        responseTextChars: 0,
        responseTextEstimatedTokens: 0,
        captured: {},
        error: message,
      });
    }
  }

  return {
    id: scenario.id,
    description: scenario.description,
    steps: results,
    totalLatencyMs: Number(results.reduce((total, result) => total + result.latencyMs, 0).toFixed(2)),
    totalResponseJsonChars: results.reduce((total, result) => total + result.responseJsonChars, 0),
    totalResponseTextChars: results.reduce((total, result) => total + result.responseTextChars, 0),
    success: results.every((result) => result.success),
  };
}

function buildDeltas(baseline: TargetReport, candidate: TargetReport): BenchmarkReport['deltas'] | undefined {
  if (!baseline.surface || !candidate.surface || !baseline.aggregate || !candidate.aggregate) {
    return undefined;
  }

  return {
    toolCount: candidate.surface.toolCount - baseline.surface.toolCount,
    toolsListEstimatedTokens: candidate.surface.toolsListEstimatedTokens - baseline.surface.toolsListEstimatedTokens,
    instructionsEstimatedTokens: candidate.surface.instructionsEstimatedTokens - baseline.surface.instructionsEstimatedTokens,
    totalToolDescriptionChars: candidate.surface.totalToolDescriptionChars - baseline.surface.totalToolDescriptionChars,
    totalParamDescriptionChars: candidate.surface.totalParamDescriptionChars - baseline.surface.totalParamDescriptionChars,
    totalResponseTextChars: candidate.aggregate.totalResponseTextChars - baseline.aggregate.totalResponseTextChars,
    medianScenarioLatencyMs: Number(
      (candidate.aggregate.medianScenarioLatencyMs - baseline.aggregate.medianScenarioLatencyMs).toFixed(2),
    ),
  };
}

function formatDelta(value: number | undefined): string {
  if (value === undefined) {
    return 'n/a';
  }
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value}`;
}

function formatPercent(before: number | undefined, after: number | undefined): string {
  if (before === undefined || after === undefined || before === 0) {
    return 'n/a';
  }
  const percent = ((after - before) / before) * 100;
  const prefix = percent > 0 ? '+' : '';
  return `${prefix}${percent.toFixed(1)}%`;
}

function printSummary(report: BenchmarkReport): void {
  const { baseline, candidate } = report;
  const baselineSurface = baseline.surface;
  const candidateSurface = candidate.surface;
  const baselineAggregate = baseline.aggregate;
  const candidateAggregate = candidate.aggregate;

  console.log(`\nBenchmark report generated at ${report.generatedAt}`);
  console.log(`Package root: ${report.packageRoot}`);
  console.log(`Baseline: ${baseline.command} ${baseline.args.join(' ')}`);
  console.log(`Candidate: ${candidate.command} ${candidate.args.join(' ')}`);

  if (baseline.error || candidate.error) {
    console.log('');
    if (baseline.error) {
      console.log(`Baseline error: ${baseline.error}`);
    }
    if (candidate.error) {
      console.log(`Candidate error: ${candidate.error}`);
    }
    return;
  }

  console.log('\nSurface');
  console.log(
    `- Tool count: ${baselineSurface?.toolCount ?? 'n/a'} -> ${candidateSurface?.toolCount ?? 'n/a'} (${formatDelta(
      report.deltas?.toolCount,
    )}, ${formatPercent(baselineSurface?.toolCount, candidateSurface?.toolCount)})`,
  );
  console.log(
    `- tools/list estimated tokens: ${baselineSurface?.toolsListEstimatedTokens ?? 'n/a'} -> ${candidateSurface?.toolsListEstimatedTokens ?? 'n/a'} (${formatDelta(
      report.deltas?.toolsListEstimatedTokens,
    )}, ${formatPercent(
      baselineSurface?.toolsListEstimatedTokens,
      candidateSurface?.toolsListEstimatedTokens,
    )})`,
  );
  console.log(
    `- Instruction estimated tokens: ${baselineSurface?.instructionsEstimatedTokens ?? 'n/a'} -> ${candidateSurface?.instructionsEstimatedTokens ?? 'n/a'} (${formatDelta(
      report.deltas?.instructionsEstimatedTokens,
    )}, ${formatPercent(
      baselineSurface?.instructionsEstimatedTokens,
      candidateSurface?.instructionsEstimatedTokens,
    )})`,
  );
  console.log(
    `- Tool description chars: ${baselineSurface?.totalToolDescriptionChars ?? 'n/a'} -> ${candidateSurface?.totalToolDescriptionChars ?? 'n/a'} (${formatDelta(
      report.deltas?.totalToolDescriptionChars,
    )}, ${formatPercent(
      baselineSurface?.totalToolDescriptionChars,
      candidateSurface?.totalToolDescriptionChars,
    )})`,
  );
  console.log(
    `- Param description chars: ${baselineSurface?.totalParamDescriptionChars ?? 'n/a'} -> ${candidateSurface?.totalParamDescriptionChars ?? 'n/a'} (${formatDelta(
      report.deltas?.totalParamDescriptionChars,
    )}, ${formatPercent(
      baselineSurface?.totalParamDescriptionChars,
      candidateSurface?.totalParamDescriptionChars,
    )})`,
  );
  console.log(
    `- Tools with action enum: ${baselineSurface?.toolsWithActionEnum ?? 'n/a'} -> ${candidateSurface?.toolsWithActionEnum ?? 'n/a'}`,
  );

  console.log('\nRuntime');
  console.log(`- Startup ms: ${baseline.startupMs ?? 'n/a'} -> ${candidate.startupMs ?? 'n/a'}`);
  console.log(`- tools/list ms: ${baseline.listToolsMs ?? 'n/a'} -> ${candidate.listToolsMs ?? 'n/a'}`);
  console.log(
    `- Median scenario latency ms: ${baselineAggregate?.medianScenarioLatencyMs ?? 'n/a'} -> ${candidateAggregate?.medianScenarioLatencyMs ?? 'n/a'} (${formatDelta(
      report.deltas?.medianScenarioLatencyMs,
    )})`,
  );
  console.log(
    `- Total response text chars: ${baselineAggregate?.totalResponseTextChars ?? 'n/a'} -> ${candidateAggregate?.totalResponseTextChars ?? 'n/a'} (${formatDelta(
      report.deltas?.totalResponseTextChars,
    )}, ${formatPercent(
      baselineAggregate?.totalResponseTextChars,
      candidateAggregate?.totalResponseTextChars,
    )})`,
  );
  console.log(`- RSS KB after connect: ${baseline.connectRssKb ?? 'n/a'} -> ${candidate.connectRssKb ?? 'n/a'}`);
  console.log(`- RSS KB after run: ${baseline.finalRssKb ?? 'n/a'} -> ${candidate.finalRssKb ?? 'n/a'}`);

  if (baseline.scenarios.length > 0 || candidate.scenarios.length > 0) {
    console.log('\nScenario outcomes');
    const scenarioIds = Array.from(new Set([...baseline.scenarios, ...candidate.scenarios].map((scenario) => scenario.id)));
    for (const scenarioId of scenarioIds) {
      const left = baseline.scenarios.find((scenario) => scenario.id === scenarioId);
      const right = candidate.scenarios.find((scenario) => scenario.id === scenarioId);
      const leftStatus = left?.skipped ? `skipped (${left.skipReason})` : left?.success ? 'ok' : 'fail';
      const rightStatus = right?.skipped ? `skipped (${right.skipReason})` : right?.success ? 'ok' : 'fail';
      console.log(`- ${scenarioId}: ${baseline.label}=${leftStatus ?? 'n/a'}, ${candidate.label}=${rightStatus ?? 'n/a'}`);
    }
  }
}

async function writeReport(report: BenchmarkReport, outputPath?: string): Promise<string> {
  const finalPath =
    outputPath ??
    resolve(DEFAULT_OUTPUT_DIR, `benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

  await mkdir(dirname(finalPath), { recursive: true });
  await writeFile(finalPath, `${safeJsonStringify(report)}\n`, 'utf8');
  return finalPath;
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const scenarios = await loadScenarios(options.casesPath);

  if (options.candidateCommand === 'node' && options.candidateArgs[0] === 'dist/index.js') {
    const candidateEntrypoint = resolve(options.candidateCwd ?? PACKAGE_ROOT, 'dist/index.js');
    if (!existsSync(candidateEntrypoint)) {
      throw new Error(
        `Local candidate build not found at ${candidateEntrypoint}. Run "pnpm build" in helius-mcp or use "pnpm benchmark:mcp", which builds first.`,
      );
    }
  }

  if (options.baselineCommand === 'node' && options.baselineArgs[0] === 'dist/index.js') {
    const baselineEntrypoint = resolve(options.baselineCwd ?? PACKAGE_ROOT, 'dist/index.js');
    if (!existsSync(baselineEntrypoint)) {
      throw new Error(`Local baseline build not found at ${baselineEntrypoint}. Build the baseline target before benchmarking.`);
    }
  }

  const baseline = await runTarget(
    {
      label: options.baselineLabel,
      command: options.baselineCommand,
      args: options.baselineArgs,
      cwd: options.baselineCwd,
    },
    scenarios,
    options,
  );

  const candidate = await runTarget(
    {
      label: options.candidateLabel,
      command: options.candidateCommand,
      args: options.candidateArgs,
      cwd: options.candidateCwd,
    },
    scenarios,
    options,
  );

  const report: BenchmarkReport = {
    generatedAt: new Date().toISOString(),
    packageRoot: PACKAGE_ROOT,
    options,
    baseline,
    candidate,
    deltas: buildDeltas(baseline, candidate),
  };

  printSummary(report);
  const reportPath = await writeReport(report, options.outputPath);
  console.log(`\nReport written to ${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
