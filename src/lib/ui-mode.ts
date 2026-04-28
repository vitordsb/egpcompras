// Modo de UI da aplicação:
// - 'manual' = sidebar lateral + páginas administrativas (default)
// - 'ai'     = chat com a IA em tela inteira, sem sidebar
//
// O modo é DERIVADO DA URL (fonte da verdade) — `/ia*` é Modo IA, qualquer
// outra rota admin é Modo Manual. localStorage só armazena a preferência
// pra decidir o redirect da home na próxima visita.

import { useLocation } from 'react-router-dom';

export type UIMode = 'manual' | 'ai';

const STORAGE_KEY = 'appCompras.uiMode';
const DEFAULT_MODE: UIMode = 'manual';

export function readUIMode(): UIMode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === 'ai' || saved === 'manual' ? saved : DEFAULT_MODE;
}

export function writeUIMode(mode: UIMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, mode);
}

const LAST_ADMIN_ROUTE_KEY = 'appCompras.lastAdminRoute';

export function readLastAdminRoute(): string {
  if (typeof window === 'undefined') return '/admin';
  return window.localStorage.getItem(LAST_ADMIN_ROUTE_KEY) ?? '/admin';
}

export function writeLastAdminRoute(path: string): void {
  if (typeof window === 'undefined') return;
  if (path.startsWith('/admin')) {
    window.localStorage.setItem(LAST_ADMIN_ROUTE_KEY, path);
  }
}

/**
 * Modo atual derivado da URL — sempre consistente com o que está sendo
 * renderizado. `/ia` ou `/ia/...` = 'ai'; resto = 'manual'.
 */
export function useUIMode(): UIMode {
  const location = useLocation();
  return location.pathname === '/ia' || location.pathname.startsWith('/ia/')
    ? 'ai'
    : 'manual';
}
