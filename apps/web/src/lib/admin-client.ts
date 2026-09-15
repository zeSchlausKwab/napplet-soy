import { useCallback, useEffect, useRef, useState } from 'react';
import { signForAccount } from './community-client';
import { browserIdentity } from './browser-identity';
import { sha256 } from '../../../../packages/protocol/src';
import type { ModerationAction } from '../../../../packages/moderation/src/policy';
import type { AdminState } from '../../../../packages/moderation/src/admin-model';

export type AdminAccess = 'checking' | 'authorized' | 'denied' | 'error';
export function useAdminAccess(pubkey: string | null, menuOpen: boolean) {
  const [result, setResult] = useState<{ pubkey: string | null; access: AdminAccess } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    pending.current?.abort();
    if (!pubkey) {
      setResult(null);
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    try {
      const response = await fetch(`/api/admin-access?pubkey=${pubkey}`, {
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!controller.signal.aborted)
        setResult({ pubkey, access: data.authorized === true ? 'authorized' : 'denied' });
    } catch {
      if (!controller.signal.aborted) setResult({ pubkey, access: 'error' });
    }
  }, [pubkey]);
  useEffect(() => {
    void refresh();
    const focus = () => {
      void refresh();
    };
    window.addEventListener('focus', focus);
    return () => {
      pending.current?.abort();
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);
  useEffect(() => {
    if (menuOpen) void refresh();
  }, [menuOpen, refresh]);
  return {
    access: !pubkey
      ? ('denied' as const)
      : result?.pubkey === pubkey
        ? result.access
        : ('checking' as const),
    refresh,
  };
}

export class AdminRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function adminRequest(pubkey: string, signal: AbortSignal, input?: ModerationAction) {
  const url = new URL('/api/admin', location.origin).href;
  const method = input ? 'POST' : 'GET';
  const body = input ? JSON.stringify(input) : undefined;
  const tags = [
    ['u', url],
    ['method', method],
    ['nonce', crypto.randomUUID()],
  ];
  if (body) tags.push(['payload', await sha256(body)]);
  const event = await signForAccount(pubkey, {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags,
  });
  signal.throwIfAborted();
  if (browserIdentity().state.pubkey !== pubkey) throw new Error('The selected account changed.');
  const response = await fetch(url, {
    method,
    body,
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    headers: {
      Authorization: `Nostr ${btoa(JSON.stringify(event))}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const data = await response.json();
  signal.throwIfAborted();
  if (!response.ok) throw new AdminRequestError(data.error || 'Request failed.', response.status);
  return data as Omit<AdminState, 'catalog'> & { catalog?: AdminState['catalog'] };
}
