import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import Logo from '@/components/Logo';
import {
  type UIMode,
  readLastAdminRoute,
  writeUIMode,
} from '@/lib/ui-mode';

interface HeaderProps {
  mode: UIMode;
  /** Se passado, mostra um hamburguer no canto esquerdo em mobile (<md). */
  onMenuClick?: () => void;
}

export default function Header({ mode, onMenuClick }: HeaderProps) {
  const navigate = useNavigate();

  function switchTo(target: UIMode) {
    if (target === mode) return;
    writeUIMode(target);
    if (target === 'ai') {
      navigate('/ia');
    } else {
      navigate(readLastAdminRoute());
    }
  }

  async function signOut() {
    window.localStorage.removeItem('appCompras.internalSessionExpiresAt');
    await Promise.allSettled([
      supabase.auth.signOut(),
      fetch('/api/master-logout', { method: 'POST' }),
    ]);
    window.location.href = '/';
  }

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 md:px-4">
      <div className="flex items-center gap-2">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Abrir menu"
            className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-slate-100 md:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
        )}
        <Logo size={28} />
        <span className="hidden text-sm font-semibold text-slate-900 sm:inline">
          EGP Compras
        </span>
      </div>

      <div className="flex items-center gap-1 rounded-md bg-slate-100 p-0.5">
        <ModeButton
          active={mode === 'ai'}
          onClick={() => switchTo('ai')}
          label="EGP"
          shortcut="⌘M"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
          }
        />
        <ModeButton
          active={mode === 'manual'}
          onClick={() => switchTo('manual')}
          label="Manual"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          }
        />
      </div>

      <div className="flex w-7 justify-end sm:w-24">
        <button
          type="button"
          onClick={signOut}
          className="hidden rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 sm:inline-flex"
          title="Sair"
        >
          Sair
        </button>
      </div>
    </header>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  icon,
  shortcut,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-all',
        active
          ? 'bg-white text-brand-700 shadow-sm'
          : 'text-slate-600 hover:text-slate-900'
      )}
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
