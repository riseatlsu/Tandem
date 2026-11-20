import { Fragment, type ReactNode } from 'react';

/** Minimal, safe markdown → React (no innerHTML): paragraphs, lists, **bold**, *em*, `code`, ```blocks```. */
function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0, m: RegExpExecArray | null, k = key;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('`')) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const parts = text.split(/```(\w*)\n?([\s\S]*?)```/g);
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 1) continue;
    if (i % 3 === 2) { blocks.push(<pre key={`c${i}`}><code>{parts[i].replace(/\n$/, '')}</code></pre>); continue; }
    const paras = parts[i].split(/\n{2,}/);
    paras.forEach((p, j) => {
      const lines = p.split('\n').filter((l) => l.trim() !== '');
      if (!lines.length) return;
      if (lines.every((l) => /^\s*(\d+\.|[-*•])\s+/.test(l))) {
        const ordered = /^\s*\d+\./.test(lines[0]);
        const items = lines.map((l, k) => <li key={k}>{inline(l.replace(/^\s*(\d+\.|[-*•])\s+/, ''))}</li>);
        blocks.push(ordered ? <ol key={`l${i}-${j}`}>{items}</ol> : <ul key={`l${i}-${j}`}>{items}</ul>);
      } else {
        blocks.push(<p key={`p${i}-${j}`}>{lines.map((l, k) => <Fragment key={k}>{k > 0 && <br />}{inline(l)}</Fragment>)}</p>);
      }
    });
  }
  return <>{blocks}</>;
}
