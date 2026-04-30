import { useEffect } from 'react';

/**
 * Trava o scroll do body enquanto a flag estiver true.
 * Usar em modais para evitar scroll bleed-through.
 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const original = {
      overflow: document.body.style.overflow,
      paddingRight: document.body.style.paddingRight,
    };
    // Compensa o scrollbar pra não ter "shift" do conteúdo
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      document.body.style.overflow = original.overflow;
      document.body.style.paddingRight = original.paddingRight;
    };
  }, [active]);
}
