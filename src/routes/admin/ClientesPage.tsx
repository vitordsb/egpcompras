import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { ClientContact } from '@/types/db';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import Pagination from '@/components/ui/Pagination';
import { useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import ActionMenu from '@/components/ui/ActionMenu';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

const PAGE_SIZE = 25;

interface FormState {
  id: string | null;
  name: string;
  trade_name: string;
  cnpj: string;
  phone: string;
  whatsapp_phone: string;
  email: string;
  address: string;
  notes: string;
  tags: string;
  opt_in_promo: boolean;
  opt_in_catalog: boolean;
}

const emptyForm: FormState = {
  id: null,
  name: '',
  trade_name: '',
  cnpj: '',
  phone: '',
  whatsapp_phone: '',
  email: '',
  address: '',
  notes: '',
  tags: '',
  opt_in_promo: false,
  opt_in_catalog: false,
};

function formatBRL(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

import { formatDateBR, daysSince as daysSinceBR } from '@/lib/dates';
const formatDate = formatDateBR;

function formatPhone(s: string | null): string {
  if (!s) return '—';
  const digits = s.replace(/\D/g, '');
  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return s;
}

const daysSince = daysSinceBR;

export default function ClientesPage() {
  const toast = useToast();
  const [clients, setClients] = useState<ClientContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive' | 'no_whatsapp' | 'opt_in'>('all');
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useBodyScrollLock(!!form || !!confirm);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('client_contacts')
      .select('*')
      .order('last_purchase_at', { ascending: false, nullsFirst: false });
    if (error) toast.error('Erro', error.message);
    else setClients((data ?? []) as ClientContact[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (q) {
        const hay = `${c.name} ${c.trade_name ?? ''} ${c.cnpj ?? ''} ${c.whatsapp_phone ?? ''} ${c.email ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const days = daysSince(c.last_purchase_at);
      switch (filter) {
        case 'active':       return days != null && days <= 60;
        case 'inactive':     return days != null && days > 60;
        case 'no_whatsapp':  return !c.whatsapp_phone;
        case 'opt_in':       return c.opt_in_promo || c.opt_in_catalog;
        default:             return true;
      }
    });
  }, [clients, search, filter]);

  const stats = useMemo(() => ({
    total: clients.length,
    com_whatsapp: clients.filter((c) => c.whatsapp_phone).length,
    ativos: clients.filter((c) => {
      const d = daysSince(c.last_purchase_at);
      return d != null && d <= 60;
    }).length,
    inativos: clients.filter((c) => {
      const d = daysSince(c.last_purchase_at);
      return d != null && d > 60;
    }).length,
    opt_in: clients.filter((c) => c.opt_in_promo || c.opt_in_catalog).length,
  }), [clients]);

  function openCreate() { setForm(emptyForm); }
  function openEdit(c: ClientContact) {
    setForm({
      id: c.id,
      name: c.name,
      trade_name: c.trade_name ?? '',
      cnpj: c.cnpj ?? '',
      phone: c.phone ?? '',
      whatsapp_phone: c.whatsapp_phone ?? '',
      email: c.email ?? '',
      address: c.address ?? '',
      notes: c.notes ?? '',
      tags: (c.tags ?? []).join(', '),
      opt_in_promo: c.opt_in_promo,
      opt_in_catalog: c.opt_in_catalog,
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.name.trim()) return toast.error('Erro', 'Nome é obrigatório');
    setSaving(true);
    try {
      const wppDigits = form.whatsapp_phone.replace(/\D/g, '');
      const wpp = wppDigits ? (wppDigits.startsWith('55') ? wppDigits : `55${wppDigits}`) : null;
      const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
      const optInChanged = !!form.id && (
        clients.find((c) => c.id === form.id)?.opt_in_promo !== form.opt_in_promo ||
        clients.find((c) => c.id === form.id)?.opt_in_catalog !== form.opt_in_catalog
      );
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        trade_name: form.trade_name.trim() || null,
        cnpj: form.cnpj.trim() || null,
        phone: form.phone.trim() || null,
        whatsapp_phone: wpp,
        email: form.email.trim().toLowerCase() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
        tags,
        opt_in_promo: form.opt_in_promo,
        opt_in_catalog: form.opt_in_catalog,
      };
      if (optInChanged && (form.opt_in_promo || form.opt_in_catalog)) {
        payload.opt_in_at = new Date().toISOString();
        payload.opt_out_at = null;
      } else if (optInChanged && !form.opt_in_promo && !form.opt_in_catalog) {
        payload.opt_out_at = new Date().toISOString();
      }
      const result = form.id
        ? await supabase.from('client_contacts').update(payload).eq('id', form.id)
        : await supabase.from('client_contacts').insert(payload);
      if (result.error) throw new Error(result.error.message);
      toast.success(form.id ? 'Atualizado' : 'Criado', form.name);
      setForm(null);
      await load();
    } catch (err) {
      toast.error('Erro', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: ClientContact) {
    setConfirm({
      message: `Remover ${c.trade_name ?? c.name}? Histórico de pedidos será mantido.`,
      onConfirm: async () => {
        setConfirm(null);
        const { error } = await supabase.from('client_contacts').delete().eq('id', c.id);
        if (error) toast.error('Erro', error.message);
        else {
          toast.success('Removido', c.name);
          await load();
        }
      },
    });
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Clientes</h1>
          <p className="text-sm text-slate-500">Cadastro unificado para CRM e campanhas de marketing.</p>
        </div>
        <Button onClick={openCreate}>+ Novo cliente</Button>
      </div>

      {/* Cards de métricas */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Total" value={stats.total} />
        <Stat label="Com WhatsApp" value={stats.com_whatsapp} accent="text-green-700" />
        <Stat label="Ativos (≤60d)" value={stats.ativos} accent="text-blue-700" />
        <Stat label="Inativos (>60d)" value={stats.inativos} accent="text-amber-700" />
        <Stat label="Opt-in Marketing" value={stats.opt_in} accent="text-purple-700" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, CNPJ, WhatsApp, email…"
          className="max-w-sm"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
        >
          <option value="all">Todos ({clients.length})</option>
          <option value="active">Ativos ≤60d ({stats.ativos})</option>
          <option value="inactive">Inativos &gt;60d ({stats.inativos})</option>
          <option value="no_whatsapp">Sem WhatsApp ({clients.length - stats.com_whatsapp})</option>
          <option value="opt_in">Opt-in marketing ({stats.opt_in})</option>
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : filtered.length === 0 ? (
        <Card><CardBody><p className="text-sm text-slate-600">Nenhum cliente encontrado.</p></CardBody></Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Cliente</th>
                <th className="px-5 py-3">CNPJ</th>
                <th className="px-5 py-3">WhatsApp</th>
                <th className="px-5 py-3 text-right">Pedidos</th>
                <th className="px-5 py-3 text-right">Total</th>
                <th className="px-5 py-3">Última compra</th>
                <th className="px-5 py-3">Marketing</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((c) => {
                const days = daysSince(c.last_purchase_at);
                const isInactive = days != null && days > 60;
                return (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-900">{c.trade_name ?? c.name}</div>
                      {c.trade_name && <div className="text-xs text-slate-400">{c.name}</div>}
                      {c.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.tags.map((t) => (
                            <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{t}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{c.cnpj ?? '—'}</td>
                    <td className="px-5 py-3 text-xs">
                      {c.whatsapp_phone ? (
                        <span className="inline-flex items-center gap-1 text-green-700">
                          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.126 1.532 5.859L.057 23.25l5.532-1.45A11.953 11.953 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>
                          {formatPhone(c.whatsapp_phone)}
                        </span>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-700">{c.total_orders}</td>
                    <td className="px-5 py-3 text-right text-slate-700">{formatBRL(c.total_spent)}</td>
                    <td className="px-5 py-3 text-xs">
                      {c.last_purchase_at ? (
                        <div>
                          <div className="text-slate-700">{formatDate(c.last_purchase_at)}</div>
                          <div className={isInactive ? 'text-amber-600' : 'text-slate-400'}>
                            {days === 0 ? 'hoje' : `há ${days}d`}
                          </div>
                        </div>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-xs">
                      <div className="flex flex-col gap-0.5">
                        {c.opt_in_promo && <span className="text-purple-600">✓ Promo</span>}
                        {c.opt_in_catalog && <span className="text-blue-600">✓ Catálogo</span>}
                        {!c.opt_in_promo && !c.opt_in_catalog && <span className="text-slate-400">—</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <ActionMenu items={[
                        { label: 'Editar', onClick: () => openEdit(c) },
                        { label: 'Remover', variant: 'danger', separator: true, onClick: () => remove(c) },
                      ]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination total={filtered.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} className="px-5" />
        </Card>
      )}

      {confirm && (
        <ConfirmModal
          title="Confirmar"
          description={confirm.message}
          confirmLabel="Remover"
          variant="danger"
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {form && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setForm(null)}>
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-lg bg-white shadow-lg" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={submit}>
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">{form.id ? 'Editar cliente' : 'Novo cliente'}</h2>
              </div>
              <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="c-name">Razão social *</Label>
                  <Input id="c-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
                </div>
                <div>
                  <Label htmlFor="c-trade">Nome fantasia</Label>
                  <Input id="c-trade" value={form.trade_name} onChange={(e) => setForm({ ...form, trade_name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="c-cnpj">CNPJ</Label>
                  <Input id="c-cnpj" value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
                </div>
                <div>
                  <Label htmlFor="c-wpp">WhatsApp</Label>
                  <Input id="c-wpp" value={form.whatsapp_phone} onChange={(e) => setForm({ ...form, whatsapp_phone: e.target.value })} placeholder="(11) 98765-4321" />
                </div>
                <div>
                  <Label htmlFor="c-phone">Telefone fixo</Label>
                  <Input id="c-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="c-email">Email</Label>
                  <Input id="c-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="c-addr">Endereço</Label>
                  <Input id="c-addr" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="c-tags">Tags (separadas por vírgula)</Label>
                  <Input id="c-tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="vip, varejo, ..." />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="c-notes">Observações internas</Label>
                  <textarea
                    id="c-notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    rows={2}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2 rounded-lg border border-purple-100 bg-purple-50 p-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">Permissões de marketing (LGPD)</p>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.opt_in_promo} onChange={(e) => setForm({ ...form, opt_in_promo: e.target.checked })} className="h-4 w-4 accent-purple-600" />
                    <span>Aceita receber promoções</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.opt_in_catalog} onChange={(e) => setForm({ ...form, opt_in_catalog: e.target.checked })} className="h-4 w-4 accent-purple-600" />
                    <span>Aceita receber catálogo</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
                <Button type="button" variant="secondary" onClick={() => setForm(null)}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Salvando…' : form.id ? 'Salvar' : 'Criar'}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ?? 'text-slate-900'}`}>{value}</div>
    </div>
  );
}
