import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import queriesMd from '../../QUERIES.md?raw'

export function QueryDocs() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold text-ch-text mb-2 pb-3 border-b border-ch-border">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-bold text-ch-accent mt-10 mb-3 flex items-center gap-2">
              <span className="w-1 h-5 bg-ch-accent rounded-full inline-block" />
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-ch-muted uppercase tracking-wider mt-6 mb-2">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="text-sm text-ch-text leading-relaxed mb-3">{children}</p>
          ),
          a: ({ href, children }) => (
            <a href={href} className="text-ch-accent hover:underline">{children}</a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-white">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-ch-muted">{children}</em>
          ),
          hr: () => <hr className="border-ch-border my-8" />,
          ul: ({ children }) => (
            <ul className="list-disc list-inside text-sm text-ch-text space-y-1 mb-3 ml-2">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside text-sm text-ch-text space-y-1 mb-3 ml-2">{children}</ol>
          ),
          li: ({ children }) => <li className="text-ch-text">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-ch-accent/40 pl-4 my-3 text-ch-muted italic text-sm">
              {children}
            </blockquote>
          ),
          code: ({ children, className }) => {
            const isBlock = className?.startsWith('language-')
            if (isBlock) {
              return (
                <code className="block bg-ch-bg border border-ch-border rounded-lg px-4 py-3 text-xs font-mono text-green-300 leading-relaxed overflow-x-auto whitespace-pre">
                  {children}
                </code>
              )
            }
            return (
              <code className="bg-ch-bg border border-ch-border rounded px-1.5 py-0.5 text-xs font-mono text-ch-accent">
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className="mb-4 mt-1">{children}</pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-xs border-collapse border border-ch-border rounded-lg overflow-hidden">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-ch-surface">{children}</thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-ch-border">{children}</tbody>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-ch-surface/50 transition-colors">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="text-left px-3 py-2 font-semibold text-ch-muted uppercase tracking-wider border-b border-ch-border">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-ch-text border-ch-border">{children}</td>
          ),
        }}
      >
        {queriesMd}
      </ReactMarkdown>
    </div>
  )
}
