import chalk from "chalk";
import { resolveApiKey, resolveNetwork, getClient, type ResolveOptions } from "../lib/helius.js";
import { jsonReplacer, classifyError, type OutputOptions } from "../lib/output.js";

interface WsOptions extends OutputOptions, ResolveOptions {}

/** Emit a JSON envelope: { event, timestamp, data } */
function emitEvent(event: string, data: unknown): void {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), data }, jsonReplacer));
}

function printNotification(notification: unknown, options: WsOptions, event: string): void {
  if (options.json) {
    emitEvent(event, notification);
  } else {
    console.log(chalk.gray(new Date().toISOString()), JSON.stringify(notification, jsonReplacer, 2));
  }
}

async function streamSubscription(
  channel: { subscribe(opts: { abortSignal: AbortSignal }): Promise<AsyncIterable<unknown>> },
  abortController: AbortController,
  options: WsOptions,
  event: string,
): Promise<void> {
  const subscription = await channel.subscribe({ abortSignal: abortController.signal });
  for await (const notification of subscription) {
    printNotification(notification, options, event);
  }
}

function handleWsError(error: unknown, options: WsOptions): void {
  if ((error as any)?.name === "AbortError") return;
  const { exitCode, errorCode, retryable } = classifyError(error);
  const message = error instanceof Error ? error.message : String(error);
  if (options.json) {
    emitEvent("error", { error: errorCode, message, retryable });
  } else {
    const hint = retryable ? chalk.gray(" (transient — safe to retry)") : "";
    console.error(chalk.red(`Error: ${message}${hint}`));
  }
  process.exit(exitCode);
}

function setupShutdown(helius: any, abortController: AbortController, label: string, options: WsOptions): void {
  if (options.json) {
    emitEvent("connected", { subscription: label });
  } else {
    console.log(chalk.gray(`\nStreaming ${label}... (Ctrl+C to stop)\n`));
  }
  const cleanup = () => {
    if (options.json) {
      emitEvent("disconnected", { reason: "user_interrupt" });
    } else {
      console.log(chalk.gray("\nClosing WebSocket..."));
    }
    abortController.abort();
    try { helius.ws.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

export async function wsAccountCommand(address: string, options: WsOptions = {}): Promise<void> {
  try {
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);
    const ac = new AbortController();

    setupShutdown(helius, ac, "account notifications", options);
    const channel = await helius.ws.accountNotifications(address as any, { encoding: "jsonParsed" });
    await streamSubscription(channel as any, ac, options, "accountNotification");
  } catch (error) {
    handleWsError(error, options);
  }
}

export async function wsLogsCommand(options: WsOptions & { mentions?: string } = {}): Promise<void> {
  try {
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);
    const ac = new AbortController();

    setupShutdown(helius, ac, "log notifications", options);
    const filter = options.mentions ? { mentions: [options.mentions] as any } : "all" as const;
    const channel = await helius.ws.logsNotifications(filter);
    await streamSubscription(channel as any, ac, options, "logsNotification");
  } catch (error) {
    handleWsError(error, options);
  }
}

export async function wsSlotCommand(options: WsOptions = {}): Promise<void> {
  try {
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);
    const ac = new AbortController();

    setupShutdown(helius, ac, "slot notifications", options);

    // Use @solana/kit directly — the SDK wrapper has a bug where it passes
    // `undefined` as a config param to slotNotifications, which the RPC rejects.
    const { createSolanaRpcSubscriptions } = await import("@solana/kit");
    const wsUrl = network === "devnet"
      ? `wss://devnet.helius-rpc.com/?api-key=${apiKey}`
      : `wss://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    const rpc = createSolanaRpcSubscriptions(wsUrl);
    const channel = rpc.slotNotifications();
    const subscription = await channel.subscribe({ abortSignal: ac.signal });
    for await (const notification of subscription) {
      printNotification(notification, options, "slotNotification");
    }
  } catch (error) {
    handleWsError(error, options);
  }
}

export async function wsSignatureCommand(signature: string, options: WsOptions = {}): Promise<void> {
  try {
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);
    const ac = new AbortController();

    setupShutdown(helius, ac, "signature notifications", options);
    const channel = await helius.ws.signatureNotifications(signature);
    await streamSubscription(channel as any, ac, options, "signatureNotification");
  } catch (error) {
    handleWsError(error, options);
  }
}

export async function wsProgramCommand(programId: string, options: WsOptions = {}): Promise<void> {
  try {
    const apiKey = await resolveApiKey(options);
    const network = resolveNetwork(options);
    const helius = getClient(apiKey, network);
    const ac = new AbortController();

    setupShutdown(helius, ac, "program notifications", options);
    const channel = await helius.ws.programNotifications(programId as any, { encoding: "jsonParsed" });
    await streamSubscription(channel as any, ac, options, "programNotification");
  } catch (error) {
    handleWsError(error, options);
  }
}
