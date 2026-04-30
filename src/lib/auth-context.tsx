import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { type UserRole, type PageKey, HARDCODED_ADMINS, ALL_PAGE_KEYS } from '@/lib/roles';

interface InternalAuthContextValue {
  isMaster: boolean;
  userEmail: string | null;
  userLabel: string;
  userRole: UserRole;
  /** Seções que o usuário pode acessar. null = ainda carregando. '*' = admin (tudo). */
  allowedPageKeys: PageKey[] | '*' | null;
}

const InternalAuthContext = createContext<InternalAuthContextValue>({
  isMaster: false,
  userEmail: null,
  userLabel: 'Usuário',
  userRole: 'vendas',
  allowedPageKeys: null,
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
  const [allowedPageKeys, setAllowedPageKeys] = useState<PageKey[] | '*' | null>(null);

  useEffect(() => {
    if (isMaster) {
      setUserRole('admin');
      setAllowedPageKeys('*');
      return;
    }
    if (!userEmail) {
      setUserRole('vendas');
      setAllowedPageKeys([]);
      return;
    }
    if (HARDCODED_ADMINS.includes(userEmail.toLowerCase())) {
      setUserRole('admin');
      setAllowedPageKeys('*');
      return;
    }

    // Busca cargo + permissões em paralelo
    Promise.all([
      supabase.from('user_profiles').select('role').eq('email', userEmail.toLowerCase()).maybeSingle(),
      supabase.from('role_page_permissions').select('page_key').eq('role',
        // placeholder — será sobrescrito após buscar o role real
        'vendas'
      ),
    ]).then(async ([profileRes]) => {
      const role: UserRole = (profileRes.data?.role as UserRole) ?? 'vendas';
      setUserRole(role);

      // Agora busca as permissões com o role correto
      const { data: permsData } = await supabase
        .from('role_page_permissions')
        .select('page_key')
        .eq('role', role);

      const keys = ((permsData ?? []) as { page_key: string }[])
        .map((r) => r.page_key)
        .filter((k) => ALL_PAGE_KEYS.includes(k as PageKey)) as PageKey[];
      setAllowedPageKeys(keys);
    });
  }, [isMaster, userEmail]);

  return (
    <InternalAuthContext.Provider value={{ isMaster, userEmail, userLabel, userRole, allowedPageKeys }}>
      {children}
    </InternalAuthContext.Provider>
  );
}

export function useInternalAuth() {
  return useContext(InternalAuthContext);
}
