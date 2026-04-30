import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import type { Currency, Supplier } from '@/types/db';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import Pagination from '@/components/ui/Pagination';
import { useToast } from '@/components/ui/Toast';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

const PAGE_SIZE = 25;

interface FormState {
  id: string | null;
  name: string;
  email: string;
  default_currency: Currency;
}

const emptyForm: FormState = {
  id: null,
  name: '',
  email: '',
  default_currency: 'BRL',
};

export default function SuppliersPage() {
  const toast = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('name');
    if (error) setError(error.message);
    else setSuppliers((data ?? []) as Supplier[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setForm(emptyForm);
    setError(null);
  }

  function openEdit(s: Supplier) {
    setForm({
      id: s.id,
      name: s.name,
      email: s.email,
      default_currency: s.default_currency,
    });
    setError(null);
  }

  function closeForm() {
    setForm(null);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    if (!form.name.trim()) return setError('Nome é obrigatório.');
    if (!form.email.trim()) return setError('Email é obrigatório.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      return setError('Email inválido.');
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      default_currency: form.default_currency,
    };
    const result = form.id
      ? await supabase.from('suppliers').update(payload).eq('id', form.id)
      : await supabase.from('suppliers').insert(payload);
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    closeForm();
    await load();
  }

  async function remove(s: Supplier) {
    setConfirm({
      message: `Remover fornecedor "${s.name}"?`,
      onConfirm: async () => {
        setConfirm(null);
        const { error } = await supabase.from('suppliers').delete().eq('id', s.id);
        if (error) {
          toast.error('Erro', `Não foi possível remover: ${error.message}`);
          return;
        }
        await load();
      },
    });
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Fornecedores</h1>
          <p className="text-sm text-slate-500">
            Cadastro de quem recebe convites de cotação. O sistema envia um link único pra cada um.
          </p>
        </div>
        <Button onClick={openCreate}>+ Novo fornecedor</Button>
      </div>

      {error && !form && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : suppliers.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-600">Nenhum fornecedor cadastrado ainda.</p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Nome</th>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3 w-20">Moeda</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {suppliers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((s) => (
                <tr key={s.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 font-medium text-slate-900">{s.name}</td>
                  <td className="px-5 py-3 text-slate-600">{s.email}</td>
                  <td className="px-5 py-3 text-slate-600">{s.default_currency}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(s)}
                      className="text-brand-600 hover:underline mr-4"
                    >
                      editar
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(s)}
                      className="text-red-600 hover:underline"
                    >
                      remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={suppliers.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} className="px-5" />
        </Card>
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
                  {form.id ? 'Editar fornecedor' : 'Novo fornecedor'}
                </h2>
              </div>
              <div className="space-y-4 px-5 py-4">
                {error && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
                <div>
                  <Label htmlFor="sup-name">Nome *</Label>
                  <Input
                    id="sup-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ex: Eletro Componentes Ltda"
                    autoFocus
                  />
                </div>
                <div>
                  <Label htmlFor="sup-email">Email *</Label>
                  <Input
                    id="sup-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="contato@fornecedor.com.br"
                  />
                </div>
                <div>
                  <Label htmlFor="sup-currency">Moeda padrão</Label>
                  <select
                    id="sup-currency"
                    value={form.default_currency}
                    onChange={(e) =>
                      setForm({ ...form, default_currency: e.target.value as Currency })
                    }
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="BRL">BRL — Real</option>
                    <option value="USD">USD — Dólar</option>
                  </select>
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
