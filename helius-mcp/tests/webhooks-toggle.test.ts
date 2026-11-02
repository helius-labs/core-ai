import { beforeEach, describe, expect, it, vi } from 'vitest';

const webhooks = vi.hoisted(() => ({
  getAll: vi.fn(),
  get: vi.fn(),
  toggle: vi.fn(),
}));

vi.mock('../src/utils/helius.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/utils/helius.js')>();
  return {
    ...original,
    hasApiKey: vi.fn(() => true),
    getHeliusClient: vi.fn(() => ({ webhooks })),
  };
});

import { dispatchRoutedTool } from '../src/router/dispatch.js';
import { ACTION_CATALOG } from '../src/router/catalog.js';
import { getSurfaceActions } from '../src/router/surface.js';
import type { Surface } from '../src/router/surface.js';

const ID = '0e8250a1-ceec-4757-ad69-cc6473085bfa';
const hook = (active?: boolean) => ({
  webhookID: ID, webhookURL: 'https://example.com/hook', webhookType: 'enhanced',
  accountAddresses: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'],
  ...(active === undefined ? {} : { active }),
});

async function call(action: string, params: Record<string, unknown> = {}, surface: Surface = 'full') {
  const result = await dispatchRoutedTool('heliusStreaming', { action, detail: 'full', ...params }, {}, surface);
  return { text: result.content.map((c) => c.text).join('\n'), isError: result.isError };
}

beforeEach(() => {
  webhooks.getAll.mockReset();
  webhooks.get.mockReset();
  webhooks.toggle.mockReset();
});

describe('toggleWebhook', () => {
  it('disables a webhook and says deliveries are paused', async () => {
    webhooks.toggle.mockResolvedValueOnce(hook(false));
    const { text } = await call('toggleWebhook', { webhookID: ID, active: false });
    expect(webhooks.toggle).toHaveBeenCalledWith(ID, false);
    expect(text).toContain('Webhook Disabled');
    expect(text).toContain('Deliveries are paused');
  });

  it('enables a webhook and mentions the 24-hour grace period', async () => {
    webhooks.toggle.mockResolvedValueOnce(hook(true));
    const { text } = await call('toggleWebhook', { webhookID: ID, active: true });
    expect(webhooks.toggle).toHaveBeenCalledWith(ID, true);
    expect(text).toContain('Webhook Enabled');
    expect(text).toContain('24 hours');
  });

  it('requires active, so a missing flag never toggles anything', async () => {
    const { text, isError } = await call('toggleWebhook', { webhookID: ID });
    expect(isError).toBe(true);
    expect(text).toContain('active');
    expect(webhooks.toggle).not.toHaveBeenCalled();
  });

  it('explains an unknown webhook ID', async () => {
    webhooks.toggle.mockRejectedValueOnce(new Error('HTTP 404: not found'));
    const { text, isError } = await call('toggleWebhook', { webhookID: ID, active: true });
    expect(isError).toBe(true);
    expect(text).toContain('Webhook not found');
  });

  it('is a destructive write, so it stays off the read-only surface', () => {
    expect(ACTION_CATALOG.toggleWebhook.mutability).toBe('write');
    expect(getSurfaceActions('heliusStreaming', 'full')).toContain('toggleWebhook');
    expect(getSurfaceActions('heliusStreaming', 'readOnly')).not.toContain('toggleWebhook');
  });
});

describe('webhook status in getAllWebhooks and getWebhookByID', () => {
  it('shows enabled and disabled webhooks, treating a missing flag as enabled', async () => {
    webhooks.getAll.mockResolvedValueOnce([hook(true), { ...hook(false), webhookID: 'disabled-id' }, hook()]);
    const { text } = await call('getAllWebhooks');
    expect(text.match(/Status: enabled/g)).toHaveLength(2);
    expect(text).toContain('Status: **disabled**');
  });

  it('points a disabled webhook at toggleWebhook on the full surface', async () => {
    webhooks.get.mockResolvedValueOnce(hook(false));
    const { text } = await call('getWebhookByID', { webhookID: ID });
    expect(text).toContain('re-enable with `toggleWebhook`');
  });

  it('points at the dashboard instead on the read-only surface, which has no toggleWebhook', async () => {
    webhooks.get.mockResolvedValueOnce(hook(false));
    const { text } = await call('getWebhookByID', { webhookID: ID }, 'readOnly');
    expect(text).not.toContain('toggleWebhook');
    expect(text).toContain('https://dashboard.helius.dev/webhooks');
  });
});
