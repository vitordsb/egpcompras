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

export default function FaltaComprarPage() {
  const [needs, setNeeds] = useState<PurchaseNeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<NeedStatus | 'all'>('pendente');
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [addingNote, setAddingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    let q = supabase
      .from('purchase_needs')
      .select(`id, item_name, item_code, quantity, unit, status, updated_at,
               shipment:shipments(id, client_name, numero_venda, numero_nfe),
               notes:purchase_need_notes(id, content, author, created_at)`)
      .order('updated_at', { ascending: false })
      .limit(200);
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    const { data } = await q;
    setNeeds((data ?? []) as unknown as PurchaseNeed[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [statusFilter]);

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

  // Agrupa por pedido
  const grouped = needs.reduce<Record<string, { shipment: PurchaseNeed['shipment']; items: PurchaseNeed[] }>>((acc, n) => {
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

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Falta Comprar</h1>
          <p className="text-sm text-slate-500">
            Itens faltantes para dar saída nos pedidos. Acompanhe o status e adicione anotações.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid gap-3 grid-cols-2 sm:grid-cols-4">
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
              'rounded-lg border p-3 text-left transition-colors',
              statusFilter === s.key
                ? 'border-brand-300 bg-brand-50'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            )}
          >
            <div className="text-xs uppercase tracking-wide text-slate-500">{s.label}</div>
            <div className={cn('mt-1 text-2xl font-semibold', s.color)}>{s.value}</div>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : Object.keys(grouped).length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">
              {statusFilter === 'chegou' ? 'Nenhum item chegou ainda.' : 'Nenhum item pendente. '}
              {statusFilter === 'pendente' && 'Tudo certo por enquanto, ou use o chat EGP para registrar itens faltantes.'}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([key, group]) => (
            <Card key={key}>
              {/* Cabeçalho do pedido */}
              <div className="border-b border-slate-100 px-5 py-3">
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
                  <span className="ml-auto text-xs font-normal text-slate-400">{group.items.length} item{group.items.length !== 1 ? 's' : ''}</span>
                </div>
              </div>

              {/* Itens */}
              <div className="divide-y divide-slate-100">
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
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
