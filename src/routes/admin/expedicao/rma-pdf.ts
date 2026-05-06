// Gera PDF do RMA pra mandar pro cliente.
// Layout focado no cliente: dados do distribuidor, itens consertados,
// componentes trocados, garantia e valor. Esconde notas/observações
// internas e status operacional (recebido/análise/etc).

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { MOTIVO_LABEL, type RmaRow } from './rmas-shared';

interface PdfItem {
  posicao: number | null;
  item_name: string | null;
  componentes_trocados: string | null;
  observacao_status: string | null;
  data_fabricacao: string | null;
  tem_garantia: boolean;
  valor_total: number | null;
}

function fmtBRL(v: number | null | undefined): string {
  if (v == null) return '—';
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const s = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

export function generateRmaPdf(rma: RmaRow, items: PdfItem[]): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  const PAGE_W = doc.internal.pageSize.getWidth();
  const MARGIN = 40;

  // ── Cabeçalho ─────────────────────────────────────────────────────────────
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(203, 20, 100); // brand-600 (#CB1464)
  doc.text('EGP TECNOLOGIA', MARGIN, MARGIN);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text('Indústria e comércio de equipamentos eletrônicos', MARGIN, MARGIN + 12);
  doc.text('Rua São Francisco, 86 — Vila Jovina — Cotia/SP — CEP 06705-115', MARGIN, MARGIN + 22);
  doc.text('Tel: (11) 4703-5846', MARGIN, MARGIN + 32);

  // Caixa do RMA no canto direito
  doc.setDrawColor(203, 20, 100);
  doc.setLineWidth(1);
  doc.roundedRect(PAGE_W - MARGIN - 140, MARGIN - 4, 140, 50, 4, 4);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text('RELATÓRIO DE RMA', PAGE_W - MARGIN - 130, MARGIN + 8);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(203, 20, 100);
  doc.text(`#${rma.numero}`, PAGE_W - MARGIN - 130, MARGIN + 28);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  if (rma.numero_os) doc.text(`OS ${rma.numero_os}`, PAGE_W - MARGIN - 130, MARGIN + 40);

  let y = MARGIN + 70;

  // ── Dados do cliente ──────────────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(60);
  doc.text('DISTRIBUIDOR / CLIENTE', MARGIN, y);
  doc.setLineWidth(0.5);
  doc.setDrawColor(220);
  doc.line(MARGIN, y + 3, PAGE_W - MARGIN, y + 3);
  y += 14;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(40);
  const clientLines: string[] = [];
  clientLines.push(`Razão social: ${rma.client_name}`);
  if (rma.client_trade_name) clientLines.push(`Nome fantasia: ${rma.client_trade_name}`);
  if (rma.client_cnpj)       clientLines.push(`CNPJ: ${rma.client_cnpj}`);
  if (rma.client_phone)      clientLines.push(`Telefone: ${rma.client_phone}`);
  if (rma.client_email)      clientLines.push(`E-mail: ${rma.client_email}`);
  for (const line of clientLines) {
    doc.text(line, MARGIN, y);
    y += 12;
  }

  y += 6;

  // ── Dados do serviço ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(60);
  doc.text('ATENDIMENTO', MARGIN, y);
  doc.line(MARGIN, y + 3, PAGE_W - MARGIN, y + 3);
  y += 14;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(40);

  const colW = (PAGE_W - 2 * MARGIN) / 3;
  const c1 = MARGIN;
  const c2 = MARGIN + colW;
  const c3 = MARGIN + 2 * colW;

  doc.text(`Entrada: ${fmtDate(rma.data_recebido)}`, c1, y);
  doc.text(`Término: ${fmtDate(rma.data_devolvido)}`, c2, y);
  doc.text(`Motivo: ${MOTIVO_LABEL[rma.motivo]}`, c3, y);
  y += 12;
  if (rma.tecnico_nome) doc.text(`Técnico: ${rma.tecnico_nome}`, c1, y);
  if (rma.setor)        doc.text(`Setor: ${rma.setor}`, c2, y);
  if (rma.volume)       doc.text(`Volume: ${rma.volume}`, c3, y);
  y += 16;

  // ── Diagnóstico (se houver) ───────────────────────────────────────────────
  if (rma.diagnostico) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(60);
    doc.text('DIAGNÓSTICO', MARGIN, y);
    doc.line(MARGIN, y + 3, PAGE_W - MARGIN, y + 3);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(40);
    const diagLines = doc.splitTextToSize(rma.diagnostico, PAGE_W - 2 * MARGIN);
    doc.text(diagLines, MARGIN, y);
    y += diagLines.length * 11 + 8;
  }

  // ── Tabela de itens ───────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(60);
  doc.text('ITENS', MARGIN, y);
  y += 6;

  const sortedItems = [...items].sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0));

  autoTable(doc, {
    startY: y,
    head: [['Cód', 'Produto', 'Componentes', 'Observação', 'Fabricação', 'Gar.', 'Total']],
    body: sortedItems.map((it) => [
      String(it.posicao ?? ''),
      it.item_name ?? '',
      it.componentes_trocados ?? '',
      it.observacao_status ?? '',
      fmtDate(it.data_fabricacao),
      it.tem_garantia ? 'Sim' : 'Não',
      fmtBRL(it.valor_total),
    ]),
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 4, lineColor: [200, 200, 200], textColor: [40, 40, 40] },
    headStyles: { fillColor: [240, 240, 240], textColor: [60, 60, 60], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 30, halign: 'center' },
      1: { cellWidth: 70 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 110 },
      4: { cellWidth: 60, halign: 'center' },
      5: { cellWidth: 30, halign: 'center' },
      6: { cellWidth: 60, halign: 'right' },
    },
    margin: { left: MARGIN, right: MARGIN },
  });

  let yAfter = (doc as any).lastAutoTable.finalY + 10;

  // ── Totais ────────────────────────────────────────────────────────────────
  const subtotal = items.reduce((s, i) => s + (Number(i.valor_total) || 0), 0);
  const desconto = Number(rma.desconto) || 0;
  const total = subtotal - desconto;

  const totBoxX = PAGE_W - MARGIN - 220;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60);
  doc.text('Subtotal:', totBoxX, yAfter);
  doc.text(fmtBRL(subtotal), PAGE_W - MARGIN, yAfter, { align: 'right' });
  yAfter += 12;

  if (desconto > 0) {
    doc.text('Desconto:', totBoxX, yAfter);
    doc.text(`- ${fmtBRL(desconto)}`, PAGE_W - MARGIN, yAfter, { align: 'right' });
    yAfter += 12;
  }

  doc.setLineWidth(0.5);
  doc.setDrawColor(180);
  doc.line(totBoxX, yAfter - 4, PAGE_W - MARGIN, yAfter - 4);
  yAfter += 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(203, 20, 100);
  doc.text('TOTAL:', totBoxX, yAfter);
  doc.text(fmtBRL(total), PAGE_W - MARGIN, yAfter, { align: 'right' });

  // ── Rodapé ────────────────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(150);
    const footerY = doc.internal.pageSize.getHeight() - 25;
    doc.text(
      `Documento gerado em ${new Date().toLocaleString('pt-BR')} · EGP Tecnologia · RMA #${rma.numero}`,
      PAGE_W / 2,
      footerY,
      { align: 'center' }
    );
    doc.text(
      `Página ${p} de ${pageCount}`,
      PAGE_W - MARGIN,
      footerY,
      { align: 'right' }
    );
  }

  const filename = `RMA-${rma.numero}-${rma.client_trade_name ?? rma.client_name}-${(rma.numero_os ?? '').replace(/\s/g, '')}.pdf`
    .replace(/[/\\?%*:|"<>]/g, '_')
    .slice(0, 100);

  doc.save(filename);
}
