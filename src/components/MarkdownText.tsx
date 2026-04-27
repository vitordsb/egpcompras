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
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 underline hover:text-brand-700"
            >
              {children}
            </a>
          ),
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
