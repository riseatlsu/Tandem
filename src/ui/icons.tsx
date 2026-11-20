import type { SVGProps } from 'react';

const P = (d: string | string[], extra?: SVGProps<SVGSVGElement>) => (props: SVGProps<SVGSVGElement>) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...extra} {...props}>
    {(Array.isArray(d) ? d : [d]).map((x, i) => <path key={i} d={x} />)}
  </svg>
);
export const Icon = {
  play: (p: SVGProps<SVGSVGElement>) => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}><path d="M7 4.8v14.4c0 .8.9 1.3 1.6.9l11.5-7.2c.6-.4.6-1.4 0-1.8L8.6 3.9C7.9 3.5 7 4 7 4.8z" /></svg>,
  pause: P(['M8 5v14', 'M16 5v14'], { strokeWidth: 3 }),
  step: P(['M6 5l8 7-8 7', 'M18 5v14']),
  stop: (p: SVGProps<SVGSVGElement>) => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>,
  reset: P(['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5']),
  home: P(['M3 11l9-7 9 7', 'M5 10v10h14V10']),
  hand: P(['M8 13V5.5a1.5 1.5 0 0 1 3 0V12', 'M11 11.5V4a1.5 1.5 0 0 1 3 0v8', 'M14 11V5.5a1.5 1.5 0 0 1 3 0V13', 'M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1.5a6 6 0 0 1-4.6-2.2L4 16.5a1.6 1.6 0 0 1 2.3-2.2L8 16']),
  target: P(['M12 2v4', 'M12 18v4', 'M2 12h4', 'M18 12h4', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z']),
  eye: P(['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z']),
  camera: P(['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7']),
  send: (p: SVGProps<SVGSVGElement>) => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}><path d="M3.4 20.4l17.5-7.5c.8-.4.8-1.5 0-1.8L3.4 3.6c-.7-.3-1.4.3-1.3 1l1.2 6.1c.1.4.4.7.8.8L12 12l-7.9.5c-.4 0-.7.4-.8.8l-1.2 6.1c-.1.7.6 1.3 1.3 1z" /></svg>,
  sparkle: P(['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z']),
  check: P('M5 12.5l4.5 4.5L19 7.5', { strokeWidth: 3 }),
  x: P(['M6 6l12 12', 'M18 6L6 18']),
  trash: P(['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13']),
  edit: P(['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4']),
  plus: P(['M12 5v14', 'M5 12h14']),
  go: P(['M5 12h14', 'M13 6l6 6-6 6']),
  timer: P(['M12 8v5l3 2', 'M9 2h6', 'M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z']),
  grip: P(['M8 3v6a4 4 0 0 0 8 0V3', 'M12 13v8', 'M8 21h8']),
  code: P(['M8 7l-5 5 5 5', 'M16 7l5 5-5 5']),
  blocks: P(['M4 4h7v7H4z', 'M13 13h7v7h-7z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z']),
  rotate: P(['M20 12a8 8 0 1 1-2.3-5.7', 'M20 4v4h-4']),
  move: P(['M12 2v20', 'M2 12h20', 'M9 5l3-3 3 3', 'M9 19l3 3 3-3', 'M5 9l-3 3 3 3', 'M19 9l3 3-3 3']),
  info: P(['M12 8h.01', 'M11 12h1v5h1', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z']),
  skip: P(['M5 5l9 7-9 7z', 'M19 5v14']),
  arm: P(['M4 20h8', 'M8 20v-4l5-8 6 3', 'M19 11l2-1', 'M19 11l1 2']),
  chevron: P('M9 6l6 6-6 6'),
};
