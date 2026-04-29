import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import AdminLayout from '@/components/AdminLayout';
import IAModeLayout from '@/components/IAModeLayout';
import LoginPage from '@/routes/LoginPage';
import ProductsPage from '@/routes/admin/ProductsPage';
import ComponentsPage from '@/routes/admin/ComponentsPage';
import SuppliersPage from '@/routes/admin/SuppliersPage';
import QuotationsPage from '@/routes/admin/QuotationsPage';
import PedidosPage from '@/routes/admin/expedicao/PedidosPage';
import SaidasHistoricoPage from '@/routes/admin/expedicao/SaidasHistoricoPage';
import ObservacoesPage from '@/routes/admin/expedicao/ObservacoesPage';
import CostsPage from '@/routes/admin/CostsPage';
import AiUsagePage from '@/routes/admin/AiUsagePage';
import MemoriesPage from '@/routes/admin/MemoriesPage';
import ProceduresPage from '@/routes/admin/ProceduresPage';
import AccessUsersPage from '@/routes/admin/AccessUsersPage';
import TarefasPage from '@/routes/admin/TarefasPage';
import BriefingPage from '@/routes/admin/BriefingPage';
import FaltaComprarPage from '@/routes/admin/FaltaComprarPage';
import EstoquePage from '@/routes/admin/EstoquePage';
import ProducaoPage from '@/routes/admin/ProducaoPage';
import ComNotaPage from '@/routes/admin/financeira/ComNotaPage';
import SemNotaPage from '@/routes/admin/financeira/SemNotaPage';
import RelatorioFinanceiraPage from '@/routes/admin/financeira/RelatorioFinanceiraPage';
import SupplierQuotePage from '@/routes/public/SupplierQuotePage';
import PrestadoresPage from '@/routes/admin/rh/PrestadoresPage';
import CalculosPage from '@/routes/admin/rh/CalculosPage';
import HistoricoRhPage from '@/routes/admin/rh/HistoricoRhPage';
import { readUIMode, readLastAdminRoute } from '@/lib/ui-mode';
import { supabase } from '@/lib/supabase';
import { InternalAuthProvider } from '@/lib/auth-context';

const INTERNAL_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const INTERNAL_SESSION_EXPIRES_AT_KEY = 'appCompras.internalSessionExpiresAt';
const MASTER_ADMIN_EMAIL =
  import.meta.env.VITE_MASTER_ADMIN_EMAIL ?? 'vitinho123@grupoegp.local';

function setInternalSessionDeadline() {
  window.localStorage.setItem(
    INTERNAL_SESSION_EXPIRES_AT_KEY,
    String(Date.now() + INTERNAL_SESSION_TTL_MS)
  );
}

function clearInternalSessionDeadline() {
  window.localStorage.removeItem(INTERNAL_SESSION_EXPIRES_AT_KEY);
}

function internalSessionExpired() {
  const raw = window.localStorage.getItem(INTERNAL_SESSION_EXPIRES_AT_KEY);
  if (!raw) return false;
  return Number(raw) <= Date.now();
}

function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => window.clearTimeout(timer));
  });
}

function isAccessAdminSession(session: Session | null): boolean {
  const email = session?.user.email?.toLowerCase();
  return Boolean(
    email &&
      (email === MASTER_ADMIN_EMAIL.toLowerCase() ||
        session?.user.app_metadata?.access_admin === true)
  );
}

/**
 * Detecta se a app está rodando como portal público de cotação
 * (subdomínio cotacao.*). Nesse modo, expomos APENAS a rota /:token
 * — não há acesso ao admin a partir dessa URL.
 */
function isPublicQuoteSubdomain(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.startsWith('cotacao.');
}

export default function App() {
  if (isPublicQuoteSubdomain()) {
    return (
      <Routes>
        <Route path="/:token" element={<SupplierQuotePage />} />
        <Route
          path="*"
          element={
            <div className="mx-auto max-w-2xl p-8 text-sm text-slate-600">
              Link de cotação inválido. Pegue o link correto com o comprador.
            </div>
          }
        />
      </Routes>
    );
  }

  // Fallback público em dev/produção com uma única URL da Vercel.
  // Mantém o portal do fornecedor fora do login, mas só quando há token na rota.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/cotacao/')) {
    return (
      <Routes>
        <Route path="/cotacao/:token" element={<SupplierQuotePage />} />
        <Route path="*" element={<div className="p-6">404</div>} />
      </Routes>
    );
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [masterAuthenticated, setMasterAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  async function expireInternalSession() {
    clearInternalSessionDeadline();
    setMasterAuthenticated(false);
    setSession(null);
    await Promise.allSettled([
      supabase.auth.signOut(),
      fetch('/api/master-logout', { method: 'POST' }),
    ]);
  }

  useEffect(() => {
    let mounted = true;
    const loadingGuard = window.setTimeout(() => {
      if (!mounted) return;
      setLoading(false);
    }, 2500);
    Promise.all([
      withTimeout(supabase.auth.getSession(), { data: { session: null }, error: null }),
      withTimeout(
        fetch('/api/master-session').then((res) => (res.ok ? res.json() : null)),
        null
      ),
    ]).then(([{ data }, master]) => {
      if (!mounted) return;
      if ((data.session || master?.authenticated) && internalSessionExpired()) {
        expireInternalSession().finally(() => {
          if (mounted) setLoading(false);
        });
        return;
      }
      if ((data.session || master?.authenticated) && !window.localStorage.getItem(INTERNAL_SESSION_EXPIRES_AT_KEY)) {
        setInternalSessionDeadline();
      }
      setSession(data.session);
      setMasterAuthenticated(Boolean(master?.authenticated && master?.master));
      window.clearTimeout(loadingGuard);
      setLoading(false);
    }).catch(() => {
      if (!mounted) return;
      setSession(null);
      setMasterAuthenticated(false);
      window.clearTimeout(loadingGuard);
      setLoading(false);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_IN') setInternalSessionDeadline();
      if (event === 'SIGNED_OUT') clearInternalSessionDeadline();
      setSession(nextSession);
      setLoading(false);
    });
    return () => {
      mounted = false;
      window.clearTimeout(loadingGuard);
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session && !masterAuthenticated) return;
    const id = window.setInterval(() => {
      if (internalSessionExpired()) {
        expireInternalSession();
      }
    }, 60 * 1000);
    return () => window.clearInterval(id);
  }, [session, masterAuthenticated]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Carregando...
      </div>
    );
  }

  if (!session && !masterAuthenticated) {
    return (
      <Routes>
        <Route
          path="*"
          element={
            <LoginPage
              onMasterLogin={() => {
                setInternalSessionDeadline();
                setMasterAuthenticated(true);
              }}
            />
          }
        />
      </Routes>
    );
  }

  // Home redireciona pro último modo escolhido (default Manual → última rota admin)
  const initialMode = readUIMode();
  const homeTarget = initialMode === 'ai' ? '/ia' : readLastAdminRoute();
  const isAccessAdmin = masterAuthenticated || isAccessAdminSession(session);
  const userEmail = session?.user?.email ?? null;
  const RH_EMAILS = ['vitor@grupoegp.com.br', 'joane@grupoegp.com.br'];
  const isRhUser = userEmail != null && RH_EMAILS.includes(userEmail.toLowerCase());

  return (
    <InternalAuthProvider isMaster={isAccessAdmin} userEmail={userEmail}>
    <Routes>
      <Route path="/" element={<Navigate to={homeTarget} replace />} />
      <Route path="/login" element={<Navigate to={homeTarget} replace />} />

      {/* Modo IA — chat full-screen com header global */}
      <Route path="/ia" element={<IAModeLayout />} />
      {/* Compat: rota antiga do Comprador → vira Modo IA */}
      <Route path="/admin/comprador" element={<Navigate to="/ia" replace />} />

      {/* Modo Manual — sidebar + páginas */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<BriefingPage />} />
        <Route path="produtos" element={<ProductsPage />} />
        <Route path="componentes" element={<ComponentsPage />} />
        <Route path="cotacoes" element={<QuotationsPage />} />
        <Route path="expedicao" element={<Navigate to="/admin/expedicao/pedidos" replace />} />
        <Route path="expedicao/pedidos" element={<PedidosPage />} />
        <Route path="expedicao/saidas" element={<SaidasHistoricoPage />} />
        <Route path="expedicao/observacoes" element={<ObservacoesPage />} />
        {/* Compat: /admin/saidas → /admin/expedicao/pedidos */}
        <Route path="saidas" element={<Navigate to="/admin/expedicao/pedidos" replace />} />
        <Route path="custos" element={<CostsPage />} />
        <Route path="falta-comprar" element={<FaltaComprarPage />} />
        <Route path="estoque" element={<EstoquePage />} />
        <Route path="producao" element={<ProducaoPage />} />
        <Route path="fornecedores" element={<SuppliersPage />} />
        <Route path="consumo-ia" element={<AiUsagePage />} />
        <Route path="tarefas" element={<TarefasPage />} />
        <Route path="memorias" element={<MemoriesPage />} />
        <Route path="procedimentos" element={<ProceduresPage />} />
        <Route path="financeira" element={<Navigate to="/admin/financeira/com-nota" replace />} />
        <Route path="financeira/com-nota" element={<ComNotaPage />} />
        <Route path="financeira/sem-nota" element={<SemNotaPage />} />
        <Route path="financeira/relatorio" element={<RelatorioFinanceiraPage />} />
        <Route
          path="acessos"
          element={isAccessAdmin ? <AccessUsersPage /> : <Navigate to="/admin/produtos" replace />}
        />
        <Route path="rh" element={<Navigate to="/admin/rh/prestadores" replace />} />
        <Route path="rh/prestadores" element={isRhUser ? <PrestadoresPage /> : <Navigate to="/admin" replace />} />
        <Route path="rh/calculos"    element={isRhUser ? <CalculosPage />    : <Navigate to="/admin" replace />} />
        <Route path="rh/historico"   element={isRhUser ? <HistoricoRhPage /> : <Navigate to="/admin" replace />} />
      </Route>

      {/* Fallback pra desenvolvimento local: /cotacao/:token continua funcionando */}
      <Route path="/cotacao/:token" element={<SupplierQuotePage />} />
      <Route path="*" element={<div className="p-6">404</div>} />
    </Routes>
    </InternalAuthProvider>
  );
}
