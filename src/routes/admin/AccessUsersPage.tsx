import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import { supabase } from '@/lib/supabase';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/Toast';
import { type UserRole, ROLE_LABELS, HARDCODED_ADMINS } from '@/lib/roles';

interface AccessUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
}

interface UserProfile {
  email: string;
  role: UserRole;
  display_name: string | null;
}

const ROLES: UserRole[] = ['admin', 'vendas', 'compras', 'expedicao', 'financeiro', 'producao'];

const ROLE_COLORS: Record<UserRole, string> = {
  admin:     'bg-purple-100 text-purple-700',
  vendas:    'bg-blue-100 text-blue-700',
  compras:   'bg-amber-100 text-amber-700',
  expedicao: 'bg-green-100 text-green-700',
  financeiro:'bg-red-100 text-red-700',
  producao:  'bg-slate-100 text-slate-700',
};

async function readJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error ?? 'Falha na operação.';
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
  const toast = useToast();
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('vendas');
  const [saving, setSaving] = useState(false);
  const [resetUser, setResetUser] = useState<AccessUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const [usersData, { data: profilesData }] = await Promise.all([
        readJson(await fetch('/api/master-users', { headers: await authHeaders() })),
        supabase.from('user_profiles').select('email, role, display_name'),
      ]);
      setUsers(usersData.users ?? []);
      const map: Record<string, UserProfile> = {};
      for (const p of (profilesData ?? []) as UserProfile[]) {
        map[p.email.toLowerCase()] = p;
      }
      setProfiles(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUsers(); }, []);

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
      // Cria o perfil com o cargo selecionado
      await supabase.from('user_profiles').upsert({
        email: email.trim().toLowerCase(),
        role: newRole,
      });
      setEmail('');
      setPassword('');
      setNewRole('vendas');
      await loadUsers();
      toast.success('Acesso criado', `${email} — ${ROLE_LABELS[newRole]}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(userEmail: string, role: UserRole) {
    if (HARDCODED_ADMINS.includes(userEmail.toLowerCase())) {
      toast.error('Não permitido', 'Admins fixos não podem ter o cargo alterado.');
      return;
    }
    const { error } = await supabase.from('user_profiles').upsert({ email: userEmail.toLowerCase(), role });
    if (error) {
      toast.error('Erro', error.message);
      return;
    }
    setProfiles((prev) => ({
      ...prev,
      [userEmail.toLowerCase()]: { ...(prev[userEmail.toLowerCase()] ?? { email: userEmail, display_name: null }), role },
    }));
    toast.success('Cargo atualizado', `${userEmail} → ${ROLE_LABELS[role]}`);
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
      toast.success('Senha redefinida', resetUser.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(user: AccessUser) {
    setConfirm({
      message: `Remover acesso de ${user.email}?`,
      onConfirm: async () => {
        setConfirm(null);
        setDeletingId(user.id);
        setError(null);
        try {
          await readJson(
            await fetch(`/api/master-users?id=${encodeURIComponent(user.id)}`, {
              method: 'DELETE',
              headers: await authHeaders(),
            })
          );
          await supabase.from('user_profiles').delete().eq('email', user.email.toLowerCase());
          await loadUsers();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setDeletingId(null);
        }
      },
    });
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Gerenciar Acessos</h1>
        <p className="text-sm text-slate-500">
          Crie usuários, defina cargos e controle o que cada um pode fazer no sistema.
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
              <div>
                <Label htmlFor="access-role">Cargo</Label>
                <select
                  id="access-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  disabled={saving}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              <Button type="submit" className="w-full justify-center" disabled={saving}>
                {saving ? 'Salvando...' : 'Criar acesso'}
              </Button>
            </form>

            {/* Legenda de cargos */}
            <div className="mt-6 space-y-2 border-t border-slate-100 pt-4">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Permissões por cargo</p>
              {ROLES.map((r) => (
                <div key={r} className="flex items-start gap-2 text-xs text-slate-600">
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-medium ${ROLE_COLORS[r]}`}>{ROLE_LABELS[r]}</span>
                  <span className="text-slate-500">
                    {r === 'admin' && 'Acesso total — todos os módulos e configurações'}
                    {r === 'vendas' && 'Produtos, WhatsApp com clientes'}
                    {r === 'compras' && 'Fornecedores, cotações, componentes, falta comprar'}
                    {r === 'expedicao' && 'Pedidos, saídas, observações, avisos WhatsApp'}
                    {r === 'financeiro' && 'Títulos, notas fiscais, relatórios financeiros'}
                    {r === 'producao' && 'Produção, estoque, romaneios'}
                  </span>
                </div>
              ))}
            </div>
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
                    <th className="px-5 py-3">Cargo</th>
                    <th className="px-5 py-3">Último acesso</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const profile = profiles[user.email.toLowerCase()];
                    const role: UserRole = profile?.role ?? 'vendas';
                    const isFixed = HARDCODED_ADMINS.includes(user.email.toLowerCase());
                    return (
                      <tr key={user.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-5 py-3 font-medium text-slate-900">{user.email}</td>
                        <td className="px-5 py-3">
                          {isFixed ? (
                            <span className={`rounded px-2 py-0.5 text-xs font-medium ${ROLE_COLORS.admin}`}>
                              {ROLE_LABELS.admin}
                            </span>
                          ) : (
                            <select
                              value={role}
                              onChange={(e) => changeRole(user.email, e.target.value as UserRole)}
                              className={`rounded border-0 px-2 py-0.5 text-xs font-medium cursor-pointer ${ROLE_COLORS[role]}`}
                            >
                              {ROLES.map((r) => (
                                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                              ))}
                            </select>
                          )}
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
                            {!isFixed && (
                              <button
                                type="button"
                                onClick={() => deleteUser(user)}
                                disabled={deletingId === user.id}
                                className="text-red-600 hover:underline disabled:opacity-50"
                              >
                                remover
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

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
