import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { Component } from '@/types/db';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import Pagination from '@/components/ui/Pagination';
import { useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

interface FormState {
  id: string | null;
  name: string;
}

const emptyForm: FormState = {
  id: null,
  name: '',
};

const PAGE_SIZE = 25;

export default function ComponentsPage() {
  const toast = useToast();
  const [components, setComponents] = useState<Component[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState | null>(null); // null = modal fechado
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);

  useBodyScrollLock(!!form || !!confirm);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('components')
      .select('*')
      .order('name');
    if (error) setError(error.message);
    else setComponents((data ?? []) as Component[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setForm(emptyForm);
  }

  function openEdit(c: Component) {
    setForm({ id: c.id, name: c.name });
  }

  function closeForm() {
    setForm(null);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    if (!form.name.trim()) {
      setError('Nome é obrigatório.');
      return;
    }
    setSaving(true);

    const payload = { name: form.name.trim() };

    const result = form.id
      ? await supabase.from('components').update(payload).eq('id', form.id)
      : await supabase.from('components').insert(payload);

    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    closeForm();
    await load();
  }

  async function remove(c: Component) {
    setConfirm({
      message: `Remover componente "${c.name}"?`,
      onConfirm: async () => {
        setConfirm(null);
        const { error } = await supabase.from('components').delete().eq('id', c.id);
        if (error) {
          // Provável FK violation se já estiver em alguma BOM/cotação.
          toast.error('Erro', `Não foi possível remover: ${error.message}`);
          return;
        }
        await load();
      },
    });
  }

  const filtered = search.trim()
    ? components.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : components;

  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search]);

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Componentes</h1>
          <p className="text-sm text-slate-500">
            Catálogo de matérias-primas usado nas BOMs dos produtos.
          </p>
        </div>
        <Button onClick={openCreate}>+ Novo componente</Button>
      </div>

      <div className="mb-4 max-w-sm">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome…"
        />
      </div>

      {error && !form && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-600">
              {components.length === 0
                ? 'Nenhum componente cadastrado ainda.'
                : 'Nenhum resultado para a busca.'}
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Nome</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 font-medium text-slate-900">{c.name}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(c)}
                        className="text-brand-600 hover:underline mr-4"
                      >
                        editar
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(c)}
                        className="text-red-600 hover:underline"
                      >
                        remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination total={filtered.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} className="px-5" />
          </Card>
        </>
      )}

      {confirm && (
        <ConfirmModal
          title="Confirmar ação"
          description={confirm.message}
          confirmLabel="Confirmar"
          variant="danger"
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {form && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={closeForm}
        >
          <div
            className="w-full max-w-lg rounded-lg bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={submit}>
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">
                  {form.id ? 'Editar componente' : 'Novo componente'}
                </h2>
              </div>
              <div className="space-y-4 px-5 py-4">
                {error && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
                <div>
                  <Label htmlFor="cmp-name">Nome *</Label>
                  <Input
                    id="cmp-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ex: Indutor 47nh"
                    autoFocus
                  />
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
    </div>
  );
}
