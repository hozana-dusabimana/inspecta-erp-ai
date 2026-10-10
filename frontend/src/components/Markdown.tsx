import React from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Styled Markdown for AI replies: headings, bold, lists, tables, code — compact chat sizing. */
const components: Components = {
  h1: (p) => <h3 className="font-display text-sm font-extrabold text-brand-primary mt-3 mb-1.5 first:mt-0" {...p} />,
  h2: (p) => <h3 className="font-display text-sm font-extrabold text-brand-primary mt-3 mb-1.5 first:mt-0" {...p} />,
  h3: (p) => <h4 className="font-display text-xs font-extrabold text-brand-primary mt-3 mb-1 first:mt-0" {...p} />,
  h4: (p) => <h4 className="text-xs font-bold text-brand-primary mt-2 mb-1 first:mt-0" {...p} />,
  p: (p) => <p className="my-1.5 first:mt-0 last:mb-0" {...p} />,
  strong: (p) => <strong className="font-extrabold text-brand-primary" {...p} />,
  em: (p) => <em className="italic" {...p} />,
  ul: (p) => <ul className="my-1.5 ml-4 list-disc space-y-1 marker:text-brand-secondary-container" {...p} />,
  ol: (p) => <ol className="my-1.5 ml-4 list-decimal space-y-1 marker:font-bold marker:text-brand-secondary-container" {...p} />,
  li: (p) => <li className="pl-0.5" {...p} />,
  hr: () => <hr className="my-3 border-brand-outline-variant/30" />,
  a: (p) => <a className="underline text-brand-secondary font-semibold" target="_blank" rel="noreferrer noopener" {...p} />,
  blockquote: (p) => <blockquote className="my-2 border-l-2 border-brand-secondary-container/50 pl-3 text-brand-on-surface-variant" {...p} />,
  code: ({ className, children, ...rest }) =>
    className ? (
      <code className="block my-2 p-2.5 rounded-lg bg-brand-surface border border-brand-outline-variant/30 text-[11px] font-mono overflow-x-auto whitespace-pre" {...rest}>{children}</code>
    ) : (
      <code className="px-1 py-0.5 rounded bg-brand-surface border border-brand-outline-variant/20 text-[11px] font-mono" {...rest}>{children}</code>
    ),
  table: (p) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-brand-outline-variant/30">
      <table className="w-full text-[11px] border-collapse" {...p} />
    </div>
  ),
  thead: (p) => <thead className="bg-brand-surface" {...p} />,
  th: (p) => <th className="text-left font-extrabold text-brand-primary px-2.5 py-1.5 border-b border-brand-outline-variant/30 whitespace-nowrap" {...p} />,
  td: (p) => <td className="px-2.5 py-1.5 border-b border-brand-outline-variant/15 align-top" {...p} />,
};

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="text-xs leading-relaxed font-medium break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
    </div>
  );
}
