import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface NavBadges {
  /** purchase_needs com status='pedido' e expected_arrival < hoje */
  comprado_atrasado: number;
  /** Mensagens WhatsApp inbound recebidas nos últimos 60 minutos (não-lidas
   *  no sentido fraco — não tem campo read_at ainda, então usa "recente") */
  whatsapp_recent: number;
}

const EMPTY: NavBadges = { comprado_atrasado: 0, whatsapp_recent: 0 };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Hook simples para alimentar badges na sidebar. Inicializa via fetch e
 * atualiza em tempo real via Supabase Realtime pra mensagens WhatsApp.
 * Centralizado pra qualquer item de menu poder mostrar uma contagem visual.
 */
export function useNavBadges(): NavBadges {
  const [badges, setBadges] = useState<NavBadges>(EMPTY);

  // Purchase needs atrasadas (polling 60s — não muda em tempo real)
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
      setBadges((prev) => ({ ...prev, comprado_atrasado: count ?? 0 }));
    }
    load();
    const id = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // WhatsApp inbound recentes — Realtime
  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from('whatsapp_messages')
        .select('id', { count: 'exact', head: true })
        .eq('direction', 'in')
        .gte('created_at', since);
      if (cancelled) return;
      setBadges((prev) => ({ ...prev, whatsapp_recent: count ?? 0 }));
    }
    loadInitial();

    // Realtime: incrementa o badge quando chega mensagem inbound
    const channel = supabase
      .channel('nav-badge:whatsapp')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'whatsapp_messages',
          filter: 'direction=eq.in',
        },
        () => {
          setBadges((prev) => ({ ...prev, whatsapp_recent: prev.whatsapp_recent + 1 }));
        },
      )
      .subscribe();

    // Refresh a cada 5 min pra expurgar mensagens > 60min do contador
    const refresh = setInterval(loadInitial, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(refresh);
      supabase.removeChannel(channel);
    };
  }, []);

  return badges;
}

/** Marca todas as mensagens WhatsApp inbound como "vistas" — chamado pela
 *  WhatsAppPage quando ela é aberta. Zera o badge globalmente. */
export function clearWhatsappBadge(setter: (b: NavBadges) => void) {
  // Como não temos coluna read_at, só zera o estado local
  setter({ ...EMPTY, whatsapp_recent: 0 });
}
