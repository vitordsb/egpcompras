import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import Header from '@/components/Header';
import QuickChatDrawer from '@/components/QuickChatDrawer';
import { useInternalAuth } from '@/lib/auth-context';
import { canAccessPath, type PageKey } from '@/lib/roles';
import {
  writeUIMode,
  writeLastAdminRoute,
  useUIMode,
} from '@/lib/ui-mode';

interface NavItem {
  to?: string;            // se não tiver, é grupo expandível
  label: string;
  description: string;
  icon: ReactNode;
  optional?: boolean;
  children?: NavItem[];   // sub-itens (sem suporte recursivo, só 1 nível)
}

// Itens operacionais — uso diário/semanal. Ordem reflete fluxo natural do dia.
// Comprador (IA) saiu da sidebar — agora é o "Modo IA" no header global.
const mainLinks: NavItem[] = [
  {
    label: 'Vendas',
    description: 'Produtos, clientes e marketing',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z" />
      </svg>
    ),
    children: [
      {
        to: '/admin/produtos',
        label: 'Produtos',
        description: 'Cadastro e BOM',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75 12 3l8.25 3.75M3.75 6.75v10.5L12 21m-8.25-14.25L12 10.5m0 0v10.5m0-10.5 8.25-3.75M12 10.5l-4.125-1.875" />
          </svg>
        ),
      },
      {
        to: '/admin/clientes',
        label: 'Clientes',
        description: 'Cadastro unificado e segmentação',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
          </svg>
        ),
      },
      {
        to: '/admin/campanhas',
        label: 'Campanhas',
        description: 'Marketing automatizado via WhatsApp',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46" />
          </svg>
        ),
      },
      {
        to: '/admin/whatsapp',
        label: 'WhatsApp',
        description: 'Conversas e pedidos via WhatsApp',
        icon: (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 text-green-500">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
          </svg>
        ),
      },
      {
        to: '/admin/wa-templates',
        label: 'Templates Meta',
        description: 'Crie e gerencie templates aprovados pela Meta',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
          </svg>
        ),
      },
      {
        to: '/admin/imagens',
        label: 'Imagens IA',
        description: 'Gere imagens com IA e envie via WhatsApp',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Compras',
    description: 'Cotações, custos e fornecedores',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
      </svg>
    ),
    children: [
      {
        to: '/admin/cotacoes',
        label: 'Cotações',
        description: 'Enviadas e recebidas',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75 6 9l3.75 3.75L16.5 6l5.25 5.25M21.75 6h-3.75M21.75 6v3.75" />
          </svg>
        ),
      },
      {
        to: '/admin/custos',
        label: 'Custos',
        description: 'Resumo por produto',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l3.75 3.75L22.5 5.25M16.5 5.25h6v6" />
          </svg>
        ),
      },
      {
        to: '/admin/componentes',
        label: 'Componentes',
        description: 'Catálogo de matérias-primas',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6.878V6a2.25 2.25 0 0 1 2.25-2.25h7.5A2.25 2.25 0 0 1 18 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 0 0 4.5 9v.878m13.5-3A2.25 2.25 0 0 1 19.5 9v.878m0 0a2.246 2.246 0 0 0-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0 1 21 12v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6c0-.98.626-1.813 1.5-2.122" />
          </svg>
        ),
      },
      {
        to: '/admin/falta-comprar',
        label: 'Falta Comprar',
        description: 'Itens faltantes nos pedidos',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        ),
      },
      {
        to: '/admin/comprado',
        label: 'Comprado',
        description: 'Encomendados, chegada e estoque',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
          </svg>
        ),
      },
      {
        to: '/admin/fornecedores',
        label: 'Fornecedores',
        description: 'Cadastro e itens preferidos',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Expedição',
    description: 'Pedidos, saídas e observações',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
      </svg>
    ),
    children: [
      {
        to: '/admin/expedicao/pedidos',
        label: 'Pedidos',
        description: 'Em aberto e em rota',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
          </svg>
        ),
      },
      {
        to: '/admin/expedicao/saidas',
        label: 'Saídas',
        description: 'Histórico (saíram, voltaram)',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        ),
      },
      {
        to: '/admin/expedicao/observacoes',
        label: 'Observações',
        description: 'Anotações e faltas',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Produção',
    description: 'Romaneios e montadora',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l5.654-4.654m5.65-4.656 4.654-5.654a2.548 2.548 0 0 1 3.586 3.586l-5.654 4.654m-4.656 5.65-1.207.767a1.5 1.5 0 0 1-1.866-.252 1.5 1.5 0 0 1-.252-1.866l.767-1.207" />
      </svg>
    ),
    children: [
      {
        to: '/admin/producao',
        label: 'Ordens de Produção',
        description: 'Romaneios e montadora',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
          </svg>
        ),
      },
      {
        to: '/admin/estoque',
        label: 'Estoque',
        description: 'Saldo e capacidade produtiva',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Financeira',
    description: 'Títulos, NFs e relatório',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h1.5m-1.5 0h-1.5m-1.5 0H9m-1.5 0H6" />
      </svg>
    ),
    children: [
      {
        to: '/admin/financeira/com-nota',
        label: 'Com Nota',
        description: 'Pedidos faturados',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        ),
      },
      {
        to: '/admin/financeira/sem-nota',
        label: 'Sem Nota',
        description: 'Pedidos sem NF',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
        ),
      },
      {
        to: '/admin/financeira/relatorio',
        label: 'Relatório',
        description: 'Títulos e fluxo',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
          </svg>
        ),
      },
    ],
  },
];

// Configurações da IA — uso raro. Ficam no popover do rodapé.
const configLinks: NavItem[] = [
  {
    to: '/admin/memorias',
    label: 'Memórias',
    description: 'O que a IA aprendeu',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    to: '/admin/procedimentos',
    label: 'Procedimentos',
    description: 'Playbooks que a IA executa',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
      </svg>
    ),
  },
  {
    to: '/admin/tarefas',
    label: 'Tarefas',
    description: 'Agendamentos automáticos',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
  {
    to: '/admin/consumo-ia',
    label: 'Consumo IA',
    description: 'Tokens e chamadas Gemini',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
  },
  {
    to: '/admin/conta-oficial',
    label: 'Conta Oficial',
    description: 'Status do selo verde WhatsApp',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
];

const accessLink: NavItem = {
  to: '/admin/acessos',
  label: 'Acessos',
  description: 'Usuários e senhas',
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a8.25 8.25 0 1 1 15 0M18 12.75h3m-1.5-1.5v3" />
    </svg>
  ),
};

function NavItemRow({
  item,
  onNavigate,
  compact = false,
}: {
  item: NavItem;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  if (!item.to) return null; // grupo (com children) é tratado separadamente
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      title={item.description}
      className={({ isActive }) =>
        cn(
          'group flex items-start gap-3 rounded-md transition-colors',
          compact ? 'px-3 py-1.5' : 'px-3 py-1.5 2xl:py-2.5',
          isActive
            ? 'bg-brand-50 text-brand-700'
            : 'text-slate-700 hover:bg-slate-100'
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'mt-0.5 transition-colors',
              isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600'
            )}
          >
            {item.icon}
          </span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2">
              <span className={cn('font-medium', compact ? 'text-[13px]' : 'text-sm')}>
                {item.label}
              </span>
              {item.optional && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  opcional
                </span>
              )}
            </span>
            {!compact && (
              <span className="hidden text-xs text-slate-500 2xl:block">{item.description}</span>
            )}
          </span>
        </>
      )}
    </NavLink>
  );
}

function NavGroup({
  item,
  onNavigate,
}: {
  item: NavItem;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  // Mantém aberto quando alguma rota filha estiver ativa
  const childActive = (item.children ?? []).some(
    (c) => c.to && location.pathname.startsWith(c.to)
  );
  const [open, setOpen] = useState(childActive);

  // Reabre se uma rota filha for ativada externamente
  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={item.description}
        className={cn(
          'group flex w-full items-start gap-3 rounded-md px-3 py-1.5 text-left transition-colors 2xl:py-2.5',
          childActive ? 'text-brand-700' : 'text-slate-700 hover:bg-slate-100'
        )}
      >
        <span
          className={cn(
            'mt-0.5 transition-colors',
            childActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600'
          )}
        >
          {item.icon}
        </span>
        <span className="flex-1 min-w-0">
          <span className="text-sm font-medium">{item.label}</span>
          <span className="hidden text-xs text-slate-500 2xl:block">{item.description}</span>
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={cn(
            'mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform',
            open && 'rotate-180'
          )}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && item.children && (
        <div className="mt-0.5 ml-4 space-y-0.5 border-l border-slate-200 pl-2">
          {item.children.map((c) => (
            <NavItemRow key={c.to ?? c.label} item={c} onNavigate={onNavigate} compact />
          ))}
        </div>
      )}
    </div>
  );
}

const RH_EMAILS = ['vitor@grupoegp.com.br', 'joane@grupoegp.com.br'];

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const mode = useUIMode();
  const { userEmail, userRole, allowedPageKeys } = useInternalAuth();
  const isRhUser = userEmail != null && RH_EMAILS.includes(userEmail.toLowerCase());
  const isAdmin = userRole === 'admin';
  const pageKeys = allowedPageKeys === '*' ? null : (allowedPageKeys ?? []) as PageKey[];

  function pathAllowed(path: string): boolean {
    if (isAdmin || pageKeys === null) return true;
    return canAccessPath(pageKeys, path);
  }

  function sectionVisible(item: NavItem): boolean {
    if (isAdmin) return true;
    if (item.children) return item.children.some((c) => !c.to || pathAllowed(c.to));
    return item.to ? pathAllowed(item.to) : false;
  }

  function filterChildren(item: NavItem): NavItem {
    if (!item.children) return item;
    return { ...item, children: item.children.filter((c) => !c.to || pathAllowed(c.to)) };
  }
  const [mobileOpen, setMobileOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [quickChatOpen, setQuickChatOpen] = useState(false);
  const configRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  // Título dinâmico da aba por rota
  useEffect(() => {
    const PAGE_TITLES: Record<string, string> = {
      '/admin':                          'Início',
      '/admin/produtos':                 'Produtos',
      '/admin/componentes':              'Componentes',
      '/admin/cotacoes':                 'Cotações',
      '/admin/custos':                   'Custos',
      '/admin/fornecedores':             'Fornecedores',
      '/admin/expedicao/pedidos':        'Pedidos',
      '/admin/expedicao/saidas':         'Saídas',
      '/admin/expedicao/observacoes':    'Observações',
      '/admin/financeira/com-nota':      'Com Nota',
      '/admin/financeira/sem-nota':      'Sem Nota',
      '/admin/financeira/relatorio':     'Rel. Financeira',
      '/admin/falta-comprar':            'Falta Comprar',
      '/admin/estoque':                  'Estoque',
      '/admin/producao':                 'Produção',
      '/admin/rh/prestadores':           'Prestadores',
      '/admin/rh/calculos':              'Cálculos RH',
      '/admin/rh/historico':             'Histórico RH',
      '/admin/memorias':                 'Memórias',
      '/admin/procedimentos':            'Procedimentos',
      '/admin/consumo-ia':               'Consumo IA',
      '/admin/conta-oficial':            'Conta Oficial',
      '/admin/acessos':                  'Acessos',
      '/admin/whatsapp':                 'WhatsApp',
      '/admin/imagens':                  'Imagens IA',
      '/admin/wa-templates':            'Templates Meta',
      '/admin/tarefas':                  'Tarefas',
    };
    const label = PAGE_TITLES[location.pathname] ?? 'EGP Compras';
    document.title = `${label} — EGP Compras`;
  }, [location.pathname]);

  // Garante que o localStorage reflete modo manual + memoriza a última rota admin
  useEffect(() => {
    writeUIMode('manual');
  }, []);
  useEffect(() => {
    writeLastAdminRoute(location.pathname);
  }, [location.pathname]);

  // Fecha drawer mobile e reseta scroll da nav ao mudar de rota
  useEffect(() => {
    setMobileOpen(false);
    setConfigOpen(false);
    if (navRef.current) navRef.current.scrollTop = 0;
  }, [location.pathname]);

  // Atalhos globais:
  //   Cmd+M / Alt+M  → alterna pra Modo IA
  //   Cmd+K / Alt+K  → abre quick chat sem trocar modo (chat overlay)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.altKey;
      if (!meta) return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        writeUIMode('ai');
        navigate('/ia');
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        setQuickChatOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  // Fecha popover de config ao clicar fora
  useEffect(() => {
    if (!configOpen) return;
    function onClick(e: MouseEvent) {
      if (configRef.current && !configRef.current.contains(e.target as Node)) {
        setConfigOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [configOpen]);

  // Fecha drawer mobile ao apertar Esc
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  // Verifica se alguma rota de config está ativa pra destacar o botão
  const configNavLinks = userRole === 'admin' ? [...configLinks, accessLink] : [];
  const configActive = configNavLinks.some(
    (l) => l.to && location.pathname.startsWith(l.to)
  );

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      {/* Header global com toggle IA/Manual + hamburguer mobile */}
      <Header mode={mode} onMenuClick={() => setMobileOpen(true)} />

      <div className="flex flex-1 overflow-hidden">
        {/* Backdrop mobile (cobre o conteúdo quando drawer aberto) */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-900/40 md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar
            Mobile: fixed overlay (top-12 pra ficar abaixo do header global)
            Desktop: flex item normal (static, ocupa 256px à esquerda) */}
        <aside
          className={cn(
            'flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white transition-transform duration-200 2xl:w-64',
            'fixed top-12 bottom-0 left-0 z-50 md:static',
            mobileOpen
              ? 'translate-x-0 shadow-xl md:shadow-none'
              : '-translate-x-full md:translate-x-0 md:shadow-none'
          )}
        >
        <div className="hidden items-center justify-between gap-2 px-5 py-3 border-b border-slate-100 md:flex">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            painel interno
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-b border-slate-100 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav ref={navRef} className="flex-1 space-y-1 overflow-y-auto p-3">
          {/* Início — briefing diário */}
          <NavItemRow
            item={{
              to: '/admin',
              label: 'Início',
              description: 'Visão geral do dia',
              icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                </svg>
              ),
            }}
          />
          <div className="my-1 border-t border-slate-100" />
          {mainLinks.filter(sectionVisible).map((l) => {
            const filtered = filterChildren(l);
            return filtered.children ? (
              <NavGroup key={filtered.label} item={filtered} />
            ) : (
              <NavItemRow key={filtered.to ?? filtered.label} item={filtered} />
            );
          })}
          {/* RH — visível apenas para vitor@grupoegp e joane@grupoegp */}
          {isRhUser && (
            <>
              <div className="my-1 border-t border-slate-100" />
              <NavGroup
                item={{
                  label: 'RH',
                  description: 'Prestadores e pagamentos',
                  icon: (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                    </svg>
                  ),
                  children: [
                    {
                      to: '/admin/rh/prestadores',
                      label: 'Prestadores',
                      description: 'Cadastro e dados',
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                        </svg>
                      ),
                    },
                    {
                      to: '/admin/rh/calculos',
                      label: 'Cálculos',
                      description: 'Pagamentos mensais',
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008Zm0 2.25h.008v.008H8.25V13.5Zm0 2.25h.008v.008H8.25v-.008Zm0 2.25h.008v.008H8.25V18Zm2.498-6.75h.007v.008h-.007v-.008Zm0 2.25h.007v.008h-.007V13.5Zm0 2.25h.007v.008h-.007v-.008Zm0 2.25h.007v.008h-.007V18Zm2.504-6.75h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V13.5Zm0 2.25h.008v.008h-.008v-.008Zm4.498-6.75h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V13.5ZM8.25 6h7.5v2.25h-7.5V6ZM12 2.25c-1.892 0-3.758.11-5.593.322C5.307 2.7 4.5 3.498 4.5 4.507v11.985c0 1.012.81 1.814 1.814 1.814h11.372c1.004 0 1.814-.802 1.814-1.814V4.507c0-1.009-.807-1.807-1.907-1.935A48.507 48.507 0 0 0 12 2.25Z" />
                        </svg>
                      ),
                    },
                    {
                      to: '/admin/rh/historico',
                      label: 'Histórico',
                      description: 'Pagamentos anteriores',
                      icon: (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                      ),
                    },
                  ],
                }}
              />
            </>
          )}
        </nav>

        {/* Rodapé com popover de configurações */}
        <div ref={configRef} className="relative border-t border-slate-100 p-3">
          {configOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-2 space-y-1 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
              {configNavLinks.map((l) => (
                <NavItemRow key={l.to} item={l} onNavigate={() => setConfigOpen(false)} />
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setConfigOpen((o) => !o)}
            className={cn(
              'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors',
              configActive || configOpen
                ? 'bg-slate-100 text-slate-900'
                : 'text-slate-600 hover:bg-slate-100'
            )}
          >
            <span className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
              <span className="font-medium">Configurações</span>
            </span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={cn('h-4 w-4 transition-transform', configOpen && 'rotate-180')}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
            </svg>
          </button>
          <div className="mt-2 px-3 text-[10px] text-slate-400">v0.1.0 · EGP Tecnologia</div>
        </div>
      </aside>

        <main className="flex-1 min-h-0 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Botão flutuante de chat IA (modo Manual) — escondido em páginas com input no rodapé */}
      {!quickChatOpen && location.pathname !== '/admin/whatsapp' && (
        <button
          type="button"
          onClick={() => setQuickChatOpen(true)}
          aria-label="Abrir EGP (Cmd+K)"
          title="Abrir EGP (Cmd+K)"
          className="fixed bottom-5 right-5 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition-all hover:bg-brand-700 hover:shadow-xl"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
          </svg>
        </button>
      )}

      {/* Drawer do chat IA — overlay sobre o conteúdo, sem sair da página */}
      {quickChatOpen && <QuickChatDrawer onClose={() => setQuickChatOpen(false)} />}
    </div>
  );
}
