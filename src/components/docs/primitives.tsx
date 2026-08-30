import React from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

/** Callout box. tone: note (AI/violet) | warn | ok | danger. */
export function Callout({
  tone = 'note',
  children,
}: {
  tone?: 'note' | 'warn' | 'ok' | 'danger';
  children: React.ReactNode;
}) {
  const Icon = tone === 'warn' ? AlertTriangle : tone === 'ok' ? CheckCircle2 : tone === 'danger' ? XCircle : Info;
  return (
    <div className={`docs-callout is-${tone}`}>
      <Icon aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/** ASCII diagram inside a styled monospace block. */
export function Diagram({ lines }: { lines: string[] }) {
  return (
    <pre>
      <code>
        {lines.map((line, i) => (
          <React.Fragment key={i}>
            {line}
            {i < lines.length - 1 ? '\n' : ''}
          </React.Fragment>
        ))}
      </code>
    </pre>
  );
}

/** Small inline status chip. tone: ai (violet) | private (orange) | live (green) | warn (amber). */
export function Chip({ tone, children }: { tone?: 'ai' | 'private' | 'live' | 'warn'; children: React.ReactNode }) {
  return <span className={`docs-chip${tone ? ` is-${tone}` : ''}`}>{children}</span>;
}

/** Ordered step list. */
export function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="docs-steps">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}