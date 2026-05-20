import { lazy, Suspense, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '@/components/Header';
import { readLastAdminRoute, useUIMode, writeUIMode } from '@/lib/ui-mode';

const BuyerAgentPage = lazy(() => import('@/routes/admin/BuyerAgentPage'));

/**
 * Layout do Modo IA: header global + chat em tela inteira (sem sidebar).
 * Cmd+M / Alt+M alterna pra Modo Manual.
 */
export default function IAModeLayout() {
  const mode = useUIMode();
  const navigate = useNavigate();

  useEffect(() => { document.title = 'EGP — EGP Compras'; }, []);

  // Garante que o localStorage reflete o modo atual ao montar
  useEffect(() => {
    writeUIMode('ai');
  }, []);

  // Atalho global: Cmd+M / Alt+M alterna pra Manual
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.altKey;
      if (meta && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        writeUIMode('manual');
        navigate(readLastAdminRoute());
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <Header mode={mode} />
      <div className="flex-1 min-h-0 overflow-hidden">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <div className="flex items-center gap-1 text-slate-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500 [animation-delay:120ms]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500 [animation-delay:240ms]" />
              </div>
            </div>
          }
        >
          <BuyerAgentPage />
        </Suspense>
      </div>
    </div>
  );
}
