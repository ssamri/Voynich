import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none prose-headings:font-display prose-headings:text-parch-50 prose-p:text-parch-100 prose-strong:text-parch-50 prose-code:text-gold-300 prose-code:before:content-none prose-code:after:content-none prose-a:text-gold-400 prose-li:text-parch-100 prose-table:text-xs prose-th:text-parch-200 prose-td:text-parch-100">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
