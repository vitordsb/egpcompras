import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '@/components/Header';
import BuyerAgentPage from '@/routes/admin/BuyerAgentPage';
import { readLastAdminRoute, useUIMode, writeUIMode } from '@/lib/ui-mode';

/**
 * Layout do Modo IA: header global + chat em tela inteira (sem sidebar).
 * Cmd+M / Alt+M alterna pra Modo Manual.
 */
export default function IAModeLayout() {
  const mode = useUIMode();
  const navigate = useNavigate();

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
        <BuyerAgentPage />
      </div>
    </div>
  );
}
