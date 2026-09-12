import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { EventStoreProvider } from 'applesauce-react/providers';
import { createNostrClient } from '../../../../packages/nostr/src/client';

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
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  useEffect(() => client.connect(relayUrls), [client]);
  const connect = async () => {
    const { ExtensionSigner } = await import('applesauce-signers');
    const signer = new ExtensionSigner();
    const key = await signer.getPublicKey();
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new Error('The extension returned an invalid public key.');
    setPubkey(key);
  };
  return (
    <Context.Provider
      value={{
        pubkey,
        ready,
        connect,
        disconnect: () => setPubkey(null),
        relayConfigured: relayUrls.length > 0,
      }}
    >
      <EventStoreProvider eventStore={client.store}>{children}</EventStoreProvider>
    </Context.Provider>
  );
}
export function useNostr() {
  const value = useContext(Context);
  if (!value) throw new Error('NostrProvider missing');
  return value;
}
