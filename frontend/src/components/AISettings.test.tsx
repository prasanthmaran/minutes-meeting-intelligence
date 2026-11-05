import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AISettings } from './AISettings';
afterEach(() => { cleanup(); vi.unstubAllGlobals() });
it('sends a masked key to the local backend and enables AI only after success', async () => {
  const connected = vi.fn();
  const fetch = vi.fn(async () => ({ok: true, status: 200, json: async () => ({mode: 'anthropic'})}));
  vi.stubGlobal('fetch', fetch);
  render(<AISettings onClose={vi.fn()} onConnected={connected} />);
  const input = screen.getByLabelText('Anthropic API key');
  expect(input).toHaveAttribute('type', 'password');
  fireEvent.change(input, {target: {value: 'test-only'}});
  fireEvent.click(screen.getByRole('button', {name: 'Connect and enable AI'}));
  await waitFor(() => expect(connected).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledWith('/api/settings/anthropic', expect.objectContaining({method:'POST',body:JSON.stringify({api_key:'test-only'})}));
});
it('shows key rejection without enabling AI', async () => {
  const connected = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => ({ok:false, status:502, json:async()=>({detail:'The AI provider rejected this key.'})})));
  render(<AISettings onClose={vi.fn()} onConnected={connected} />);
  fireEvent.change(screen.getByLabelText('Anthropic API key'), {target: {value:'test-only'}});
  fireEvent.click(screen.getByRole('button', {name:'Connect and enable AI'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('rejected');
  expect(connected).not.toHaveBeenCalled();
});
it('shows a connected key as masked with replace and remove actions', async () => {
  const disconnected = vi.fn();
  const fetch = vi.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () =>
      init?.method === 'DELETE'
        ? { mode: 'demo' }
        : url === '/api/settings'
          ? { ai: { mode: 'anthropic', model: 'claude-haiku', key_hint: '…abcd' }, voice: { connected: false, key_hint: null, voice_id: 'v' } }
          : {},
  }));
  vi.stubGlobal('fetch', fetch);
  render(<AISettings mode="anthropic" onClose={vi.fn()} onConnected={vi.fn()} onDisconnected={disconnected} />);
  expect(await screen.findByText('••••••••abcd')).toBeInTheDocument();
  expect(screen.queryByLabelText('Anthropic API key')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Replace key' }));
  expect(screen.getByLabelText('New Anthropic API key')).toHaveAttribute('type', 'password');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));
  await waitFor(() => expect(disconnected).toHaveBeenCalledWith('demo'));
  expect(fetch).toHaveBeenCalledWith('/api/settings/anthropic', expect.objectContaining({ method: 'DELETE' }));
  expect(screen.getByLabelText('Anthropic API key')).toBeInTheDocument();
});
