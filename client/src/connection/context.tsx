import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ConnectionSnapshot, ConnectionStore } from './store';

const StoreContext = createContext<ConnectionStore | null>(null);

export function ConnectionProvider({ store, children }: { store: ConnectionStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): ConnectionStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <ConnectionProvider>');
  return store;
}

export function useConnectionState(): ConnectionSnapshot {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
