import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import Logo from '@/components/Logo';

interface LoginPageProps {
  onMasterLogin?: () => void;
}

async function signInMaster(login: string, password: string): Promise<boolean> {
  const res = await fetch('/api/master-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  return res.ok;
}

export default function LoginPage({ onMasterLogin }: LoginPageProps) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const loginValue = login.trim();
    if (!loginValue || !password) {
      setError('Informe login e senha.');
      return;
    }
    setLoading(true);
    let signedIn = false;
    if (loginValue.includes('@')) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: loginValue.toLowerCase(),
        password,
      });
      signedIn = !signInError;
    }
    if (!signedIn) {
      try {
        signedIn = await signInMaster(loginValue, password);
        if (signedIn) onMasterLogin?.();
      } catch {
        signedIn = false;
      }
    }
    setLoading(false);
    if (!signedIn) {
      setError('Login ou senha inválidos.');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-6">
          <Logo size={48} className="mb-3" />
          <h1 className="text-lg font-semibold text-slate-900">Entrar no EGP Compras</h1>
          <p className="mt-1 text-sm text-slate-500">
            Acesso interno para usuários autorizados.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="login">Login ou email</Label>
            <Input
              id="login"
              type="text"
              autoComplete="username"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>

          <div>
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <Button type="submit" className="mt-5 w-full justify-center" disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
        </Button>
      </form>
    </main>
  );
}
