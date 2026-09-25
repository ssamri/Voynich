import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-display prose-headings:text-fg-50 prose-p:text-fg-100 prose-strong:text-fg-50 prose-code:text-primary-300 prose-code:before:content-none prose-code:after:content-none prose-a:text-primary-400 prose-li:text-fg-100 prose-table:text-xs prose-th:text-fg-200 prose-td:text-fg-100">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
