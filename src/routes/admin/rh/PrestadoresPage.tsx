import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface Prestador {
  id: string;
  nome: string;
  valor_prestacao: number | null;
  cnd: number | null;
  cob: number | null;
  conducao: number | null;
  carro: number | null;
  almoco_horario: string | null;
  status: 'PRESTADOR' | 'FINALIZADO';
  aniversario: string | null;
  cpf: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  pix: string | null;
  observacoes: string | null;
}

function fmt(v: number | null) {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

export default function PrestadoresPage() {
  const [prestadores, setPrestadores] = useState<Prestador[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFinalizados, setShowFinalizados] = useState(false);
  const [selected, setSelected] = useState<Prestador | null>(null);

  useEffect(() => {
    supabase
      .from('prestadores')
      .select('*')
      .order('nome')
      .then(({ data }) => {
        setPrestadores((data ?? []) as Prestador[]);
        setLoading(false);
      });
  }, []);

  const filtered = prestadores.filter((p) =>
    showFinalizados ? true : p.status === 'PRESTADOR'
  );

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Prestadores</h1>
          <p className="text-sm text-slate-500">
            {prestadores.filter((p) => p.status === 'PRESTADOR').length} ativos ·{' '}
            {prestadores.filter((p) => p.status === 'FINALIZADO').length} finalizados
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showFinalizados}
            onChange={(e) => setShowFinalizados(e.target.checked)}
            className="rounded border-slate-300"
          />
          Mostrar finalizados
        </label>
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm">Carregando...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Nome</th>
                <th className="px-4 py-3 text-right">Prestação</th>
                <th className="px-4 py-3 text-right">CND</th>
                <th className="px-4 py-3 text-right">COB</th>
                <th className="px-4 py-3 text-right">Condução</th>
                <th className="px-4 py-3 text-right">Carro</th>
                <th className="px-4 py-3 text-left">Almoço</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setSelected(p)}
                  className={cn(
                    'cursor-pointer transition-colors hover:bg-slate-50',
                    p.status === 'FINALIZADO' && 'opacity-50'
                  )}
                >
                  <td className="px-4 py-3 font-medium text-slate-900">{p.nome}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{fmt(p.valor_prestacao)}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{fmt(p.cnd)}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{fmt(p.cob)}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{fmt(p.conducao)}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{fmt(p.carro)}</td>
                  <td className="px-4 py-3 text-slate-500">{p.almoco_horario ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                      p.status === 'PRESTADOR'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-500'
                    )}>
                      {p.status === 'PRESTADOR' ? 'Ativo' : 'Finalizado'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Painel de detalhes */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 md:items-center"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl bg-white p-6 shadow-xl md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{selected.nome}</h2>
                <span className={cn(
                  'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                  selected.status === 'PRESTADOR'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-500'
                )}>
                  {selected.status === 'PRESTADOR' ? 'Ativo' : 'Finalizado'}
                </span>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none"
              >×</button>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div><span className="text-slate-500">Prestação</span><p className="font-medium">{fmt(selected.valor_prestacao)}</p></div>
              <div><span className="text-slate-500">CND</span><p className="font-medium">{fmt(selected.cnd)}</p></div>
              <div><span className="text-slate-500">COB</span><p className="font-medium">{fmt(selected.cob)}</p></div>
              <div><span className="text-slate-500">Condução</span><p className="font-medium">{fmt(selected.conducao)}</p></div>
              <div><span className="text-slate-500">Carro</span><p className="font-medium">{fmt(selected.carro)}</p></div>
              <div><span className="text-slate-500">Almoço</span><p className="font-medium">{selected.almoco_horario ?? '—'}</p></div>
              <div><span className="text-slate-500">Aniversário</span><p className="font-medium">{fmtDate(selected.aniversario)}</p></div>
              <div><span className="text-slate-500">CPF</span><p className="font-medium font-mono text-xs">{selected.cpf ?? '—'}</p></div>
              <div><span className="text-slate-500">Banco</span><p className="font-medium">{selected.banco ?? '—'}</p></div>
              <div><span className="text-slate-500">Agência / Conta</span><p className="font-medium">{selected.agencia && selected.conta ? `${selected.agencia} / ${selected.conta}` : '—'}</p></div>
              <div className="col-span-2"><span className="text-slate-500">PIX / Contato</span><p className="font-medium text-xs break-all">{selected.pix ?? '—'}</p></div>
              {selected.observacoes && (
                <div className="col-span-2"><span className="text-slate-500">Obs</span><p className="text-xs text-slate-600">{selected.observacoes}</p></div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
