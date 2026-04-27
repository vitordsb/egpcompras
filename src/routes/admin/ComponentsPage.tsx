import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { Component } from '@/types/db';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';

interface FormState {
  id: string | null;
  name: string;
}

const emptyForm: FormState = {
  id: null,
  name: '',
};

const PAGE_SIZE = 14;

export default function ComponentsPage() {
  const [components, setComponents] = useState<Component[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [form, setForm] = useState<FormState | null>(null); // null = modal fechado
  const [saving, setSaving] = useState(false);

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
    if (!confirm(`Remover componente "${c.name}"?`)) return;
    const { error } = await supabase.from('components').delete().eq('id', c.id);
    if (error) {
      // Provável FK violation se já estiver em alguma BOM/cotação.
      alert(`Não foi possível remover: ${error.message}`);
      return;
    }
    await load();
  }

  const filtered = search.trim()
    ? components.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : components;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Reseta página ao mudar busca
  useEffect(() => {
    setPage(0);
  }, [search]);

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
          </Card>
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-xs text-slate-600">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
              >
                ‹
              </button>
              <span>
                Página {safePage + 1} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
              >
                ›
              </button>
            </div>
          )}
        </>
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
