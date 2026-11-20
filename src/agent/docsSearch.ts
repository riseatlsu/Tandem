import index from './docs-index.json';

interface Chunk { id: string; doc: string; title: string; text: string }
const chunks = index as Chunk[];
const tok = (s: string) => s.toLowerCase().match(/[a-z0-9_.]+/g) ?? [];
const docs = chunks.map((c) => tok(`${c.title} ${c.title} ${c.text}`));
const avgdl = docs.reduce((a, d) => a + d.length, 0) / docs.length;
const df = new Map<string, number>();
for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);

/** BM25 over the bundled API/concept docs. */
export function searchDocs(query: string, k = 5): Chunk[] {
  const q = tok(query);
  const N = docs.length, k1 = 1.4, b = 0.75;
  const scored = docs.map((d, i) => {
    let s = 0;
    for (const t of q) {
      const f = d.filter((x) => x === t).length;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgdl)));
    }
    return { i, s };
  });
  return scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k).map((x) => chunks[x.i]);
}
