// Parser client-side para NF-e XML e CC-e XML.
// Usa DOMParser nativo do browser — zero dependências externas.
// Para ZIP, usa JSZip (importado pelo chamador).

export type TipoNota =
  | 'venda'
  | 'retorno_conserto'
  | 'retorno_garantia'
  | 'remessa_demonstracao'
  | 'remessa_conserto'
  | 'remessa_industrializacao'
  | 'rma'
  | 'outro';

export interface NFeData {
  tipo: 'nfe';
  numero_nfe: string;
  serie: string;
  chave_acesso: string;
  data_emissao: string;
  natureza_operacao: string;
  tipo_nota: TipoNota;
  client_name: string;
  client_trade_name: string | null;
  client_cnpj: string;
  client_phone: string | null;
  client_address: string;
  total_produtos: number;
  desconto: number;
  valor_total: number;
  frete_valor: number;
  frete_conta: string;
  itens: Array<{ codigo: string; descricao: string; quantidade: number; valor_unitario: number; valor_total: number; cfop: string }>;
  duplicatas: Array<{ numero: string; vencimento: string; valor: number }>;
}

export interface CceData {
  tipo: 'cce';
  numero_nfe: string;
  chave_acesso: string;
  data_correcao: string;
  texto_correcao: string;
}

export type ParsedDoc = NFeData | CceData;

export interface ParsedAttachment {
  name: string;
  label: string;
  text: string;
  docs: ParsedDoc[];
}

// ---- Utilitários XML -------------------------------------------------------

function getText(el: Element | Document, tag: string): string {
  return el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
}

function formatCnpj(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length === 14) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  return raw;
}

function buildAddress(el: Element): string {
  return [
    getText(el, 'xLgr'),
    getText(el, 'nro'),
    getText(el, 'xCompl'),
    getText(el, 'xBairro'),
    getText(el, 'xMun'),
    getText(el, 'UF'),
    getText(el, 'CEP') ? `CEP ${getText(el, 'CEP')}` : '',
  ].filter(Boolean).join(', ');
}

function parseNum(s: string): number {
  return parseFloat(s.replace(',', '.')) || 0;
}

/**
 * Detecta o tipo da nota a partir do CFOP do primeiro item + texto da natureza.
 * CFOPs aplicáveis (saídas — 5xxx interestadual, 6xxx mesma UF):
 *  5102/6102/5403/6403 → venda
 *  5915/6915           → remessa para conserto
 *  5916/6916           → retorno de mercadoria recebida para conserto
 *  5912/6912           → remessa para demonstração
 *  5913/6913           → retorno de remessa para demonstração
 *  5901/6901           → remessa para industrialização
 *  5949/6949           → outras saídas (texto da natureza define)
 */
export function detectTipoNota(cfop: string, natureza: string): TipoNota {
  const c = cfop.replace(/\D/g, '');
  const n = natureza.toLowerCase();

  if (/^[56]916$/.test(c) || /retorno.*conserto/i.test(n)) return 'retorno_conserto';
  if (/^[56]915$/.test(c) || /remessa.*conserto/i.test(n)) return 'remessa_conserto';
  if (/^[56]912$/.test(c) || /remessa.*demonstra/i.test(n)) return 'remessa_demonstracao';
  if (/^[56]913$/.test(c) || /retorno.*demonstra/i.test(n)) return 'remessa_demonstracao';
  if (/^[56]901$/.test(c) || /industrializa/i.test(n))     return 'remessa_industrializacao';
  if (/garantia|troca/i.test(n))                            return 'retorno_garantia';
  if (/rma|return\s*merchandise/i.test(n))                  return 'rma';
  if (/^[56](102|403|404|405|656)$/.test(c))               return 'venda';
  if (/^[56]949$/.test(c) && /retorno|devoluç/i.test(n))   return 'retorno_garantia';
  return 'venda';
}

export const TIPO_NOTA_LABEL: Record<TipoNota, string> = {
  venda:                    'Venda',
  retorno_conserto:         'Retorno de Conserto',
  retorno_garantia:         'Retorno em Garantia',
  remessa_demonstracao:     'Remessa Demonstração',
  remessa_conserto:         'Remessa para Conserto',
  remessa_industrializacao: 'Remessa Industrialização',
  rma:                      'RMA',
  outro:                    'Outro',
};

// ---- Parser NF-e -----------------------------------------------------------

export function parseNFe(xml: string): NFeData | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) return null;

    // Chave de acesso: atributo Id do infNFe, sem prefixo "NFe"
    const infNFe = doc.getElementsByTagName('infNFe')[0];
    const chave_acesso = (infNFe?.getAttribute('Id') ?? '').replace(/^NFe/, '');

    const numero_nfe = getText(doc, 'nNF');
    const serie = getText(doc, 'serie');
    const dhEmi = getText(doc, 'dhEmi');
    const data_emissao = dhEmi.slice(0, 10);

    // Destinatário
    const destEl = doc.getElementsByTagName('dest')[0];
    const client_name = destEl ? getText(destEl, 'xNome') : '';
    const xFant = destEl ? getText(destEl, 'xFant') : '';
    const client_trade_name = xFant && xFant !== client_name ? xFant : null;
    const client_cnpj = formatCnpj(destEl ? (getText(destEl, 'CNPJ') || getText(destEl, 'CPF')) : '');
    const client_phone = destEl ? (getText(destEl, 'fone') || null) : null;
    const enderDest = destEl?.getElementsByTagName('enderDest')[0];
    const client_address = enderDest ? buildAddress(enderDest) : '';

    // Totais
    const tot = doc.getElementsByTagName('ICMSTot')[0];
    const total_produtos = parseNum(tot ? getText(tot, 'vProd') : '0');
    const valor_total    = parseNum(tot ? getText(tot, 'vNF')   : '0');
    const desconto       = parseNum(tot ? getText(tot, 'vDesc') : '0');
    const frete_valor    = parseNum(tot ? getText(tot, 'vFrete'): '0');

    // Frete por conta
    const modFrete = getText(doc, 'modFrete');
    const frete_conta = { '0': '0-EMITENTE', '1': '1-DESTINATARIO', '2': '2-TERCEIRO', '3': '3-PROPRIO-REMETENTE', '4': '4-PROPRIO-DEST', '9': '9-SEM-FRETE' }[modFrete] ?? modFrete;

    // Natureza da operação + tipo da nota (detecta pelo texto e CFOP)
    const natureza_operacao = getText(doc, 'natOp');

    // Itens (com CFOP para detecção do tipo)
    const itens = Array.from(doc.getElementsByTagName('det')).map(det => {
      const prod = det.getElementsByTagName('prod')[0];
      return {
        codigo:        prod ? getText(prod, 'cProd') : '',
        descricao:     prod ? getText(prod, 'xProd') : '',
        quantidade:    parseNum(prod ? getText(prod, 'qCom') : '0'),
        valor_unitario:parseNum(prod ? getText(prod, 'vUnCom'): '0'),
        valor_total:   parseNum(prod ? getText(prod, 'vProd') : '0'),
        cfop:          prod ? getText(prod, 'CFOP') : '',
      };
    });

    // Detecção de tipo: CFOP do primeiro item + texto da natureza
    const cfop = itens[0]?.cfop ?? '';
    const tipo_nota = detectTipoNota(cfop, natureza_operacao);

    // Duplicatas
    const duplicatas = Array.from(doc.getElementsByTagName('dup')).map(dup => ({
      numero:     getText(dup, 'nDup'),
      vencimento: getText(dup, 'dVenc'),
      valor:      parseNum(getText(dup, 'vDup')),
    }));

    return {
      tipo: 'nfe',
      numero_nfe, serie, chave_acesso, data_emissao,
      natureza_operacao, tipo_nota,
      client_name, client_trade_name, client_cnpj, client_phone, client_address,
      total_produtos, desconto, valor_total, frete_valor, frete_conta,
      itens, duplicatas,
    };
  } catch {
    return null;
  }
}

// ---- Parser CC-e -----------------------------------------------------------

export function parseCCe(xml: string): CceData | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) return null;

    const xCorrecao = getText(doc, 'xCorrecao') || getText(doc, 'xJust');
    if (!xCorrecao) return null;

    const chaveEl = doc.getElementsByTagName('chNFe')[0];
    const chave_acesso = chaveEl?.textContent?.trim() ?? '';
    // Extrai número da NF-e da chave (posições 26-34)
    const numero_nfe = chave_acesso.length >= 34 ? String(parseInt(chave_acesso.slice(25, 34), 10)) : '';

    const dhEvento = getText(doc, 'dhEvento') || getText(doc, 'dhRegEvento');
    const data_correcao = dhEvento ? dhEvento.slice(0, 10) : new Date().toISOString().slice(0, 10);

    return { tipo: 'cce', numero_nfe, chave_acesso, data_correcao, texto_correcao: xCorrecao };
  } catch {
    return null;
  }
}

// ---- Detecta tipo de XML ---------------------------------------------------

export function detectXmlType(xml: string): 'nfe' | 'cce' | 'unknown' {
  if (xml.includes('infNFe') || xml.includes('<NFe') || xml.includes('<nfeProc')) return 'nfe';
  if (xml.includes('xCorrecao') || xml.includes('xJust')) return 'cce';
  return 'unknown';
}

// ---- Converte para texto legível para a IA ---------------------------------

function fmtNum(n: number) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2 }); }

export function nfeToText(d: NFeData): string {
  const itensLines = d.itens.map(it =>
    `  ${it.codigo} | ${it.descricao} | ${it.quantidade}x R$${fmtNum(it.valor_unitario)} = R$${fmtNum(it.valor_total)}`
  ).join('\n');
  const dupsLines = d.duplicatas.length
    ? d.duplicatas.map(dp => `  ${dp.numero}: venc ${dp.vencimento} — R$${fmtNum(dp.valor)}`).join('\n')
    : '  (sem duplicatas)';

  return `[NF-e ${d.numero_nfe} série ${d.serie}]
tipo: nfe
numero_nfe: ${d.numero_nfe}
serie: ${d.serie}
chave_acesso: ${d.chave_acesso}
data_emissao: ${d.data_emissao}
client_name: ${d.client_name}
client_trade_name: ${d.client_trade_name ?? '—'}
client_cnpj: ${d.client_cnpj}
client_phone: ${d.client_phone ?? '—'}
client_address: ${d.client_address}
total_produtos: ${fmtNum(d.total_produtos)}
desconto: ${fmtNum(d.desconto)}
valor_total: ${fmtNum(d.valor_total)}
frete_valor: ${fmtNum(d.frete_valor)}
frete_conta: ${d.frete_conta}
itens:
${itensLines}
duplicatas:
${dupsLines}`;
}

export function cceToText(d: CceData): string {
  return `[Carta de Correção — NF-e ${d.numero_nfe}]
tipo: cce
numero_nfe: ${d.numero_nfe}
chave_acesso: ${d.chave_acesso}
data_correcao: ${d.data_correcao}
texto_correcao: ${d.texto_correcao}`;
}

// ---- Processa arquivo XML bruto --------------------------------------------

export function processXmlFile(fileName: string, content: string): ParsedAttachment | null {
  const type = detectXmlType(content);
  if (type === 'nfe') {
    const data = parseNFe(content);
    if (!data) return null;
    return {
      name: fileName,
      label: `NF-e ${data.numero_nfe} série ${data.serie}`,
      text: nfeToText(data),
      docs: [data],
    };
  }
  if (type === 'cce') {
    const data = parseCCe(content);
    if (!data) return null;
    return {
      name: fileName,
      label: `Carta de Correção — NF-e ${data.numero_nfe}`,
      text: cceToText(data),
      docs: [data],
    };
  }
  return null;
}

// ---- Processa ZIP (usa JSZip) ----------------------------------------------

export async function processZipFile(file: File): Promise<ParsedAttachment | null> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);

  const docs: ParsedDoc[] = [];
  const labels: string[] = [];
  const texts: string[] = [];

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.toLowerCase().endsWith('.xml')) continue;
    const content = await entry.async('string');
    const type = detectXmlType(content);
    if (type === 'nfe') {
      const data = parseNFe(content);
      if (data) { docs.push(data); labels.push(`NF-e ${data.numero_nfe}`); texts.push(nfeToText(data)); }
    } else if (type === 'cce') {
      const data = parseCCe(content);
      if (data) { docs.push(data); labels.push(`CC-e NF-e ${data.numero_nfe}`); texts.push(cceToText(data)); }
    }
  }

  if (docs.length === 0) return null;

  return {
    name: file.name,
    label: labels.join(' + '),
    text: texts.join('\n\n'),
    docs,
  };
}
