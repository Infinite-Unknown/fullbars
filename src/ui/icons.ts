import type { Bars } from '../model/classes';

export const BAR_COLOR: Record<Bars, string> = {
  4: '#0b3bf5',
  3: '#4f74ff',
  2: '#9db1ff',
  1: '#d6deff',
  0: '#ff4a1c',
};

/** The mark: the corner of a floor plan with signal bars rising inside it. */
export function logoSvg(): string {
  const bars = [5, 9, 13, 17]
    .map((h, i) => {
      const x = 9.5 + i * 5;
      const fill = i === 3 ? '#0b3bf5' : '#121417';
      return `<rect x="${x}" y="${24 - h}" width="3.4" height="${h}" rx="0.6" fill="${fill}"/>`;
    })
    .join('');
  return `<path d="M4.5 3v24.5H29" fill="none" stroke="#121417" stroke-width="3" stroke-linecap="square"/>${bars}`;
}

/** A four-bar signal glyph with `n` bars lit in the class colour. Width 24, height 18. */
export function barsGlyph(n: Bars, opts: { dark?: boolean } = {}): string {
  const off = opts.dark ? '#3a3f46' : '#dcdfe3';
  const on = BAR_COLOR[n];
  let s = '';
  for (let i = 0; i < 4; i++) {
    const h = 5 + i * 4;
    const lit = i < n;
    const fill = lit ? on : off;
    const stroke = lit && n === 1 && !opts.dark ? ' stroke="#9db1ff" stroke-width="0.8"' : '';
    s += `<rect x="${1 + i * 6}" y="${17 - h}" width="4" height="${h}" rx="0.8" fill="${fill}"${stroke}/>`;
  }
  if (n === 0) {
    s += `<path d="M2 16.5L22 1.5" stroke="${BAR_COLOR[0]}" stroke-width="2" stroke-linecap="round"/>`;
  }
  return `<svg viewBox="0 0 24 18" aria-hidden="true">${s}</svg>`;
}
