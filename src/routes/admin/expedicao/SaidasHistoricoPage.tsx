import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Shipment, ShipmentStatus } from '@/types/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { STATUS_LABEL, STATUS_PILL, formatDate } from './shared';

const TERMINAL_STATUSES: ShipmentStatus[] = ['shipped', 'returned', 'cancelled'];

export default function SaidasHistoricoPage() {
  const [list, setList] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('shipments')
      .select('*')
      .in('status', TERMINAL_STATUSES)
      .order('updated_at', { ascending: false })
      .limit(300);
    if (error) setError(error.message);
    else setList((data ?? []) as Shipment[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return list.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!`${s.client_name} ${s.numero_nfe ?? ''} ${s.numero_venda ?? ''}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [list, statusFilter, search]);

  const stats = useMemo(() => {
    const acc = { shipped: 0, returned: 0, cancelled: 0 };
    for (const s of list) acc[s.status as 'shipped' | 'returned' | 'cancelled']++;
    return acc;
  }, [list]);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Histórico de saídas</h1>
        <p className="text-sm text-slate-500">
          Pedidos que já saíram, voltaram ou foram cancelados. Pedidos ativos em <strong>Pedidos</strong>.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            { key: 'all', label: 'Total', value: list.length, color: 'text-slate-900' },
            { key: 'shipped', label: 'Saíram', value: stats.shipped, color: 'text-emerald-700' },
            { key: 'returned', label: 'Voltaram', value: stats.returned, color: 'text-sky-700' },
            { key: 'cancelled', label: 'Cancelados', value: stats.cancelled, color: 'text-slate-600' },
          ] as const
        ).map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setStatusFilter(s.key as ShipmentStatus | 'all')}
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

      <div className="mb-4 max-w-md">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por cliente, venda ou NFe…"
        />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-600">
              {list.length === 0
                ? 'Nenhuma saída registrada ainda.'
                : 'Nenhum resultado pra esse filtro.'}
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Venda / NFe</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Saiu em</th>
                  <th className="px-5 py-3">Voltou em</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3">Atualizado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 font-medium text-slate-900">{s.client_name}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {s.numero_venda ? <span className="font-medium">#{s.numero_venda}</span> : null}
                      {s.numero_venda && s.numero_nfe ? <span className="text-slate-300"> · </span> : null}
                      {s.numero_nfe ? <span className="text-xs">NFe {s.numero_nfe}</span> : null}
                      {!s.numero_venda && !s.numero_nfe ? '—' : null}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          STATUS_PILL[s.status]
                        )}
                      >
                        {STATUS_LABEL[s.status]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(s.data_saida)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(s.data_retorno)}</td>
                    <td className="px-5 py-3 text-right text-slate-600">
                      {s.valor_total != null
                        ? `R$ ${Number(s.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                        : '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-500">{formatDate(s.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
