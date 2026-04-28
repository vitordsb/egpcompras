import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

interface InternalAuthContextValue {
  isMaster: boolean;
  userEmail: string | null;
  userLabel: string;
}

const InternalAuthContext = createContext<InternalAuthContextValue>({
  isMaster: false,
  userEmail: null,
  userLabel: 'Usuário',
});

export function InternalAuthProvider({
  isMaster,
  userEmail,
  children,
}: {
  isMaster: boolean;
  userEmail: string | null;
  children: ReactNode;
}) {
  const userLabel = userEmail ?? (isMaster ? 'Admin' : 'Usuário');
  return (
    <InternalAuthContext.Provider value={{ isMaster, userEmail, userLabel }}>
      {children}
    </InternalAuthContext.Provider>
  );
}

export function useInternalAuth() {
  return useContext(InternalAuthContext);
}
