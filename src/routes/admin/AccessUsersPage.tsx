import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import { supabase } from '@/lib/supabase';

interface AccessUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
}

async function readJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error ?? 'Falha na operação.';
    // Traduz erros comuns da API
    if (/already.*registered|email.*use|duplicate/i.test(msg)) throw new Error('Esse e-mail já está cadastrado.');
    if (/password.*6|senha.*curta/i.test(msg)) throw new Error('A senha deve ter pelo menos 6 caracteres.');
    if (/not.*found|não.*encontrado/i.test(msg)) throw new Error('Usuário não encontrado.');
    throw new Error(msg);
  }
  return data;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function AccessUsersPage() {
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetUser, setResetUser] = useState<AccessUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const data = await readJson(await fetch('/api/master-users', { headers: await authHeaders() }));
      setUsers(data.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await readJson(
        await fetch('/api/master-users', {
          method: 'POST',
          headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
      );
      setEmail('');
      setPassword('');
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function resetPasswordForUser(e: FormEvent) {
    e.preventDefault();
    if (!resetUser) return;
    setError(null);
    setSaving(true);
    try {
      await readJson(
        await fetch('/api/master-users', {
          method: 'PATCH',
          headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: resetUser.id, password: resetPassword }),
        })
      );
      setResetUser(null);
      setResetPassword('');
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(user: AccessUser) {
    if (!window.confirm(`Remover acesso de ${user.email}?`)) return;
    setDeletingId(user.id);
    setError(null);
    try {
      await readJson(
        await fetch(`/api/master-users?id=${encodeURIComponent(user.id)}`, {
          method: 'DELETE',
          headers: await authHeaders(),
        })
      );
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Acessos</h1>
        <p className="text-sm text-slate-500">
          Crie usuários internos e redefina senhas quando alguém perder o acesso.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Novo usuário</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={createUser} className="space-y-4">
              <div>
                <Label htmlFor="access-email">Email</Label>
                <Input
                  id="access-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={saving}
                  required
                />
              </div>
              <div>
                <Label htmlFor="access-password">Senha inicial</Label>
                <Input
                  id="access-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={saving}
                  minLength={6}
                  required
                />
              </div>
              <Button type="submit" className="w-full justify-center" disabled={saving}>
                {saving ? 'Salvando...' : 'Criar acesso'}
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usuários cadastrados</CardTitle>
          </CardHeader>
          {loading ? (
            <CardBody>
              <p className="text-sm text-slate-500">Carregando...</p>
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Email</th>
                    <th className="px-5 py-3">Criado em</th>
                    <th className="px-5 py-3">Último acesso</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-3 font-medium text-slate-900">{user.email}</td>
                      <td className="px-5 py-3 text-slate-500">
                        {new Date(user.created_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-5 py-3 text-slate-500">
                        {user.last_sign_in_at
                          ? new Date(user.last_sign_in_at).toLocaleString('pt-BR')
                          : 'Nunca'}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setResetUser(user)}
                            className="text-brand-600 hover:underline"
                          >
                            redefinir senha
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteUser(user)}
                            disabled={deletingId === user.id}
                            className="text-red-600 hover:underline disabled:opacity-50"
                          >
                            remover
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {resetUser && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setResetUser(null)}
        >
          <form
            onSubmit={resetPasswordForUser}
            className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-slate-900">Redefinir senha</h2>
            <p className="mt-1 text-sm text-slate-500">{resetUser.email}</p>
            <div className="mt-4">
              <Label htmlFor="reset-password">Nova senha</Label>
              <Input
                id="reset-password"
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                minLength={6}
                required
                autoFocus
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setResetUser(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                Salvar
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
