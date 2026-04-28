// Modo de UI da aplicação:
// - 'manual' = sidebar lateral + páginas administrativas (default)
// - 'ai'     = chat com a IA em tela inteira, sem sidebar
//
// O modo é salvo em localStorage por navegador. Toggle é feito pelo header.

import { useEffect, useState } from 'react';

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
  if (typeof window === 'undefined') return '/admin/produtos';
  return window.localStorage.getItem(LAST_ADMIN_ROUTE_KEY) ?? '/admin/produtos';
}

export function writeLastAdminRoute(path: string): void {
  if (typeof window === 'undefined') return;
  if (path.startsWith('/admin')) {
    window.localStorage.setItem(LAST_ADMIN_ROUTE_KEY, path);
  }
}

/**
 * Hook que reage a mudanças no modo (incluindo de outras abas via storage event).
 */
export function useUIMode(): UIMode {
  const [mode, setMode] = useState<UIMode>(() => readUIMode());

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY && (e.newValue === 'ai' || e.newValue === 'manual')) {
        setMode(e.newValue);
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return mode;
}
