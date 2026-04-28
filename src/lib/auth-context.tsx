import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

interface InternalAuthContextValue {
  isMaster: boolean;
}

const InternalAuthContext = createContext<InternalAuthContextValue>({ isMaster: false });

export function InternalAuthProvider({
  isMaster,
  children,
}: {
  isMaster: boolean;
  children: ReactNode;
}) {
  return (
    <InternalAuthContext.Provider value={{ isMaster }}>
      {children}
    </InternalAuthContext.Provider>
  );
}

export function useInternalAuth() {
  return useContext(InternalAuthContext);
}
