import { Link, useNavigate } from 'react-router-dom';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <p className="text-6xl font-bold text-slate-200">404</p>
      <h1 className="mt-4 text-xl font-semibold text-slate-800">Página não encontrada</h1>
      <p className="mt-2 text-sm text-slate-500">O endereço que você acessou não existe.</p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Voltar
        </button>
        <Link
          to="/admin"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Ir para o início
        </Link>
      </div>
    </div>
  );
}
