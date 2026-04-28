import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardBody } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { STATUS_LABEL, STATUS_PILL, formatDateTime } from './shared';
import type { ShipmentStatus } from '@/types/db';

interface ObservationRow {
  id: string;
  content: string;
  created_at: string;
  shipment: {
    id: string;
    client_name: string;
    numero_nfe: string | null;
    numero_venda: string | null;
    status: ShipmentStatus;
  } | null;
}

export default function ObservacoesPage() {
  const [list, setList] = useState<ObservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('shipment_observations')
      .select('id, content, created_at, shipment:shipments(id, client_name, numero_nfe, numero_venda, status)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) setError(error.message);
    else setList((data ?? []) as unknown as ObservationRow[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = search.trim()
    ? list.filter((o) => {
        const q = search.toLowerCase();
        const hay = `${o.content} ${o.shipment?.client_name ?? ''} ${o.shipment?.numero_nfe ?? ''} ${o.shipment?.numero_venda ?? ''}`.toLowerCase();
        return hay.includes(q);
      })
    : list;

  async function deleteObservation(id: string) {
    if (!confirm('Apagar essa observação?')) return;
    const { error } = await supabase.from('shipment_observations').delete().eq('id', id);
    if (error) {
      alert(`Erro: ${error.message}`);
      return;
    }
    setList((prev) => prev.filter((o) => o.id !== id));
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Observações</h1>
          <p className="text-sm text-slate-500">
            Anotações livres de todos os pedidos — faltas, devoluções, problemas em rota.
            Pra adicionar uma observação, abra o pedido em <strong>Pedidos</strong>.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          atualizar
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 max-w-md">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por conteúdo, cliente, venda ou NFe…"
        />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-600">
              {list.length === 0
                ? 'Nenhuma observação registrada ainda. Pra adicionar, abre o pedido na aba Pedidos.'
                : 'Nenhuma observação bate com a busca.'}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => (
            <Card key={o.id}>
              <CardBody className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800 whitespace-pre-wrap">{o.content}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteObservation(o.id)}
                    className="text-red-600 hover:bg-red-50"
                  >
                    apagar
                  </Button>
                </div>
                {o.shipment && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{o.shipment.client_name}</span>
                    {o.shipment.numero_venda && (
                      <>
                        <span>·</span>
                        <span>Venda #{o.shipment.numero_venda}</span>
                      </>
                    )}
                    {o.shipment.numero_nfe && (
                      <>
                        <span>·</span>
                        <span>NFe {o.shipment.numero_nfe}</span>
                      </>
                    )}
                    <span>·</span>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
                        STATUS_PILL[o.shipment.status]
                      )}
                    >
                      {STATUS_LABEL[o.shipment.status]}
                    </span>
                    <span className="ml-auto text-[11px] text-slate-400">
                      {formatDateTime(o.created_at)}
                    </span>
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
