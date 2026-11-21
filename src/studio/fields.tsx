/** Small form controls for Tandem Studio. */
import { useEffect, useState, type ReactNode } from 'react';

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={`sf ${wide ? 'wide' : ''}`}><span className="sf-l">{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}
export function Text({ value, onChange, placeholder, mono }: { value: string | undefined; onChange(v: string): void; placeholder?: string; mono?: boolean }) {
  return <input className={`field ${mono ? 'mono' : ''}`} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}
export function Area({ value, onChange, rows = 4, mono, placeholder }: { value: string | undefined; onChange(v: string): void; rows?: number; mono?: boolean; placeholder?: string }) {
  return <textarea className={`field area ${mono ? 'mono' : ''}`} rows={rows} value={value ?? ''} placeholder={placeholder} spellCheck={!mono} onChange={(e) => onChange(e.target.value)} />;
}
/** Number input that tolerates partial typing ("-", "1.") without fighting the user. */
export function Num({ value, onChange, step = 1, min, max, placeholder }: { value: number | undefined; onChange(v: number | undefined): void; step?: number; min?: number; max?: number; placeholder?: string }) {
  const [txt, setTxt] = useState(value === undefined ? '' : String(value));
  useEffect(() => { if (value === undefined ? txt !== '' : Number(txt) !== value) setTxt(value === undefined ? '' : String(value)); }, [value]);  
  return <input className="field num" type="number" step={step} min={min} max={max} value={txt} placeholder={placeholder}
    onChange={(e) => { setTxt(e.target.value); const v = e.target.value === '' ? undefined : Number(e.target.value); if (v === undefined || Number.isFinite(v)) onChange(v); }} />;
}
export function Vec3({ value, onChange, step = 1, labels = ['x', 'y', 'z'] }: { value: [number, number, number] | undefined; onChange(v: [number, number, number]): void; step?: number; labels?: string[] }) {
  const v = value ?? [0, 0, 0];
  return <span className="vec3">{v.map((x, i) => <span key={i}><i>{labels[i]}</i><Num value={x} step={step} onChange={(n) => { const c = [...v] as [number, number, number]; c[i] = n ?? 0; onChange(c); }} /></span>)}</span>;
}
export function Select<T extends string>({ value, onChange, options, allowEmpty }: { value: T | undefined; onChange(v: T): void; options: (T | { value: T; label: string })[]; allowEmpty?: string }) {
  return (
    <select className="field" value={value ?? ''} onChange={(e) => onChange(e.target.value as T)}>
      {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
      {options.map((o) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
export function Check({ value, onChange, label }: { value: boolean | undefined; onChange(v: boolean): void; label: string }) {
  return <label className="sf-check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {label}</label>;
}
export function Color({ value, onChange }: { value: string | undefined; onChange(v: string | undefined): void }) {
  const named = value && !value.startsWith('#');
  return (
    <span className="color-f">
      <input type="color" value={named || !value ? '#dfe7ef' : value} onChange={(e) => onChange(e.target.value)} />
      <input className="field" value={value ?? ''} placeholder="default" onChange={(e) => onChange(e.target.value || undefined)} />
    </span>
  );
}
/** Remove keys whose value is undefined, '' or an empty object (keeps exported JSON tidy). */
export function tidy<T>(v: T): T {
  if (Array.isArray(v)) return v.map(tidy) as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const t = tidy(x);
      if (t === undefined || t === '' || (t && typeof t === 'object' && !Array.isArray(t) && !Object.keys(t).length)) continue;
      o[k] = t;
    }
    return o as T;
  }
  return v;
}
