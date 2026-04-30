import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { type UserRole, HARDCODED_ADMINS } from '@/lib/roles';

interface InternalAuthContextValue {
  isMaster: boolean;
  userEmail: string | null;
  userLabel: string;
  userRole: UserRole;
  roleLoading: boolean;
}

const InternalAuthContext = createContext<InternalAuthContextValue>({
  isMaster: false,
  userEmail: null,
  userLabel: 'Usuário',
  userRole: 'vendas',
  roleLoading: true,
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
  const [userRole, setUserRole] = useState<UserRole>('vendas');
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    if (isMaster) {
      setUserRole('admin');
      setRoleLoading(false);
      return;
    }
    if (!userEmail) {
      setUserRole('vendas');
      setRoleLoading(false);
      return;
    }
    // Admins fixos nunca podem ser rebaixados
    if (HARDCODED_ADMINS.includes(userEmail.toLowerCase())) {
      setUserRole('admin');
      setRoleLoading(false);
      return;
    }
    // Busca cargo no banco
    supabase
      .from('user_profiles')
      .select('role')
      .eq('email', userEmail.toLowerCase())
      .maybeSingle()
      .then(({ data }) => {
        setUserRole((data?.role as UserRole) ?? 'vendas');
        setRoleLoading(false);
      });
  }, [isMaster, userEmail]);

  return (
    <InternalAuthContext.Provider value={{ isMaster, userEmail, userLabel, userRole, roleLoading }}>
      {children}
    </InternalAuthContext.Provider>
  );
}

export function useInternalAuth() {
  return useContext(InternalAuthContext);
}
