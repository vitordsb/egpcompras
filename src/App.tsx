import { Navigate, Route, Routes } from 'react-router-dom';
import AdminLayout from '@/components/AdminLayout';
import ProductsPage from '@/routes/admin/ProductsPage';
import ComponentsPage from '@/routes/admin/ComponentsPage';
import SuppliersPage from '@/routes/admin/SuppliersPage';
import QuotationsPage from '@/routes/admin/QuotationsPage';
import CostsPage from '@/routes/admin/CostsPage';
import BuyerAgentPage from '@/routes/admin/BuyerAgentPage';
import AiUsagePage from '@/routes/admin/AiUsagePage';
import MemoriesPage from '@/routes/admin/MemoriesPage';
import ProceduresPage from '@/routes/admin/ProceduresPage';
import SupplierQuotePage from '@/routes/public/SupplierQuotePage';

/**
 * Detecta se a app está rodando como portal público de cotação
 * (subdomínio cotacao.*). Nesse modo, expomos APENAS a rota /:token
 * — não há acesso ao admin a partir dessa URL.
 */
function isPublicQuoteSubdomain(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.startsWith('cotacao.');
}

export default function App() {
  if (isPublicQuoteSubdomain()) {
    return (
      <Routes>
        <Route path="/:token" element={<SupplierQuotePage />} />
        <Route
          path="*"
          element={
            <div className="mx-auto max-w-2xl p-8 text-sm text-slate-600">
              Link de cotação inválido. Pegue o link correto com o comprador.
            </div>
          }
        />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin/produtos" replace />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="produtos" replace />} />
        <Route path="produtos" element={<ProductsPage />} />
        <Route path="componentes" element={<ComponentsPage />} />
        <Route path="cotacoes" element={<QuotationsPage />} />
        <Route path="custos" element={<CostsPage />} />
        <Route path="fornecedores" element={<SuppliersPage />} />
        <Route path="comprador" element={<BuyerAgentPage />} />
        <Route path="consumo-ia" element={<AiUsagePage />} />
        <Route path="memorias" element={<MemoriesPage />} />
        <Route path="procedimentos" element={<ProceduresPage />} />
      </Route>
      {/* Fallback pra desenvolvimento local: /cotacao/:token continua funcionando */}
      <Route path="/cotacao/:token" element={<SupplierQuotePage />} />
      <Route path="*" element={<div className="p-6">404</div>} />
    </Routes>
  );
}
