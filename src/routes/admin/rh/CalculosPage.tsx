import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface Prestador {
  id: string;
  nome: string;
  valor_prestacao: number | null;
  conducao: number | null;
  carro: number | null;
}

interface CalcInputs {
  salario: string;
  dias_mes: string;
  dias_uteis: string;
  dias_trabalhados: string;
  transporte_diario: string;
  trabalho_feriado_sabado: string;
  hora_extra: string;
  trabalho_em_casa: string;
  desconto_preju: string;
  adiantamento: string;
  cesta_basica: string;
  desconto_transporte: string;
}

const MESES = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
];

function n(v: string) { return parseFloat(v.replace(',', '.')) || 0; }
function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function calcular(i: CalcInputs) {
  const salario          = n(i.salario);
  const dias_mes         = n(i.dias_mes);
  const dias_uteis       = n(i.dias_uteis);
  const dias_trabalhados = n(i.dias_trabalhados);
  const transp           = n(i.transporte_diario);

  const valor_dia        = dias_mes > 0 ? salario / dias_mes : 0;
  const valor_hora       = valor_dia / 9;
  const transporte_total = dias_uteis * transp;
  const valor_trabalhado = valor_dia * dias_trabalhados;

  const acrescimos =
    n(i.trabalho_feriado_sabado) +
    n(i.hora_extra) +
    n(i.trabalho_em_casa);

  const descontos =
    n(i.desconto_preju) +
    n(i.cesta_basica) +
    n(i.desconto_transporte);

  const adiantamento = n(i.adiantamento);

  const a_emitir  = valor_trabalhado + transporte_total + acrescimos - descontos;
  const a_receber = a_emitir - adiantamento;

  return { valor_dia, valor_hora, transporte_total, valor_trabalhado, a_emitir, a_receber };
}

function Field({
  label, value, onChange, hint,
}: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-44 shrink-0 text-right text-sm text-slate-600">{label}</label>
      <div className="flex-1 max-w-[140px]">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-right text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300"
        />
      </div>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </div>
  );
}

function ResultRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between px-4 py-2 rounded-md', highlight ? 'bg-brand-50' : 'bg-slate-50')}>
      <span className={cn('text-sm', highlight ? 'font-semibold text-brand-800' : 'text-slate-600')}>{label}</span>
      <span className={cn('font-mono text-sm', highlight ? 'font-bold text-brand-700 text-base' : 'text-slate-700')}>{value}</span>
    </div>
  );
}

function defaultInputs(p: Prestador | null, mesAtual: number, anoAtual: number): CalcInputs {
  // Pré-calcula dias do mês de referência (mês anterior ao atual)
  const refMes = mesAtual === 1 ? 12 : mesAtual - 1;
  const refAno = mesAtual === 1 ? anoAtual - 1 : anoAtual;
  const diasNoMes = new Date(refAno, refMes, 0).getDate();
  const transp = p?.conducao ?? p?.carro ?? 0;
  return {
    salario:               p?.valor_prestacao?.toString() ?? '',
    dias_mes:              diasNoMes.toString(),
    dias_uteis:            '',
    dias_trabalhados:      diasNoMes.toString(),
    transporte_diario:     transp.toString(),
    trabalho_feriado_sabado: '0',
    hora_extra:            '0',
    trabalho_em_casa:      '0',
    desconto_preju:        '0',
    adiantamento:          '0',
    cesta_basica:          '0',
    desconto_transporte:   '0',
  };
}

export default function CalculosPage() {
  const now = new Date();
  const [prestadores, setPrestadores] = useState<Prestador[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  // Competência = mês referente (anterior ao pagamento)
  const [compMes, setCompMes] = useState(now.getMonth() === 0 ? 12 : now.getMonth()); // 1-based
  const [compAno, setCompAno] = useState(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
  const [inputs, setInputs] = useState<CalcInputs>(defaultInputs(null, now.getMonth() + 1, now.getFullYear()));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    supabase.from('prestadores')
      .select('id, nome, valor_prestacao, conducao, carro')
      .eq('status', 'PRESTADOR').order('nome')
      .then(({ data }) => setPrestadores((data ?? []) as Prestador[]));
  }, []);

  function handleSelectPrestador(id: string) {
    setSelectedId(id);
    const p = prestadores.find((p) => p.id === id) ?? null;
    setInputs(defaultInputs(p, now.getMonth() + 1, now.getFullYear()));
    setSaved(false);
  }

  function setField(key: keyof CalcInputs) {
    return (v: string) => {
      setInputs((prev) => ({ ...prev, [key]: v }));
      setSaved(false);
    };
  }

  const result = useMemo(() => calcular(inputs), [inputs]);

  // Mês de pagamento = mês seguinte à competência
  const pagMes = compMes === 12 ? 1 : compMes + 1;
  const pagAno = compMes === 12 ? compAno + 1 : compAno;

  async function handleSave() {
    if (!selectedId) return;
    setSaving(true);
    const payload = {
      prestador_id: selectedId,
      competencia_mes: compMes,
      competencia_ano: compAno,
      mes_pagamento_mes: pagMes,
      mes_pagamento_ano: pagAno,
      salario: n(inputs.salario),
      dias_mes: n(inputs.dias_mes),
      dias_uteis: n(inputs.dias_uteis),
      dias_trabalhados: n(inputs.dias_trabalhados),
      transporte_diario: n(inputs.transporte_diario),
      trabalho_feriado_sabado: n(inputs.trabalho_feriado_sabado),
      hora_extra: n(inputs.hora_extra),
      trabalho_em_casa: n(inputs.trabalho_em_casa),
      desconto_preju: n(inputs.desconto_preju),
      adiantamento: n(inputs.adiantamento),
      cesta_basica: n(inputs.cesta_basica),
      desconto_transporte: n(inputs.desconto_transporte),
      valor_dia: result.valor_dia,
      valor_hora: result.valor_hora,
      transporte_total: result.transporte_total,
      valor_trabalhado: result.valor_trabalhado,
      a_emitir: result.a_emitir,
      a_receber: result.a_receber,
    };
    await supabase.from('pagamentos_prestadores')
      .upsert(payload, { onConflict: 'prestador_id,competencia_mes,competencia_ano' });
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Cálculos</h1>
        <p className="text-sm text-slate-500">Pagamento mensal dos prestadores</p>
      </div>

      {/* Seleção: prestador + competência */}
      <div className="mb-6 flex flex-wrap gap-3">
        <select
          value={selectedId}
          onChange={(e) => handleSelectPrestador(e.target.value)}
          className="flex-1 min-w-[200px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
        >
          <option value="">Selecione o prestador…</option>
          {prestadores.map((p) => (
            <option key={p.id} value={p.id}>{p.nome}</option>
          ))}
        </select>

        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span>Referente a</span>
          <select
            value={compMes}
            onChange={(e) => { setCompMes(Number(e.target.value)); setSaved(false); }}
            className="rounded-md border border-slate-200 bg-white px-2 py-2 text-sm focus:outline-none"
          >
            {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input
            type="number"
            value={compAno}
            onChange={(e) => { setCompAno(Number(e.target.value)); setSaved(false); }}
            className="w-20 rounded-md border border-slate-200 bg-white px-2 py-2 text-sm focus:outline-none"
          />
        </div>
      </div>

      {selectedId && (
        <div className="space-y-6">
          {/* Label de contexto */}
          <div className="rounded-md bg-slate-50 border border-slate-200 px-4 py-2 text-sm text-slate-600">
            Pagamento de <strong>{MESES[pagMes - 1]}/{pagAno}</strong> referente a <strong>{MESES[compMes - 1]}/{compAno}</strong>
          </div>

          {/* Informações base */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Base</p>
            <div className="space-y-2">
              <Field label="Salário" value={inputs.salario} onChange={setField('salario')} />
              <Field label="Dias do mês" value={inputs.dias_mes} onChange={setField('dias_mes')} hint="total" />
              <Field label="Dias úteis" value={inputs.dias_uteis} onChange={setField('dias_uteis')} hint="para transporte" />
              <Field label="Dias trabalhados" value={inputs.dias_trabalhados} onChange={setField('dias_trabalhados')} />
              <Field label="Transporte/dia" value={inputs.transporte_diario} onChange={setField('transporte_diario')} />
            </div>
          </div>

          {/* Acréscimos */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Acréscimos</p>
            <div className="space-y-2">
              <Field label="Feriado / Sábado" value={inputs.trabalho_feriado_sabado} onChange={setField('trabalho_feriado_sabado')} />
              <Field label="Hora extra" value={inputs.hora_extra} onChange={setField('hora_extra')} />
              <Field label="Trabalho em casa" value={inputs.trabalho_em_casa} onChange={setField('trabalho_em_casa')} />
            </div>
          </div>

          {/* Descontos */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Descontos</p>
            <div className="space-y-2">
              <Field label="Desconto Preju" value={inputs.desconto_preju} onChange={setField('desconto_preju')} />
              <Field label="Adiantamento" value={inputs.adiantamento} onChange={setField('adiantamento')} />
              <Field label="Cesta básica" value={inputs.cesta_basica} onChange={setField('cesta_basica')} />
              <Field label="Desc. transporte" value={inputs.desconto_transporte} onChange={setField('desconto_transporte')} />
            </div>
          </div>

          {/* Resultados */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Valores calculados</p>
            <div className="space-y-1.5">
              <ResultRow label="Valor/Dia" value={fmt(result.valor_dia)} />
              <ResultRow label="Valor/Hora" value={`${fmt(result.valor_hora)}/h`} />
              <ResultRow label="Transporte total" value={fmt(result.transporte_total)} />
              <ResultRow label="Valor trabalhado" value={fmt(result.valor_trabalhado)} />
              <div className="my-2 border-t border-slate-200" />
              <ResultRow label="A EMITIR" value={fmt(result.a_emitir)} highlight />
              <ResultRow label="A RECEBER" value={fmt(result.a_receber)} highlight />
            </div>
          </div>

          {/* Salvar */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? 'Salvando…' : 'Salvar no histórico'}
            </button>
            {saved && (
              <span className="text-sm text-emerald-600">✓ Salvo</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
