import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

type NeedStatus = 'pendente' | 'pedido' | 'chegou' | 'cancelado';

interface Note {
  id: string;
  content: string;
  author: string | null;
  created_at: string;
}

interface PurchaseNeed {
  id: string;
  item_name: string;
  item_code: string | null;
  quantity: number | null;
  unit: string | null;
  status: NeedStatus;
  updated_at: string;
  notes: Note[];
  shipment: {
    id: string;
    client_name: string;
    numero_venda: string | null;
    numero_nfe: string | null;
  } | null;
}

const STATUS_LABEL: Record<NeedStatus, string> = {
  pendente:  'Pendente',
  pedido:    'Pedido',
  chegou:    'Chegou',
  cancelado: 'Cancelado',
};

const STATUS_PILL: Record<NeedStatus, string> = {
  pendente:  'bg-amber-50 text-amber-700 border border-amber-200',
  pedido:    'bg-brand-50 text-brand-700 border border-brand-200',
  chegou:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
  cancelado: 'bg-slate-100 text-slate-500 border border-slate-200',
};

const STATUS_FLOW: NeedStatus[] = ['pendente', 'pedido', 'chegou', 'cancelado'];

function fmtQty(n: number | null, u: string | null) {
  if (!n) return '';
  return u ? `${n} ${u}` : String(n);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

interface StockItem {
  id: string;
  item_code: string;
  item_name: string;
  quantity: number;
  reserved_quantity: number;
  unit: string;
  min_quantity: number;
}

export default function FaltaComprarPage() {
  const [needs, setNeeds] = useState<PurchaseNeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<NeedStatus | 'all'>('pendente');
  const [stock, setStock] = useState<StockItem[]>([]);
  const [stockSearch, setStockSearch] = useState('');
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [addingNote, setAddingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function load() {
    setLoading(true);
    // Carrega todos os status sempre, para que os counts dos cards fiquem corretos.
    // Filtragem por status acontece in-memory (ver `filteredNeeds` abaixo).
    const { data } = await supabase
      .from('purchase_needs')
      .select(`id, item_name, item_code, quantity, unit, status, updated_at,
               shipment:shipments(id, client_name, numero_venda, numero_nfe),
               notes:purchase_need_notes(id, content, author, created_at)`)
      .order('updated_at', { ascending: false })
      .limit(500);
    setNeeds((data ?? []) as unknown as PurchaseNeed[]);
    setLoading(false);
  }

  async function loadStock() {
    const { data } = await supabase
      .from('stock_items')
      .select('id, item_code, item_name, quantity, reserved_quantity, unit, min_quantity')
      .order('item_name');
    setStock((data ?? []) as StockItem[]);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { loadStock(); }, []);

  function toggleNotes(id: string) {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function changeStatus(need: PurchaseNeed, newStatus: NeedStatus) {
    setUpdatingStatus(need.id);
    await supabase
      .from('purchase_needs')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', need.id);
    setUpdatingStatus(null);
    load();
  }

  async function submitNote(e: FormEvent) {
    e.preventDefault();
    if (!addingNote || !noteText.trim()) return;
    setSavingNote(true);
    await supabase.from('purchase_need_notes').insert({
      need_id: addingNote,
      content: noteText.trim(),
      author: null,
    });
    setSavingNote(false);
    setAddingNote(null);
    setNoteText('');
    load();
  }

  // Filtragem in-memory (load traz todos os status — assim os counts ficam corretos)
  const filteredNeeds = statusFilter === 'all'
    ? needs
    : needs.filter((n) => n.status === statusFilter);

  // Agrupa por pedido
  const grouped = filteredNeeds.reduce<Record<string, { shipment: PurchaseNeed['shipment']; items: PurchaseNeed[] }>>((acc, n) => {
    const key = n.shipment?.id ?? '__sem_pedido__';
    if (!acc[key]) acc[key] = { shipment: n.shipment, items: [] };
    acc[key].items.push(n);
    return acc;
  }, {});

  const stats = {
    pendente:  needs.filter((n) => n.status === 'pendente').length,
    pedido:    needs.filter((n) => n.status === 'pedido').length,
    chegou:    needs.filter((n) => n.status === 'chegou').length,
  };

  const filteredStock = stock.filter((s) => {
    if (!stockSearch.trim()) return true;
    const q = stockSearch.toLowerCase();
    return s.item_name.toLowerCase().includes(q) || s.item_code.toLowerCase().includes(q);
  });

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">

      {/* ── Painel esquerdo: Falta Comprar ── */}
      <div className="flex flex-1 flex-col overflow-hidden border-r border-slate-200">
        <div className="shrink-0 border-b border-slate-200 px-6 py-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Falta Comprar</h1>
            <p className="text-xs text-slate-500">Itens faltantes por pedido. Clique no card para ver os itens.</p>
          </div>
          {/* Atalho IA contextual — abre o chat já com prompt pré-formado */}
          <button
            type="button"
            onClick={async () => {
              const { askAi } = await import('@/lib/ai-bridge');
              askAi('O que tá faltando comprar pros pedidos pendentes? Mostra agrupado por urgência.');
            }}
            className="flex items-center gap-1.5 rounded-full border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-800 hover:bg-violet-100 transition-colors shrink-0"
            title="Perguntar pra IA sobre essa página"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
            Resumir com IA
          </button>
        </div>

        {/* Stats */}
        <div className="shrink-0 grid gap-2 grid-cols-4 px-6 py-3 border-b border-slate-100">
        {([
          { key: 'all',      label: 'Todos',    value: needs.length,    color: 'text-slate-900' },
          { key: 'pendente', label: 'Pendentes', value: stats.pendente, color: 'text-amber-700' },
          { key: 'pedido',   label: 'Pedidos',   value: stats.pedido,   color: 'text-brand-700' },
          { key: 'chegou',   label: 'Chegaram',  value: stats.chegou,   color: 'text-emerald-700' },
        ] as const).map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setStatusFilter(s.key as NeedStatus | 'all')}
            className={cn(
              'rounded-lg border p-2 text-left transition-colors',
              statusFilter === s.key
                ? 'border-brand-300 bg-brand-50'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            )}
          >
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{s.label}</div>
            <div className={cn('mt-0.5 text-xl font-semibold', s.color)}>{s.value}</div>
          </button>
        ))}
      </div>

        {/* Lista de grupos */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <p className="text-sm text-slate-500 px-2">Carregando…</p>
        ) : Object.keys(grouped).length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm text-slate-500">
                {statusFilter === 'chegou' ? 'Nenhum item chegou ainda.' : 'Nenhum item pendente. '}
                {statusFilter === 'pendente' && 'Tudo certo por enquanto.'}
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-2">
          {Object.entries(grouped).map(([key, group]) => {
            const isOpen = expandedGroups.has(key);
            const pendingCount = group.items.filter((i) => i.status === 'pendente').length;
            const pedidoCount  = group.items.filter((i) => i.status === 'pedido').length;
            return (
            <Card key={key}>
              {/* Cabeçalho clicável */}
              <button
                type="button"
                onClick={() => toggleGroup(key)}
                className="w-full border-b border-slate-100 px-5 py-3 text-left hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 shrink-0 text-slate-400">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
                  </svg>
                  {group.shipment ? (
                    <>
                      {group.shipment.client_name}
                      {group.shipment.numero_venda && <span className="text-slate-400"> · #{group.shipment.numero_venda}</span>}
                      {group.shipment.numero_nfe && <span className="text-xs text-slate-400"> · NF {group.shipment.numero_nfe}</span>}
                    </>
                  ) : (
                    <span className="text-slate-500">Sem pedido vinculado</span>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    {pendingCount > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">{pendingCount} pendente{pendingCount !== 1 ? 's' : ''}</span>
                    )}
                    {pedidoCount > 0 && (
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700">{pedidoCount} pedido{pedidoCount !== 1 ? 's' : ''}</span>
                    )}
                    <svg viewBox="0 0 20 20" fill="currentColor" className={cn('h-4 w-4 text-slate-400 transition-transform', isOpen && 'rotate-180')}>
                      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
              </button>

              {/* Itens — só visíveis quando expandido */}
              {isOpen && <div className="divide-y divide-slate-100">
                {group.items.map((need) => (
                  <div key={need.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-900">{need.item_name}</span>
                          {need.item_code && <span className="text-xs text-slate-400">{need.item_code}</span>}
                          {need.quantity && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{fmtQty(need.quantity, need.unit)}</span>}
                          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_PILL[need.status])}>
                            {STATUS_LABEL[need.status]}
                          </span>
                        </div>

                        {/* Última nota */}
                        {need.notes.length > 0 && !expandedNotes.has(need.id) && (
                          <p className="mt-1 text-xs text-slate-500 line-clamp-1">
                            {need.notes[need.notes.length - 1].content}
                          </p>
                        )}
                      </div>

                      {/* Ações */}
                      <div className="flex shrink-0 items-center gap-2">
                        {/* Avançar status */}
                        {(() => {
                          const nextIdx = STATUS_FLOW.indexOf(need.status) + 1;
                          const next = STATUS_FLOW[nextIdx] as NeedStatus | undefined;
                          if (!next || next === 'cancelado') return null;
                          return (
                            <button
                              type="button"
                              onClick={() => changeStatus(need, next)}
                              disabled={updatingStatus === need.id}
                              className="rounded px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                            >
                              {updatingStatus === need.id ? '…' : `→ ${STATUS_LABEL[next]}`}
                            </button>
                          );
                        })()}
                        <button
                          type="button"
                          onClick={() => { setAddingNote(need.id); setNoteText(''); }}
                          className="rounded px-2.5 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50"
                        >
                          + nota
                        </button>
                        {need.notes.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleNotes(need.id)}
                            className="text-xs text-slate-400 hover:text-slate-600"
                          >
                            {expandedNotes.has(need.id) ? 'ocultar' : `${need.notes.length} nota${need.notes.length !== 1 ? 's' : ''}`}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Formulário de nova nota */}
                    {addingNote === need.id && (
                      <form onSubmit={submitNote} className="mt-2 space-y-1.5">
                        <Textarea
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder="Ex: Cobrei o fornecedor X em 28/04, prazo 3 dias úteis…"
                          rows={2}
                          autoFocus
                        />
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="secondary" size="sm" onClick={() => setAddingNote(null)}>
                            Cancelar
                          </Button>
                          <Button type="submit" size="sm" disabled={!noteText.trim() || savingNote}>
                            {savingNote ? 'Salvando…' : 'Salvar nota'}
                          </Button>
                        </div>
                      </form>
                    )}

                    {/* Histórico de notas */}
                    {expandedNotes.has(need.id) && need.notes.length > 0 && (
                      <div className="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-3">
                        {[...need.notes].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((note) => (
                          <div key={note.id} className="text-xs">
                            <span className="text-slate-700">{note.content}</span>
                            <span className="ml-2 text-slate-400">
                              {fmtDate(note.created_at)}
                              {note.author && ` · ${note.author}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>}
            </Card>
            );
          })}
          </div>
        )}
        </div>
      </div>

      {/* ── Painel direito: Estoque disponível ── */}
      <div className="flex w-72 shrink-0 flex-col overflow-hidden bg-slate-50 xl:w-80">
        <div className="shrink-0 border-b border-slate-200 px-4 py-4">
          <h2 className="text-sm font-semibold text-slate-700">Estoque disponível</h2>
          <input
            type="search"
            value={stockSearch}
            onChange={(e) => setStockSearch(e.target.value)}
            placeholder="Buscar item…"
            className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {filteredStock.length === 0 ? (
            <p className="px-2 py-4 text-xs text-slate-400">
              {stock.length === 0 ? 'Nenhum item no estoque.' : 'Nenhum resultado.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {filteredStock.map((s) => {
                const available = Number(s.quantity) - Number(s.reserved_quantity);
                const low = Number(s.min_quantity) > 0 && available <= Number(s.min_quantity);
                const negative = available < 0;
                return (
                  <li key={s.id} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-white">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-slate-800">{s.item_name}</div>
                      <div className="text-[10px] font-mono text-slate-400">{s.item_code}</div>
                    </div>
                    <span className={cn(
                      'ml-2 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                      negative ? 'bg-red-100 text-red-700'
                      : low     ? 'bg-amber-100 text-amber-700'
                                : 'bg-emerald-100 text-emerald-700'
                    )}>
                      {available} {s.unit}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

    </div>
  );
}
