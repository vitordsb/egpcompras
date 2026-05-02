import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  text: string;
}

// Renderer minimalista pras respostas do modelo. Não suporta HTML cru
// (segurança via padrão do react-markdown), só markdown padrão + GFM
// (listas, tabelas, autolinks).
export default function MarkdownText({ text }: Props) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-slate-900">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => (
            <ul className="mb-2 last:mb-0 list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 last:mb-0 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          code: ({ children }) => (
            <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="mb-2 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
              {children}
            </pre>
          ),
          img: ({ src, alt }) => {
            const isGenerated = src && (
              src.includes('/wa-images/') || src.includes('fal.media') || src.includes('/object/public/wa-images')
            );
            if (isGenerated) {
              return (
                <div className="my-3 max-w-sm overflow-hidden rounded-xl border border-violet-200 shadow-sm">
                  <img src={src} alt={alt ?? 'imagem gerada'} className="w-full object-cover" />
                  <div className="flex items-center gap-2 bg-violet-50 px-3 py-2">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5 shrink-0 text-violet-500">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                    </svg>
                    <span className="text-xs text-violet-700 font-medium">Imagem gerada por IA — aguardando aprovação</span>
                    <a href={src} target="_blank" rel="noreferrer" className="ml-auto text-[10px] text-violet-500 hover:underline">abrir</a>
                  </div>
                </div>
              );
            }
            return <img src={src} alt={alt ?? ''} className="max-w-full rounded" />;
          },
          a: ({ href, children }) => {
            const isQuoteLink = href && /\/cotacao\//.test(href);
            if (isQuoteLink) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="my-2 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 no-underline transition-colors hover:bg-green-100 active:bg-green-200"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-600 text-white shadow-sm">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-green-800">Abrir formulário de cotação</span>
                    <span className="block truncate text-xs text-green-600">{href}</span>
                  </span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0 text-green-500">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" className="text-brand-600 underline hover:text-brand-700">
                {children}
              </a>
            );
          },
          h1: ({ children }) => (
            <h1 className="mb-2 text-base font-semibold text-slate-900">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 text-sm font-semibold text-slate-900">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1 text-sm font-semibold text-slate-900">{children}</h3>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-slate-300 pl-3 text-slate-600">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-slate-200 bg-slate-50">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-2 py-1 text-left font-medium text-slate-600">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-b border-slate-100 px-2 py-1">{children}</td>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
