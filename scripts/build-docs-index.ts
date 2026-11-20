/** content/docs/*.md → src/agent/docs-index.json (chunks by heading for client-side BM25 search). */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const chunks: { id: string; doc: string; title: string; text: string }[] = [];
for (const f of readdirSync('content/docs').filter((x) => x.endsWith('.md')).sort()) {
  const doc = f.replace(/\.md$/, '');
  const md = readFileSync(`content/docs/${f}`, 'utf8');
  let title = doc, buf: string[] = [];
  const push = () => { const text = buf.join('\n').trim(); if (text) chunks.push({ id: `${doc}#${chunks.length}`, doc, title, text }); buf = []; };
  for (const line of md.split('\n')) {
    const h = line.match(/^#{1,3}\s+(.*)/);
    if (h) { push(); title = h[1]; } else buf.push(line);
  }
  push();
}
writeFileSync('src/agent/docs-index.json', JSON.stringify(chunks, null, 1) + '\n');
console.log(`docs-index: ${chunks.length} chunks`);
