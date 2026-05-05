import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface NavBadges {
  /** purchase_needs com status='pedido' e expected_arrival < hoje */
  comprado_atrasado: number;
}

const EMPTY: NavBadges = { comprado_atrasado: 0 };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Hook simples para alimentar badges na sidebar. Recarrega a cada 60s.
 * Centralizado pra qualquer item de menu poder mostrar uma contagem visual.
 */
export function useNavBadges(): NavBadges {
  const [badges, setBadges] = useState<NavBadges>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { count, error } = await supabase
        .from('purchase_needs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pedido')
        .lt('expected_arrival', todayISO());
      if (cancelled) return;
      if (error) return;
      setBadges({ comprado_atrasado: count ?? 0 });
    }
    load();
    const id = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return badges;
}
