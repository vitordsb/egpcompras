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

  // WhatsApp inbound recentes — Realtime + "last seen" persistido
  // Badge conta APENAS mensagens inbound chegadas DEPOIS da última vez
  // que o user abriu a WhatsAppPage (timestamp em localStorage).
  useEffect(() => {
    let cancelled = false;

    function getLastSeen(): string {
      // Default: 24h atrás na primeira visita
      const stored = localStorage.getItem(WA_LAST_SEEN_KEY);
      if (stored) return stored;
      return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    }

    async function loadInitial() {
      const since = getLastSeen();
      const { count } = await supabase
        .from('whatsapp_messages')
        .select('id', { count: 'exact', head: true })
        .eq('direction', 'in')
        .gte('created_at', since);
      if (cancelled) return;
      setBadges((prev) => ({ ...prev, whatsapp_recent: count ?? 0 }));
    }
    loadInitial();

    // Realtime: incrementa o badge quando chega mensagem inbound NOVA
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

    // Escuta evento custom 'wa-seen' (disparado pela WhatsAppPage) → zera badge
    function onSeen() {
      if (cancelled) return;
      setBadges((prev) => ({ ...prev, whatsapp_recent: 0 }));
    }
    window.addEventListener('wa-seen', onSeen);

    // Re-sync a cada 5 min (cobre casos onde Realtime perde mensagem ou aba ficou em background)
    const refresh = setInterval(loadInitial, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(refresh);
      window.removeEventListener('wa-seen', onSeen);
      supabase.removeChannel(channel);
    };
  }, []);

  return badges;
}

const WA_LAST_SEEN_KEY = 'wa_last_seen_at';

/** Marca como "visto" — chamado pela WhatsAppPage no mount. Persiste o
 *  timestamp em localStorage e dispara evento custom pra zerar o badge
 *  no useNavBadges sem precisar de prop drilling. */
export function markWhatsappAsSeen() {
  localStorage.setItem(WA_LAST_SEEN_KEY, new Date().toISOString());
  window.dispatchEvent(new CustomEvent('wa-seen'));
}
