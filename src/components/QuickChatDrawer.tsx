import { lazy, Suspense, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '@/components/Logo';
import { writeUIMode } from '@/lib/ui-mode';

// Lazy: BuyerAgentPage carrega @google/genai, voice-input, nfe-parser,
// xlsx, jspdf — pesado. Lazy load remove ~150KB do bundle inicial
// (quem nunca abre o chat não paga o custo).
const BuyerAgentPage = lazy(() => import('@/routes/admin/BuyerAgentPage'));

interface Props {
  onClose: () => void;
}

/**
 * Drawer do chat IA — invocado via Cmd+K ou botão flutuante em Modo Manual.
 * Fica em overlay sobre o conteúdo, sem sair da página atual. Quem precisa
 * de chat full-screen abre Modo IA pelo header (Cmd+M ou toggle).
 */
export default function QuickChatDrawer({ onClose }: Props) {
  const navigate = useNavigate();

  // Esc fecha o drawer
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function expandToFullMode() {
    writeUIMode('ai');
    navigate('/ia');
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 top-12 z-40 bg-slate-900/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Painel — desliza da direita, ocupa ~700px no desktop e tela toda no mobile */}
      <div className="fixed right-0 bottom-0 top-12 z-50 flex w-full flex-col bg-white shadow-2xl md:w-[min(720px,90vw)]">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-3 text-xs">
          <div className="flex items-center gap-2 text-slate-500">
            <Logo size={16} />
            <span className="font-medium">EGP</span>
            <span className="text-slate-300">·</span>
            <span>Esc fecha · Cmd+M expande</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={expandToFullMode}
              title="Expandir pra Modo IA (Cmd+M)"
              aria-label="Expandir"
              className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center bg-slate-50">
                <div className="flex flex-col items-center gap-3 text-slate-400">
                  <Logo size={32} />
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500 [animation-delay:120ms]" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500 [animation-delay:240ms]" />
                  </div>
                  <p className="text-xs">Carregando chat…</p>
                </div>
              </div>
            }
          >
            <BuyerAgentPage />
          </Suspense>
        </div>
      </div>
    </>
  );
}
