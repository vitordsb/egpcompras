import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';

interface Memory {
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export default function MemoriesPage() {
  const toast = useToast();
  const [list, setList] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newContent, setNewContent] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Memory | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('agent_memories')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    else setList((data ?? []) as Memory[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!newContent.trim()) return;
    setCreating(true);
    setError(null);
    const { error } = await supabase
      .from('agent_memories')
      .insert({ content: newContent.trim() });
    setCreating(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNewContent('');
    await load();
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editing.content.trim()) return;
    const { error } = await supabase
      .from('agent_memories')
      .update({ content: editing.content.trim(), updated_at: new Date().toISOString() })
      .eq('id', editing.id);
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(null);
    await load();
  }

  async function doDelete() {
    if (!confirmDelete) return;
    const { error } = await supabase.from('agent_memories').delete().eq('id', confirmDelete.id);
    if (error) {
      toast.error('Erro', error.message);
      return;
    }
    setConfirmDelete(null);
    await load();
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Memórias do EGP</h1>
        <p className="text-sm text-slate-500">
          Fatos que o assistente lembra entre conversas. São injetados em toda nova conversa.
        </p>
      </div>

      {/* Indicador de saúde da arquitetura de memória */}
      {!loading && list.length > 0 && (() => {
        const n = list.length;
        const estTokens = Math.round(n * 75); // ~75 tokens por memória em média
        if (n >= 80) return (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <strong>⚠ Hora de migrar a arquitetura de memória</strong>
            <p className="mt-1">
              Você tem <strong>{n} memórias</strong> (~{estTokens.toLocaleString('pt-BR')} tokens extras por chamada).
              Com esse volume, o modelo começa a perder foco e o custo por conversa aumenta significativamente.
            </p>
            <p className="mt-1.5 text-red-700">
              Próximo passo: ativar <strong>busca vetorial (pgvector)</strong> no Supabase e migrar as memórias
              para um sistema RAG — a IA passará a buscar só as memórias relevantes para cada pergunta,
              em vez de carregar todas. Me peça pra implementar quando quiser.
            </p>
          </div>
        );
        if (n >= 50) return (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <strong>Atenção: memórias estão crescendo</strong>
            <p className="mt-1">
              <strong>{n} memórias</strong> (~{estTokens.toLocaleString('pt-BR')} tokens por chamada).
              Ainda funciona bem, mas vale considerar arquitetura de busca vetorial em breve.
              Acima de 80 entradas, a qualidade das respostas pode cair.
            </p>
          </div>
        );
        if (n >= 30) return (
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            <strong>{n} memórias</strong> (~{estTokens.toLocaleString('pt-BR')} tokens por chamada) —
            arquitetura atual aguenta bem até ~80. Tudo certo por enquanto.
          </div>
        );
        return null;
      })()}

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card className="mb-6">
        <CardBody>
          <form onSubmit={create} className="space-y-2">
            <Textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Ex: O custo de montagem padrão é R$ 1,71. · O fornecedor X cobra à vista com 5% de desconto."
              rows={2}
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={!newContent.trim() || creating}>
                {creating ? 'Salvando…' : '+ adicionar memória'}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : list.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-600">
              Nenhuma memória ainda. Você pode criar acima ou pedir pro assistente:{' '}
              <em>"aprenda que X"</em>.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2">
          {list.map((m) => (
            <Card key={m.id}>
              <CardBody className="space-y-2">
                {editing?.id === m.id ? (
                  <>
                    <Textarea
                      value={editing.content}
                      onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                      rows={2}
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(null)}>
                        Cancelar
                      </Button>
                      <Button type="button" size="sm" onClick={saveEdit}>
                        Salvar
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-slate-800">{m.content}</p>
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>
                        criada em {new Date(m.created_at).toLocaleString('pt-BR')}
                        {m.updated_at !== m.created_at && (
                          <> · editada em {new Date(m.updated_at).toLocaleString('pt-BR')}</>
                        )}
                      </span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setEditing({ id: m.id, content: m.content })}
                          className="text-brand-600 hover:underline"
                        >
                          editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(m)}
                          className="text-red-600 hover:underline"
                        >
                          esquecer
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </CardBody>
            </Card>
          ))}
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
              <h2 className="text-base font-semibold text-slate-900">Esquecer essa memória?</h2>
              <p className="mt-1 text-sm text-slate-600">
                "{confirmDelete.content}"
              </p>
              <p className="mt-2 text-xs text-slate-500">
                O assistente não terá mais acesso a esse fato em futuras conversas.
              </p>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
              <Button type="button" variant="secondary" onClick={() => setConfirmDelete(null)}>
                Cancelar
              </Button>
              <Button type="button" variant="danger" onClick={doDelete}>
                Esquecer
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
