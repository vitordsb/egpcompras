import { supabase } from '@/lib/supabase';

export type AttachmentType = 'venda_pdf' | 'nfe_pdf' | 'nfe_xml' | 'cce_xml' | 'outro';

export interface ShipmentAttachment {
  id: string;
  shipment_id: string;
  file_path: string;
  file_name: string;
  file_type: AttachmentType;
  mime_type: string;
  size_bytes: number | null;
  uploaded_at: string;
  uploaded_by: string | null;
}

const BUCKET = 'shipments';

/**
 * Detecta o tipo do anexo pelo nome/mime.
 */
export function detectAttachmentType(fileName: string, mimeType: string): AttachmentType {
  const lower = fileName.toLowerCase();
  if (mimeType === 'application/xml' || mimeType === 'text/xml' || lower.endsWith('.xml')) {
    if (/cce|cc-?e|carta.*correc/i.test(lower)) return 'cce_xml';
    return 'nfe_xml';
  }
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    if (/venda|orcamento|pedido/i.test(lower)) return 'venda_pdf';
    if (/nfe|nf-?e|danfe|nota/i.test(lower)) return 'nfe_pdf';
    return 'venda_pdf';
  }
  return 'outro';
}

/**
 * Upload de arquivo do shipment.
 * - data: pode ser File, Blob, ou base64 string (com ou sem prefixo data:)
 */
export async function uploadShipmentAttachment(opts: {
  shipmentId: string;
  fileName: string;
  mimeType: string;
  data: File | Blob | string; // string = base64
  type?: AttachmentType;
  uploadedBy?: string;
}): Promise<ShipmentAttachment> {
  const { shipmentId, fileName, mimeType, data, type, uploadedBy } = opts;

  // Converte base64 → Blob se necessário
  let blob: Blob;
  if (typeof data === 'string') {
    const base64 = data.replace(/^data:[^;]+;base64,/, '');
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    blob = new Blob([arr], { type: mimeType });
  } else {
    blob = data;
  }

  const ext = fileName.split('.').pop() ?? 'bin';
  const safe = fileName.replace(/[^\w.-]/g, '_');
  const path = `${shipmentId}/${Date.now()}-${safe}.${ext === safe ? '' : ext}`.replace(/\.$/, '');

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: mimeType,
    upsert: false,
  });
  if (upErr) throw new Error(`Upload falhou: ${upErr.message}`);

  const detectedType = type ?? detectAttachmentType(fileName, mimeType);
  const { data: row, error: insErr } = await supabase
    .from('shipment_attachments')
    .insert({
      shipment_id: shipmentId,
      file_path: path,
      file_name: fileName,
      file_type: detectedType,
      mime_type: mimeType,
      size_bytes: blob.size,
      uploaded_by: uploadedBy ?? null,
    })
    .select('*')
    .single();

  if (insErr || !row) {
    // Rollback: tenta apagar o arquivo
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new Error(insErr?.message ?? 'Falha ao registrar anexo');
  }

  return row as ShipmentAttachment;
}

export async function listShipmentAttachments(shipmentId: string): Promise<ShipmentAttachment[]> {
  const { data, error } = await supabase
    .from('shipment_attachments')
    .select('*')
    .eq('shipment_id', shipmentId)
    .order('uploaded_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ShipmentAttachment[];
}

export async function getAttachmentSignedUrl(filePath: string, expiresInSec = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, expiresInSec);
  if (error || !data) throw new Error(error?.message ?? 'Falha ao gerar link');
  return data.signedUrl;
}

export async function deleteShipmentAttachment(attachment: ShipmentAttachment): Promise<void> {
  await supabase.storage.from(BUCKET).remove([attachment.file_path]);
  const { error } = await supabase.from('shipment_attachments').delete().eq('id', attachment.id);
  if (error) throw new Error(error.message);
}

export const ATTACHMENT_LABEL: Record<AttachmentType, string> = {
  venda_pdf: 'PDF Venda',
  nfe_pdf:   'PDF NF-e',
  nfe_xml:   'XML NF-e',
  cce_xml:   'XML CC-e',
  outro:     'Outro',
};
