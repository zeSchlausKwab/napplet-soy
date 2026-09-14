import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { EventStoreProvider } from 'applesauce-react/providers';
import { createNostrClient } from '../../../../packages/nostr/src/client';
import { browserIdentity, type IdentityState } from '../lib/browser-identity';
import { IdentityDialog } from './identity-dialog';

const Context = createContext<{
  pubkey: string | null;
  ready: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  relayConfigured: boolean;
} | null>(null);
const relayUrls = (import.meta.env.VITE_NOSTR_RELAYS ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);
export function NostrProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => createNostrClient());
  const [identity, setIdentity] = useState<IdentityState>({
    pubkey: null,
    method: null,
    reconnect: false,
  });
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
    const manager = browserIdentity();
    setIdentity(manager.state);
    return manager.subscribe(() => {
      setIdentity(manager.state);
      if (manager.state.authorization) setOpen(true);
    });
  }, []);
  useEffect(() => client.connect(relayUrls), [client]);
  const connect = async () => {
    setOpen(true);
  };
  return (
    <Context.Provider
      value={{
        pubkey: identity.pubkey,
        ready,
        connect,
        disconnect: () => browserIdentity().disconnect(),
        relayConfigured: relayUrls.length > 0,
      }}
    >
      <EventStoreProvider eventStore={client.store}>{children}</EventStoreProvider>
      <IdentityDialog open={open} setOpen={setOpen} identity={identity} />
    </Context.Provider>
  );
}
export function useNostr() {
  const value = useContext(Context);
  if (!value) throw new Error('NostrProvider missing');
  return value;
}
