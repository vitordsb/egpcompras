// Exporta listagem de componentes em PDF — layout compacto, sem cores,
// otimizado pra caber em poucas folhas.
//
// Modo "por produto": 2 tabelas
//   1. Placa eletrônica — componentes (apenas fabricação)
//   2. Placa eletrônica + acervo de venda (tudo junto)
//
// Modo "catálogo geral" (sem filtro): tabela única com todos os componentes.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Component } from '@/types/db';

export interface ExportBomLink {
  product_id: string;
  component_id: string;
  quantity: number;
  target_price_brl: number | null;
  tipo: 'fabricacao' | 'acervo';
  /** Quando false, o item é omitido do PDF de exportação. Default true. */
  show_in_pdf?: boolean;
  created_at: string;
}

export interface ExportProduct {
  id: string;
  name: string;
}

function fmtBRL(v: number | null | undefined): string {
  if (v == null) return '—';
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 4 });
}

const PAGE_MARGIN = 24;

function compactHeader(doc: jsPDF, title: string, info?: string): number {
  const PAGE_W = doc.internal.pageSize.getWidth();
  const today = new Date().toLocaleDateString('pt-BR');

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20);
  doc.text(title, PAGE_MARGIN, PAGE_MARGIN);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120);
  doc.text(today, PAGE_W - PAGE_MARGIN, PAGE_MARGIN, { align: 'right' });

  if (info) {
    doc.setFontSize(7);
    doc.setTextColor(110);
    doc.text(info, PAGE_MARGIN, PAGE_MARGIN + 9);
    return PAGE_MARGIN + 16;
  }
  return PAGE_MARGIN + 10;
}

const compactTableStyles = {
  theme: 'plain' as const,
  headStyles: {
    fillColor: [240, 240, 240] as [number, number, number],
    textColor: 20,
    fontSize: 7,
    fontStyle: 'bold' as const,
    cellPadding: 1.8,
  },
  bodyStyles: {
    fontSize: 7,
    textColor: 30,
    cellPadding: 1.4,
  },
  footStyles: {
    fontSize: 7,
    fontStyle: 'bold' as const,
    textColor: 20,
    cellPadding: 1.8,
  },
  margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
};

/**
 * Exporta catálogo geral de componentes (sem filtro).
 */
export function exportComponentsGeneral(
  components: Component[],
  links: ExportBomLink[]
): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const startY = compactHeader(
    doc,
    'Catálogo de componentes',
    `${components.length} ${components.length === 1 ? 'componente' : 'componentes'}`
  );

  const linksByCompId = new Map<string, ExportBomLink[]>();
  for (const l of links) {
    const arr = linksByCompId.get(l.component_id) ?? [];
    arr.push(l);
    linksByCompId.set(l.component_id, arr);
  }

  const sorted = [...components].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const rows = sorted.map((c) => {
    const compLinks = linksByCompId.get(c.id) ?? [];
    const sortedByDate = [...compLinks].sort((a, b) =>
      (b.created_at ?? '').localeCompare(a.created_at ?? '')
    );
    const lastCost = sortedByDate.find((l) => l.target_price_brl != null)?.target_price_brl ?? null;
    const mountType = (c as any).mount_type ?? '';
    return [
      c.name,
      mountType || '—',
      compLinks.length === 0 ? '—' : String(compLinks.length),
      lastCost != null ? `R$ ${fmtBRL(lastCost)}` : '—',
    ];
  });

  autoTable(doc, {
    ...compactTableStyles,
    startY,
    head: [['Componente', 'Mont.', 'Usos', 'Último custo']],
    body: rows,
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 40, halign: 'center' },
      2: { cellWidth: 36, halign: 'center' },
      3: { cellWidth: 80, halign: 'right' },
    },
  });

  const filename = `componentes-catalogo-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}

/**
 * Exporta composição de um produto específico em 2 tabelas:
 * 1) Placa eletrônica — componentes (só fabricação)
 * 2) Placa eletrônica + acervo de venda (tudo)
 */
export function exportComponentsByProduct(
  product: ExportProduct,
  components: Component[],
  links: ExportBomLink[]
): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const compById = new Map(components.map((c) => [c.id, c]));

  // Só inclui linhas marcadas como "mostrar no PDF" (default true).
  const productLinks = links.filter(
    (l) => l.product_id === product.id && l.show_in_pdf !== false
  );
  const fabricacao = productLinks.filter((l) => l.tipo === 'fabricacao');

  const subtotal = (rows: ExportBomLink[]) =>
    rows.reduce((sum, l) => sum + (l.target_price_brl ?? 0) * Number(l.quantity ?? 0), 0);

  const fabricacaoTotal = subtotal(fabricacao);
  const total = subtotal(productLinks);

  let y = compactHeader(doc, product.name);

  function buildBody(rows: ExportBomLink[], includeTipoCol: boolean): (string | { content: string; styles?: any })[][] {
    const sortedRows = [...rows].sort((a, b) => {
      const na = compById.get(a.component_id)?.name ?? '';
      const nb = compById.get(b.component_id)?.name ?? '';
      return na.localeCompare(nb, 'pt-BR');
    });

    return sortedRows.map((l) => {
      const c = compById.get(l.component_id);
      const mountType = (c as any)?.mount_type ?? '';
      const qty = Number(l.quantity ?? 0);
      const valorUnit = l.target_price_brl;
      const valorTotal = valorUnit != null ? valorUnit * qty : null;
      const base = [
        c?.name ?? '—',
        mountType || '—',
        qty.toLocaleString('pt-BR'),
        valorUnit != null ? fmtBRL(valorUnit) : '—',
        valorTotal != null ? fmtBRL(valorTotal) : '—',
      ];
      if (includeTipoCol) {
        base.splice(1, 0, l.tipo === 'acervo' ? 'Acervo' : 'Placa');
      }
      return base;
    });
  }

  function writeSection(title: string, body: any[][], total: number, includeTipoCol: boolean, startY: number): number {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20);
    doc.text(title, PAGE_MARGIN, startY);

    if (body.length === 0) {
      doc.setFontSize(7);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(140);
      doc.text('Nenhum item.', PAGE_MARGIN, startY + 10);
      return startY + 18;
    }

    const head = includeTipoCol
      ? [['Componente', 'Tipo', 'Mont.', 'Qtd', 'Unit. (R$)', 'Subtotal (R$)']]
      : [['Componente', 'Mont.', 'Qtd', 'Unit. (R$)', 'Subtotal (R$)']];

    const colStyles: Record<number, any> = includeTipoCol
      ? {
          0: { cellWidth: 'auto' },
          1: { cellWidth: 42, halign: 'center' },
          2: { cellWidth: 40, halign: 'center' },
          3: { cellWidth: 36, halign: 'right' },
          4: { cellWidth: 64, halign: 'right' },
          5: { cellWidth: 70, halign: 'right' },
        }
      : {
          0: { cellWidth: 'auto' },
          1: { cellWidth: 40, halign: 'center' },
          2: { cellWidth: 36, halign: 'right' },
          3: { cellWidth: 64, halign: 'right' },
          4: { cellWidth: 70, halign: 'right' },
        };

    const totalColIdx = includeTipoCol ? 5 : 4;
    const labelColIdx = totalColIdx - 1;
    const footRow: any[] = head[0].map((_, i) => {
      if (i === labelColIdx) return { content: 'Total:', styles: { halign: 'right' as const } };
      if (i === totalColIdx) return { content: fmtBRL(total), styles: { halign: 'right' as const } };
      return '';
    });

    autoTable(doc, {
      ...compactTableStyles,
      startY: startY + 3,
      head,
      body,
      foot: [footRow],
      columnStyles: colStyles,
    });

    return (doc as any).lastAutoTable.finalY + 8;
  }

  // Tabela 1: só placa
  y = writeSection(
    'Placa eletrônica — componentes',
    buildBody(fabricacao, false),
    fabricacaoTotal,
    false,
    y
  );

  // Tabela 2: placa + acervo (tudo)
  writeSection(
    'Placa eletrônica + acervo de venda',
    buildBody(productLinks, true),
    total,
    true,
    y
  );

  const safeName = product.name.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').toLowerCase();
  const filename = `componentes-${safeName}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
