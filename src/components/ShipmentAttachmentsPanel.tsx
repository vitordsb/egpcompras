import { useEffect, useRef, useState } from 'react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/Toast';
import {
  type ShipmentAttachment,
  ATTACHMENT_LABEL,
  listShipmentAttachments,
  uploadShipmentAttachment,
  getAttachmentSignedUrl,
  deleteShipmentAttachment,
  detectAttachmentType,
} from '@/lib/shipment-attachments';

interface Props {
  shipmentId: string;
  uploadedBy?: string;
}

const TYPE_COLORS: Record<string, string> = {
  venda_pdf: 'bg-blue-100 text-blue-700',
  nfe_pdf:   'bg-emerald-100 text-emerald-700',
  nfe_xml:   'bg-purple-100 text-purple-700',
  cce_xml:   'bg-amber-100 text-amber-700',
  outro:     'bg-slate-100 text-slate-600',
};

function formatBytes(n: number | null | undefined): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function ShipmentAttachmentsPanel({ shipmentId, uploadedBy }: Props) {
  const toast = useToast();
  const [attachments, setAttachments] = useState<ShipmentAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirmDel, setConfirmDel] = useState<ShipmentAttachment | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const list = await listShipmentAttachments(shipmentId);
      setAttachments(list);
    } catch (err) {
      toast.error('Erro', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [shipmentId]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      let novos = 0;
      let duplicados = 0;
      for (const file of Array.from(files)) {
        const result = await uploadShipmentAttachment({
          shipmentId,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          data: file,
          type: detectAttachmentType(file.name, file.type),
          uploadedBy,
        });
        if ((result as any)._duplicate) duplicados++;
        else novos++;
      }
      const parts: string[] = [];
      if (novos > 0) parts.push(`${novos} novo${novos > 1 ? 's' : ''}`);
      if (duplicados > 0) parts.push(`${duplicados} já existente${duplicados > 1 ? 's' : ''} (ignorado${duplicados > 1 ? 's' : ''})`);
      toast.success('Upload concluído', parts.join(' · '));
      await load();
    } catch (err) {
      toast.error('Erro no upload', err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function downloadAttachment(att: ShipmentAttachment) {
    try {
      const url = await getAttachmentSignedUrl(att.file_path, 60);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error('Erro', err instanceof Error ? err.message : String(err));
    }
  }

  async function doDelete() {
    if (!confirmDel) return;
    try {
      await deleteShipmentAttachment(confirmDel);
      setAttachments((prev) => prev.filter((a) => a.id !== confirmDel.id));
      toast.success('Removido', confirmDel.file_name);
    } catch (err) {
      toast.error('Erro', err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmDel(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Documentos ({attachments.length})</CardTitle>
          <Button
            type="button"
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Enviando…' : '+ Anexar'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.xml,application/pdf,application/xml,text/xml"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </CardHeader>
      <CardBody>
        {loading ? (
          <p className="text-sm text-slate-400">Carregando…</p>
        ) : attachments.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhum documento. Use <strong>+ Anexar</strong> para adicionar PDF de venda, PDF de NF-e, XML NF-e ou XML CC-e.
          </p>
        ) : (
          <ul className="space-y-2">
            {attachments.map((att) => (
              <li
                key={att.id}
                className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
              >
                <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TYPE_COLORS[att.file_type] ?? TYPE_COLORS.outro}`}>
                  {ATTACHMENT_LABEL[att.file_type]}
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => downloadAttachment(att)}
                    className="block truncate text-left text-sm font-medium text-slate-800 hover:text-brand-600 hover:underline"
                  >
                    {att.file_name}
                  </button>
                  <p className="text-xs text-slate-400">
                    {formatBytes(att.size_bytes)} · {new Date(att.uploaded_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmDel(att)}
                  className="text-xs text-red-500 hover:text-red-700"
                  aria-label="Remover anexo"
                >
                  remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      {confirmDel && (
        <ConfirmModal
          title="Remover documento?"
          description={`Remover "${confirmDel.file_name}"? Essa ação não pode ser desfeita.`}
          confirmLabel="Remover"
          variant="danger"
          onConfirm={doDelete}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </Card>
  );
}
