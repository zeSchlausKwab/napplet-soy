import { protocolClient, manifestAllowed } from './network';
import { profileView, latestProfile } from '../../../../packages/protocol/src/profile';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { ProfileView } from '../../../../packages/protocol/src/profile';

class ProfileCache {
  profiles = new Map<string, ProfileView>();
  private fresh = new Map<string, number>();
  private queued = new Set<string>();
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private active = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  seed(profile: ProfileView) {
    this.profiles.set(profile.pubkey, profile);
    this.fresh.set(profile.pubkey, Date.now());
    while (this.profiles.size > 1024) this.profiles.delete(this.profiles.keys().next().value!);
    while (this.fresh.size > 2048) this.fresh.delete(this.fresh.keys().next().value!);
    for (const listener of this.listeners) listener();
  }
  ensure(pubkey: string) {
    if ((this.fresh.get(pubkey) ?? 0) > Date.now() - 60000) return;
    this.queued.add(pubkey);
    this.schedule();
  }
  private schedule() {
    if (!this.timer && this.active < 2 && this.queued.size)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, 20);
  }
  private async flush() {
    const keys = [...this.queued].slice(0, 32);
    if (!keys.length) return;
    this.active++;
    for (const key of keys) {
      this.queued.delete(key);
      this.fresh.set(key, Date.now());
    }
    this.schedule();
    try {
      const events = await protocolClient().query([
        { kinds: [0], authors: keys, limit: keys.length * 2 },
      ]);
      for (const key of keys) {
        const event = latestProfile(events, key);
        if (!event || manifestAllowed(event)) this.seed(profileView(key, event));
      }
    } catch {
    } finally {
      this.active--;
      this.schedule();
    }
  }
}
const Context = createContext<ProfileCache | null>(null);
export function ProfilesProvider({ children }: { children: ReactNode }) {
  const [cache] = useState(() => new ProfileCache());
  return <Context.Provider value={cache}>{children}</Context.Provider>;
}
export function useProfiles() {
  const cache = useContext(Context);
  if (!cache) throw new Error('ProfilesProvider missing');
  return cache;
}
export function useProfile(pubkey: string) {
  const cache = useProfiles();
  const profile = useSyncExternalStore(
    cache.subscribe,
    () => cache.profiles.get(pubkey),
    () => undefined,
  );
  useEffect(() => {
    cache.ensure(pubkey);
  }, [pubkey, cache]);
  return profile;
}
