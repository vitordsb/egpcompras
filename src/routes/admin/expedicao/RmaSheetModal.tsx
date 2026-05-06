// Modal "estilo planilha" pra edição de RMA — espelha o layout que a equipe
// técnica já usa no Excel. Tem cabeçalho (cliente + técnico + datas + OS),
// tabela editável de itens (1 linha = 1 controle com componentes/defeito/valor),
// e rodapé com subtotal/desconto/total.
//
// Auto-save com debounce a cada mudança (sem botão "Salvar"). Importação
// de imagem/PDF da planilha via Gemini (drag-and-drop ou clique).

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';
import { useInternalAuth } from '@/lib/auth-context';
import {
  STATUS_LABEL, MOTIVO_LABEL, SOLUCAO_LABEL,
  type RmaRow, type RmaStatus, type RmaMotivo, type RmaSolucao,
} from './rmas-shared';
import { extractRmaFromFile, type ExtractedRma } from './rma-importer';
import { generateRmaPdf } from './rma-pdf';

interface RmaSheetModalProps {
  rma: RmaRow;
  onClose: () => void;
  onChanged: () => void; // chamado após salvar pra parent recarregar
}

interface ItemDraft {
  id: string | null;            // null = nova linha (insert no save)
  posicao: number;
  product_id: string | null;
  item_name: string;
  componentes_trocados: string;
  observacao_status: string;
  data_fabricacao: string;
  tem_garantia: boolean;
  valor_total: number | null;
  serial_number: string;
  // Marca pra delete (não remove visualmente até save)
  _toDelete?: boolean;
}

const OBSERVACAO_PRESETS = ['Desgaste do Componente', 'Testada', 'Erro de Ligação', 'Sem Defeito', 'Outro'];

export default function RmaSheetModal({ rma, onClose, onChanged }: RmaSheetModalProps) {
  const toast = useToast();
  const { userLabel } = useInternalAuth();

  // ── Estado do header ──
  const [header, setHeader] = useState({
    client_name: rma.client_name,
    client_trade_name: rma.client_trade_name ?? '',
    client_cnpj: rma.client_cnpj ?? '',
    client_phone: rma.client_phone ?? '',
    client_email: rma.client_email ?? '',
    motivo: rma.motivo,
    status: rma.status,
    solucao: rma.solucao,
    data_recebido: rma.data_recebido?.slice(0, 10) ?? '',
    data_devolvido: rma.data_devolvido?.slice(0, 10) ?? '',
    setor: rma.setor ?? 'Manutenção',
    tecnico_nome: rma.tecnico_nome ?? '',
    tecnico_phone: rma.tecnico_phone ?? '',
    volume: rma.volume ?? 1,
    numero_os: rma.numero_os ?? '',
    desconto: rma.desconto ?? 0,
    prazo_entrega: rma.prazo_entrega?.slice(0, 10) ?? '',
    condicao_pagamento: rma.condicao_pagamento ?? '',
    diagnostico: rma.diagnostico ?? '',
    notes: rma.notes ?? '',
    numero_venda_origem: rma.numero_venda_origem ?? '',
  });

  const [items, setItems] = useState<ItemDraft[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [observations, setObservations] = useState<any[]>([]);
  const [newObs, setNewObs] = useState('');
  const [savingObs, setSavingObs] = useState(false);

  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<'itens' | 'cabecalho'>('itens');

  // Carrega itens e observações
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingItems(true);
      const [it, obs] = await Promise.all([
        supabase
          .from('rma_items')
          .select('*')
          .eq('rma_id', rma.id)
          .order('posicao', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),
        supabase
          .from('rma_observations')
          .select('*')
          .eq('rma_id', rma.id)
          .order('created_at', { ascending: false }),
      ]);
      if (cancelled) return;
      const drafts: ItemDraft[] = ((it.data ?? []) as any[]).map((r, idx) => ({
        id: r.id,
        posicao: r.posicao ?? idx + 1,
        product_id: r.product_id,
        item_name: r.item_name ?? '',
        componentes_trocados: r.componentes_trocados ?? '',
        observacao_status: r.observacao_status ?? '',
        data_fabricacao: r.data_fabricacao?.slice(0, 10) ?? '',
        tem_garantia: Boolean(r.tem_garantia),
        valor_total: r.valor_total != null ? Number(r.valor_total) : null,
        serial_number: r.serial_number ?? '',
      }));
      setItems(drafts);
      setObservations(obs.data ?? []);
      setLoadingItems(false);
    })();
    return () => { cancelled = true; };
  }, [rma.id]);

  // ── Auto-save com debounce ──
  function scheduleSave() {
    setSavingState('saving');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persistAll();
    }, 800);
  }

  async function persistAll() {
    try {
      // 1) Header (rmas)
      const headerPayload: any = {
        client_name: header.client_name.trim(),
        client_trade_name: header.client_trade_name.trim() || null,
        client_cnpj: header.client_cnpj.trim() || null,
        client_phone: header.client_phone.trim() || null,
        client_email: header.client_email.trim() || null,
        motivo: header.motivo,
        status: header.status,
        solucao: header.solucao,
        data_recebido: header.data_recebido || null,
        data_devolvido: header.data_devolvido || null,
        setor: header.setor.trim() || null,
        tecnico_nome: header.tecnico_nome.trim() || null,
        tecnico_phone: header.tecnico_phone.trim() || null,
        volume: header.volume || null,
        numero_os: header.numero_os.trim() || null,
        desconto: header.desconto || 0,
        prazo_entrega: header.prazo_entrega || null,
        condicao_pagamento: header.condicao_pagamento.trim() || null,
        diagnostico: header.diagnostico.trim() || null,
        notes: header.notes.trim() || null,
        numero_venda_origem: header.numero_venda_origem.trim() || null,
        updated_at: new Date().toISOString(),
      };
      const { error: hErr } = await supabase.from('rmas').update(headerPayload).eq('id', rma.id);
      if (hErr) throw hErr;

      // 2) Items — sync incremental
      // Apaga marcados pra delete
      const toDelete = items.filter((i) => i._toDelete && i.id);
      for (const i of toDelete) {
        await supabase.from('rma_items').delete().eq('id', i.id!);
      }
      // Update existentes + insert novos
      for (const i of items) {
        if (i._toDelete) continue;
        const payload: any = {
          rma_id: rma.id,
          posicao: i.posicao || null,
          item_name: i.item_name.trim() || null,
          componentes_trocados: i.componentes_trocados.trim() || null,
          observacao_status: i.observacao_status.trim() || null,
          data_fabricacao: i.data_fabricacao || null,
          tem_garantia: i.tem_garantia,
          valor_total: i.valor_total != null ? Number(i.valor_total) : null,
          serial_number: i.serial_number.trim() || null,
          quantity: 1,
        };
        if (i.id) {
          await supabase.from('rma_items').update(payload).eq('id', i.id);
        } else {
          const { data: created } = await supabase.from('rma_items').insert(payload).select('id').single();
          if (created) i.id = (created as any).id;
        }
      }

      // Remove os marcados da lista visualmente
      setItems((prev) => prev.filter((i) => !i._toDelete));
      setSavingState('saved');
      onChanged();
    } catch (err) {
      console.error('[rma save]', err);
      setSavingState('error');
      toast.error('Erro ao salvar', err instanceof Error ? err.message : String(err));
    }
  }

  // ── Mudanças no header e itens disparam save ──
  function patchHeader<K extends keyof typeof header>(key: K, value: typeof header[K]) {
    setHeader((prev) => ({ ...prev, [key]: value }));
    scheduleSave();
  }

  function patchItem(idx: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
    scheduleSave();
  }

  function addItem() {
    setItems((prev) => {
      const nextPos = (prev.filter((i) => !i._toDelete).reduce((m, i) => Math.max(m, i.posicao ?? 0), 0)) + 1;
      return [
        ...prev,
        {
          id: null, posicao: nextPos, product_id: null, item_name: header.numero_os ? `EGP ${header.numero_os}` : '',
          componentes_trocados: '', observacao_status: '', data_fabricacao: '',
          tem_garantia: false, valor_total: null, serial_number: '',
        },
      ];
    });
    scheduleSave();
  }

  function removeItem(idx: number) {
    setItems((prev) => {
      const it = prev[idx];
      if (!it.id) {
        // linha nova ainda não persistida
        return prev.filter((_, i) => i !== idx);
      }
      // marca pra delete (será removido no save)
      return prev.map((x, i) => (i === idx ? { ...x, _toDelete: true } : x));
    });
    scheduleSave();
  }

  // ── Importação por foto/PDF ──
  async function handleImportFile(file: File) {
    setImporting(true);
    try {
      const extracted = await extractRmaFromFile(file);
      applyExtracted(extracted);
      toast.success('Planilha importada', `Cabeçalho e ${extracted.items?.length ?? 0} itens preenchidos. Revise antes de fechar.`);
    } catch (err) {
      toast.error('Falha ao importar', err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  function applyExtracted(e: ExtractedRma) {
    setHeader((prev) => ({
      ...prev,
      client_name: e.client_name ?? prev.client_name,
      client_trade_name: e.client_trade_name ?? prev.client_trade_name,
      client_cnpj: e.client_cnpj ?? prev.client_cnpj,
      client_phone: e.client_phone ?? prev.client_phone,
      client_email: e.client_email ?? prev.client_email,
      tecnico_nome: e.tecnico_nome ?? prev.tecnico_nome,
      tecnico_phone: e.tecnico_phone ?? prev.tecnico_phone,
      setor: e.setor ?? prev.setor,
      volume: e.volume ?? prev.volume,
      numero_os: e.numero_os ?? prev.numero_os,
      data_recebido: e.data_recebido ?? prev.data_recebido,
      data_devolvido: e.data_devolvido ?? prev.data_devolvido,
      desconto: e.desconto ?? prev.desconto,
      prazo_entrega: e.prazo_entrega ?? prev.prazo_entrega,
      condicao_pagamento: e.condicao_pagamento ?? prev.condicao_pagamento,
    }));
    if (e.items && e.items.length > 0) {
      setItems((prev) => {
        const lastPos = prev.filter((i) => !i._toDelete).reduce((m, i) => Math.max(m, i.posicao ?? 0), 0);
        const newItems: ItemDraft[] = e.items!.map((it, idx) => ({
          id: null,
          posicao: lastPos + idx + 1,
          product_id: null,
          item_name: it.item_name ?? '',
          componentes_trocados: it.componentes_trocados ?? '',
          observacao_status: it.observacao_status ?? '',
          data_fabricacao: it.data_fabricacao ?? '',
          tem_garantia: Boolean(it.tem_garantia),
          valor_total: it.valor_total ?? null,
          serial_number: '',
        }));
        return [...prev, ...newItems];
      });
    }
    scheduleSave();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleImportFile(f);
  }

  // ── Geração de PDF pra cliente ──
  function handleDownloadPdf() {
    // Garante save antes de exportar (caso tenha edição pendente no debounce)
    if (savingState === 'saving') {
      toast.error('Aguarde', 'Termine o auto-save antes de exportar.');
      return;
    }
    try {
      generateRmaPdf(
        {
          ...rma,
          // sobrescreve com edits ainda não persistidos no parent
          client_name: header.client_name || rma.client_name,
          client_trade_name: header.client_trade_name || rma.client_trade_name,
          client_cnpj: header.client_cnpj || rma.client_cnpj,
          client_phone: header.client_phone || rma.client_phone,
          client_email: header.client_email || rma.client_email,
          motivo: header.motivo,
          numero_os: header.numero_os || rma.numero_os,
          tecnico_nome: header.tecnico_nome || rma.tecnico_nome,
          setor: header.setor || rma.setor,
          volume: header.volume,
          data_recebido: header.data_recebido || rma.data_recebido,
          data_devolvido: header.data_devolvido || rma.data_devolvido,
          desconto: header.desconto,
          diagnostico: header.diagnostico || rma.diagnostico,
        },
        visibleItems.map((i) => ({
          posicao: i.posicao,
          item_name: i.item_name,
          componentes_trocados: i.componentes_trocados,
          observacao_status: i.observacao_status,
          data_fabricacao: i.data_fabricacao,
          tem_garantia: i.tem_garantia,
          valor_total: i.valor_total,
        }))
      );
      toast.success('PDF gerado', 'Download iniciado.');
    } catch (err) {
      toast.error('Falha ao gerar PDF', err instanceof Error ? err.message : String(err));
    }
  }

  // ── Observações ──
  async function addObservation() {
    if (!newObs.trim()) return;
    setSavingObs(true);
    const { error } = await supabase.from('rma_observations').insert({
      rma_id: rma.id, content: newObs.trim(), author: userLabel ?? null,
    });
    if (!error) {
      setNewObs('');
      const { data } = await supabase.from('rma_observations').select('*').eq('rma_id', rma.id).order('created_at', { ascending: false });
      setObservations(data ?? []);
      onChanged();
    }
    setSavingObs(false);
  }

  // ── Cálculos ──
  const visibleItems = items.filter((i) => !i._toDelete);
  const visibleItemsHintCount = visibleItems.length;
  const subtotal = useMemo(
    () => visibleItems.reduce((s, i) => s + (Number(i.valor_total) || 0), 0),
    [visibleItems]
  );
  const total = subtotal - (Number(header.desconto) || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="flex h-[min(92vh,920px)] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
        onDrop={onDrop}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-lg font-semibold text-slate-900">RMA #{rma.numero}</h2>
            {header.numero_os && (
              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-slate-700">
                OS {header.numero_os}
              </span>
            )}
            <span className="text-sm text-slate-500">{header.client_trade_name || header.client_name}</span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs text-slate-500">{STATUS_LABEL[header.status]}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              'text-xs',
              savingState === 'saving' && 'text-amber-600',
              savingState === 'saved' && 'text-emerald-600',
              savingState === 'error' && 'text-red-600',
              savingState === 'idle' && 'text-slate-400',
            )}>
              {savingState === 'saving' && 'Salvando…'}
              {savingState === 'saved' && '✓ Salvo'}
              {savingState === 'error' && '⚠ Erro ao salvar'}
            </span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
          </div>
        </div>

        {/* Toolbar import */}
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-5 py-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="sr-only"
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50"
          >
            {importing ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
                </svg>
                Lendo planilha…
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Importar planilha (XLSX, foto ou PDF)
              </>
            )}
          </button>
          <span className="text-xs text-slate-400">ou solte um arquivo aqui (.xlsx, .xls, .csv, .pdf, .png, .jpg)</span>

          <div className="ml-auto">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={visibleItems.length === 0}
              title={visibleItems.length === 0 ? 'Adicione itens antes de gerar o PDF' : 'Baixar PDF pra mandar pro cliente'}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Baixar PDF
            </button>
          </div>
        </div>

        {/* Drop overlay */}
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 m-2 rounded-lg border-4 border-dashed border-brand-400 bg-brand-50/80 flex items-center justify-center">
            <div className="text-brand-700 text-base font-medium">Solte a imagem ou PDF aqui</div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-0 border-b border-slate-200 bg-white px-5">
          {([
            { key: 'itens',     label: 'Itens',     hint: visibleItemsHintCount > 0 ? `${visibleItemsHintCount}` : null },
            { key: 'cabecalho', label: 'Cabeçalho', hint: null },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'border-brand-500 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              )}
            >
              {tab.label}
              {tab.hint && (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                  {tab.hint}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">

          {activeTab === 'cabecalho' && (
            <>
              <div className="grid gap-3 lg:grid-cols-2">
                {/* Distribuidor */}
                <fieldset className="rounded-md border border-slate-200 p-3">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Distribuidor</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Cell label="Razão social" value={header.client_name} onChange={(v) => patchHeader('client_name', v)} className="sm:col-span-2" />
                    <Cell label="Nome fantasia" value={header.client_trade_name} onChange={(v) => patchHeader('client_trade_name', v)} />
                    <Cell label="CNPJ" value={header.client_cnpj} onChange={(v) => patchHeader('client_cnpj', v)} />
                    <Cell label="Comprador" value={header.numero_venda_origem} onChange={(v) => patchHeader('numero_venda_origem', v)} placeholder="(venda original)" />
                    <Cell label="Telefone" value={header.client_phone} onChange={(v) => patchHeader('client_phone', v)} />
                    <Cell label="E-mail" value={header.client_email} onChange={(v) => patchHeader('client_email', v)} className="sm:col-span-2" />
                  </div>
                </fieldset>

                {/* OS / técnico */}
                <fieldset className="rounded-md border border-slate-200 p-3">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Ordem de Serviço</legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Cell label="OS" value={header.numero_os} onChange={(v) => patchHeader('numero_os', v)} />
                    <Cell label="Setor" value={header.setor} onChange={(v) => patchHeader('setor', v)} />
                    <Cell label="Volume" type="number" value={String(header.volume)} onChange={(v) => patchHeader('volume', Number(v) || 1)} />
                    <Cell label="Técnico" value={header.tecnico_nome} onChange={(v) => patchHeader('tecnico_nome', v)} />
                    <Cell label="Tel. técnico" value={header.tecnico_phone} onChange={(v) => patchHeader('tecnico_phone', v)} className="sm:col-span-2" />
                    <Cell label="Entrada" type="date" value={header.data_recebido} onChange={(v) => patchHeader('data_recebido', v)} />
                    <Cell label="Término" type="date" value={header.data_devolvido} onChange={(v) => patchHeader('data_devolvido', v)} />
                    <Cell label="Prazo entrega" type="date" value={header.prazo_entrega} onChange={(v) => patchHeader('prazo_entrega', v)} />
                    <Cell label="Cond. pagamento" value={header.condicao_pagamento} onChange={(v) => patchHeader('condicao_pagamento', v)} className="sm:col-span-3" />
                  </div>
                </fieldset>
              </div>

              {/* Status / motivo / solução — só aqui no cabeçalho */}
              <div className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-3">
                <SelectCell label="Status" value={header.status} onChange={(v) => patchHeader('status', v as RmaStatus)} options={(['recebido', 'analise', 'conserto', 'pronto', 'devolvido', 'cancelado'] as RmaStatus[]).map(s => ({ value: s, label: STATUS_LABEL[s] }))} />
                <SelectCell label="Motivo" value={header.motivo} onChange={(v) => patchHeader('motivo', v as RmaMotivo)} options={(['defeito', 'desistencia', 'garantia', 'outro'] as RmaMotivo[]).map(m => ({ value: m, label: MOTIVO_LABEL[m] }))} />
                <SelectCell label="Solução" value={header.solucao} onChange={(v) => patchHeader('solucao', v as RmaSolucao)} options={(['pendente', 'troca', 'reparo', 'refund', 'descartado', 'outro'] as RmaSolucao[]).map(s => ({ value: s, label: SOLUCAO_LABEL[s] }))} />
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notas internas</label>
                <Textarea
                  value={header.notes}
                  onChange={(e) => patchHeader('notes', e.target.value)}
                  rows={3}
                />
              </div>
            </>
          )}

          {activeTab === 'itens' && (
          <>
          {/* TABELA DE ITENS — estilo planilha */}
          <fieldset className="rounded-md border border-slate-200">
            <legend className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Itens (planilha)</legend>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr className="text-slate-600">
                    <th className="border border-slate-200 px-2 py-1.5 text-center w-12">Cód</th>
                    <th className="border border-slate-200 px-2 py-1.5 text-left w-32">Produto</th>
                    <th className="border border-slate-200 px-2 py-1.5 text-left">Componentes trocados</th>
                    <th className="border border-slate-200 px-2 py-1.5 text-left w-44">Observação</th>
                    <th className="border border-slate-200 px-2 py-1.5 text-center w-28">Fabricação</th>
                    <th className="border border-slate-200 px-2 py-1.5 text-center w-16">Gar.</th>
                    <th className="border border-slate-200 px-2 py-1.5 text-right w-24">Total</th>
                    <th className="border border-slate-200 px-1 py-1.5 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {loadingItems ? (
                    <tr><td colSpan={8} className="px-3 py-4 text-center text-slate-400">Carregando…</td></tr>
                  ) : visibleItems.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-4 text-center text-slate-400">Nenhum item ainda. Clique em "+ adicionar linha" abaixo.</td></tr>
                  ) : (
                    visibleItems.map((it, idx) => {
                      const realIdx = items.indexOf(it);
                      return (
                        <tr key={it.id ?? `new-${idx}`} className="hover:bg-slate-50">
                          <td className="border border-slate-200 p-0">
                            <input
                              type="number"
                              value={it.posicao}
                              onChange={(e) => patchItem(realIdx, { posicao: Number(e.target.value) || 1 })}
                              className="w-full bg-transparent px-2 py-1.5 text-center text-xs focus:bg-brand-50 focus:outline-none focus:ring-1 focus:ring-brand-400"
                            />
                          </td>
                          <td className="border border-slate-200 p-0">
                            <input
                              value={it.item_name}
                              onChange={(e) => patchItem(realIdx, { item_name: e.target.value })}
                              placeholder="EGP 12V"
                              className="w-full bg-transparent px-2 py-1.5 text-xs focus:bg-brand-50 focus:outline-none focus:ring-1 focus:ring-brand-400"
                            />
                          </td>
                          <td className="border border-slate-200 p-0">
                            <input
                              value={it.componentes_trocados}
                              onChange={(e) => patchItem(realIdx, { componentes_trocados: e.target.value })}
                              placeholder="Ex: Res. 100K 3W, BD140"
                              className="w-full bg-transparent px-2 py-1.5 text-xs focus:bg-brand-50 focus:outline-none focus:ring-1 focus:ring-brand-400"
                            />
                          </td>
                          <td className="border border-slate-200 p-0">
                            <input
                              list="obs-presets"
                              value={it.observacao_status}
                              onChange={(e) => patchItem(realIdx, { observacao_status: e.target.value })}
                              placeholder="Desgaste / Testada / Erro de Ligação"
                              className="w-full bg-transparent px-2 py-1.5 text-xs focus:bg-brand-50 focus:outline-none focus:ring-1 focus:ring-brand-400"
                            />
                          </td>
                          <td className="border border-slate-200 p-0">
                            <input
                              type="date"
                              value={it.data_fabricacao}
                              onChange={(e) => patchItem(realIdx, { data_fabricacao: e.target.value })}
                              className="w-full bg-transparent px-2 py-1.5 text-center text-xs focus:bg-brand-50 focus:outline-none focus:ring-1 focus:ring-brand-400"
                            />
                          </td>
                          <td className="border border-slate-200 p-0 text-center">
                            <select
                              value={it.tem_garantia ? 'Sim' : 'Não'}
                              onChange={(e) => patchItem(realIdx, { tem_garantia: e.target.value === 'Sim' })}
                              className="w-full bg-transparent px-1 py-1.5 text-center text-xs focus:bg-brand-50 focus:outline-none focus:ring-1 focus:ring-brand-400"
                            >
                              <option value="Não">Não</option>
                              <option value="Sim">Sim</option>
                            </select>
                          </td>
                          <td className="border border-slate-200 p-0">
                            <input
                              type="number"
                              step="0.01"
                              value={it.valor_total ?? ''}
                              onChange={(e) => patchItem(realIdx, { valor_total: e.target.value === '' ? null : Number(e.target.value) })}
                              placeholder="0,00"
                              className="w-full bg-transparent px-2 py-1.5 text-right text-xs focus:bg-brand-50 focus:outline-none focus:ring-1 focus:ring-brand-400"
                            />
                          </td>
                          <td className="border border-slate-200 p-0 text-center">
                            <button
                              type="button"
                              onClick={() => removeItem(realIdx)}
                              className="text-slate-400 hover:text-red-600 px-1"
                              title="Remover linha"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {visibleItems.length > 0 && (
                  <tfoot className="bg-slate-50 text-slate-700 font-semibold">
                    <tr>
                      <td colSpan={6} className="border border-slate-200 px-2 py-1.5 text-right text-[11px] uppercase">Sub-total</td>
                      <td className="border border-slate-200 px-2 py-1.5 text-right">R$ {subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="border border-slate-200"></td>
                    </tr>
                    <tr>
                      <td colSpan={6} className="border border-slate-200 px-2 py-1.5 text-right text-[11px] uppercase">Desconto</td>
                      <td className="border border-slate-200 p-0">
                        <input
                          type="number"
                          step="0.01"
                          value={header.desconto || ''}
                          onChange={(e) => patchHeader('desconto', Number(e.target.value) || 0)}
                          placeholder="0,00"
                          className="w-full bg-white px-2 py-1.5 text-right text-xs focus:bg-brand-50 focus:outline-none focus:ring-1 focus:ring-brand-400"
                        />
                      </td>
                      <td className="border border-slate-200"></td>
                    </tr>
                    <tr className="bg-brand-50">
                      <td colSpan={6} className="border border-slate-200 px-2 py-1.5 text-right text-[11px] uppercase text-brand-700">Total</td>
                      <td className="border border-slate-200 px-2 py-1.5 text-right text-brand-700 text-sm">R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="border border-slate-200"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="flex justify-between items-center px-3 py-2 border-t border-slate-200 bg-slate-50/50">
              <button
                type="button"
                onClick={addItem}
                className="text-xs text-brand-600 hover:underline"
              >
                + adicionar linha
              </button>
              <span className="text-[11px] text-slate-400">{visibleItems.length} {visibleItems.length === 1 ? 'item' : 'itens'}</span>
            </div>
            <datalist id="obs-presets">
              {OBSERVACAO_PRESETS.map((p) => <option key={p} value={p} />)}
            </datalist>
          </fieldset>

          {/* Diagnóstico — fica na tab Itens (próximo à planilha) */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Diagnóstico</label>
            <Textarea
              value={header.diagnostico}
              onChange={(e) => patchHeader('diagnostico', e.target.value)}
              rows={3}
              placeholder="Resumo técnico do que foi encontrado…"
            />
          </div>

          {/* Timeline */}
          <fieldset className="rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Observações ({observations.length})
            </legend>
            <div className="mb-2 flex gap-2">
              <input
                value={newObs}
                onChange={(e) => setNewObs(e.target.value)}
                placeholder="Anotar algo neste RMA…"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <Button type="button" onClick={addObservation} disabled={!newObs.trim() || savingObs}>
                {savingObs ? '…' : 'Anotar'}
              </Button>
            </div>
            {observations.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhuma observação ainda.</p>
            ) : (
              <ul className="space-y-1.5">
                {observations.map((o) => (
                  <li key={o.id} className="rounded-md border border-slate-100 bg-white px-3 py-2 text-sm">
                    <p className="whitespace-pre-wrap text-slate-700">{o.content}</p>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {o.author ? `${o.author} · ` : ''}{new Date(o.created_at).toLocaleString('pt-BR')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          </>
          )}
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-2.5">
          <span className="text-[11px] text-slate-500">
            Editado por <strong>{userLabel}</strong> · auto-salvando a cada mudança
          </span>
          <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers de UI ─────────────────────────────────────────────────────────────

function Cell({
  label, value, onChange, type = 'text', placeholder, className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={cn('flex flex-col gap-0.5', className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-sm border border-slate-200 bg-white px-2 py-1 text-xs focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300"
      />
    </label>
  );
}

function SelectCell({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-sm border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
