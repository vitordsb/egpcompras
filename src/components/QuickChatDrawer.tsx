import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import BuyerAgentPage from '@/routes/admin/BuyerAgentPage';
import { writeUIMode } from '@/lib/ui-mode';

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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
            <span className="font-medium">Chat IA</span>
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
          <BuyerAgentPage />
        </div>
      </div>
    </>
  );
}
