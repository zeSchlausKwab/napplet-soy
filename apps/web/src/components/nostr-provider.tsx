import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { EventStoreProvider } from 'applesauce-react/providers';
import { createNostrClient } from '../../../../packages/nostr/src/client';
import { browserIdentity, type IdentityState } from '../lib/browser-identity';
import { IdentityMenu } from './identity-menu';

const Context = createContext<{
  pubkey: string | null;
  ready: boolean;
  needsReconnect: boolean;
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
  const connect = async () => {
    document
      .getElementById('identity-button')
      ?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    setOpen(true);
  };
  useEffect(() => {
    setReady(true);
    const manager = browserIdentity();
    setIdentity(manager.state);
    void manager.initialize();
    const sync = () => {
      void manager.sync();
    };
    window.addEventListener('focus', sync);
    const unsubscribe = manager.subscribe(() => {
      setIdentity(manager.state);
      if (manager.state.authorization) void connect();
    });
    return () => {
      unsubscribe();
      window.removeEventListener('focus', sync);
    };
  }, []);
  useEffect(() => client.connect(relayUrls), [client]);
  return (
    <Context.Provider
      value={{
        pubkey: identity.pubkey,
        ready,
        needsReconnect: identity.reconnect || !!identity.restoring,
        connect,
        disconnect: () => browserIdentity().disconnect(),
        relayConfigured: relayUrls.length > 0,
      }}
    >
      <EventStoreProvider eventStore={client.store}>
        <IdentityMenu open={open} setOpen={setOpen} identity={identity}>
          {children}
        </IdentityMenu>
      </EventStoreProvider>
    </Context.Provider>
  );
}
export function useNostr() {
  const value = useContext(Context);
  if (!value) throw new Error('NostrProvider missing');
  return value;
}
