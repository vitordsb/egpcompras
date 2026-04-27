import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label, Textarea } from '@/components/ui/Input';

interface Procedure {
  id: string;
  name: string;
  description: string | null;
  steps: string;
  created_at: string;
  updated_at: string;
}

interface FormState {
  id: string | null;
  name: string;
  description: string;
  steps: string;
}

const emptyForm: FormState = { id: null, name: '', description: '', steps: '' };

export default function ProceduresPage() {
  const [list, setList] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Procedure | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('agent_procedures')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) setError(error.message);
    else setList((data ?? []) as Procedure[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setForm(emptyForm);
    setError(null);
  }

  function openEdit(p: Procedure) {
    setForm({
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      steps: p.steps,
    });
    setError(null);
  }

  function closeForm() {
    setForm(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    if (!form.name.trim()) return setError('Nome é obrigatório.');
    if (!form.steps.trim()) return setError('Os passos são obrigatórios.');
    setSaving(true);

    const payload: any = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      steps: form.steps.trim(),
    };

    const result = form.id
      ? await supabase
          .from('agent_procedures')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', form.id)
      : await supabase.from('agent_procedures').insert(payload);

    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    closeForm();
    await load();
  }

  async function doDelete() {
    if (!confirmDelete) return;
    const { error } = await supabase
      .from('agent_procedures')
      .delete()
      .eq('id', confirmDelete.id);
    if (error) {
      alert(`Erro: ${error.message}`);
      return;
    }
    setConfirmDelete(null);
    await load();
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Procedimentos</h1>
          <p className="text-sm text-slate-500">
            Playbooks que o assistente aprende e executa sob demanda. Diferente das memórias
            (fatos passivos), estes são receitas ativas — você ensina uma vez e ele repete.
          </p>
        </div>
        <Button onClick={openCreate}>+ Novo procedimento</Button>
      </div>

      {error && !form && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : list.length === 0 ? (
        <Card>
          <CardBody className="space-y-2">
            <p className="text-sm text-slate-600">Nenhum procedimento ainda.</p>
            <p className="text-xs text-slate-500">
              Você pode criar manualmente ou pedir pro assistente:{' '}
              <em>"aprenda a fazer X: passo 1 ... passo 2 ..."</em>.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((p) => (
            <Card key={p.id}>
              <CardHeader className="flex items-center justify-between">
                <div>
                  <CardTitle>{p.name}</CardTitle>
                  {p.description && (
                    <p className="mt-0.5 text-xs text-slate-500">{p.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="text-brand-600 hover:underline"
                  >
                    editar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(p)}
                    className="text-red-600 hover:underline"
                  >
                    remover
                  </button>
                </div>
              </CardHeader>
              <CardBody>
                <div className="rounded-md bg-slate-50 p-3 text-xs">
                  <div className="mb-1 font-medium uppercase tracking-wide text-slate-500">
                    Passos
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-slate-700">{p.steps}</pre>
                </div>
                <div className="mt-2 text-[11px] text-slate-400">
                  atualizado em {new Date(p.updated_at).toLocaleString('pt-BR')}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Modal de form */}
      {form && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={closeForm}
        >
          <div
            className="flex h-[min(720px,92vh)] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={save} className="flex flex-1 flex-col overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">
                  {form.id ? 'Editar procedimento' : 'Novo procedimento'}
                </h2>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                {error && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <div>
                  <Label htmlFor="proc-name">Nome *</Label>
                  <Input
                    id="proc-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ex: cotação mensal padrão"
                    autoFocus
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Nome curto e único — é como você vai invocar o procedimento.
                  </p>
                </div>

                <div>
                  <Label htmlFor="proc-desc">Descrição</Label>
                  <Input
                    id="proc-desc"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Ex: Cotação completa do Módulo Wifi com fornecedores de sempre"
                  />
                </div>

                <div className="flex flex-1 flex-col">
                  <Label htmlFor="proc-steps">Passos *</Label>
                  <Textarea
                    id="proc-steps"
                    value={form.steps}
                    onChange={(e) => setForm({ ...form, steps: e.target.value })}
                    placeholder={`Ex:\n1. Crie cotação do produto "Módulo Wifi" com 100 unidades\n2. Exclua o componente "caixa" e "embalagem" da cotação\n3. Condição de pagamento: 30/60/90\n4. Convide os fornecedores: ana@x.com, jose@y.com\n5. Mostre os links pra mim`}
                    className="min-h-[280px]"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Texto livre. Inclua todos os parâmetros necessários — o assistente vai ler isso
                    e executar as tools certas. Quanto mais explícito, mais confiável fica em
                    modelos pequenos como Ollama.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
                <Button type="button" variant="secondary" onClick={closeForm}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Salvando…' : form.id ? 'Salvar' : 'Criar'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-5">
              <h2 className="text-base font-semibold text-slate-900">Remover procedimento?</h2>
              <p className="mt-1 text-sm text-slate-600">
                <strong>{confirmDelete.name}</strong> será excluído. O assistente não vai mais
                conseguir executar esse playbook.
              </p>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
              <Button type="button" variant="secondary" onClick={() => setConfirmDelete(null)}>
                Cancelar
              </Button>
              <Button type="button" variant="danger" onClick={doDelete}>
                Remover
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
