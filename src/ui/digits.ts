/**
 * A number shown in fixed tabular cells; each digit rolls to its new value.
 * Three cells (0-100). The leading cells collapse when they are not needed.
 */
export class RollingNumber {
  private cells: { root: HTMLElement; strip: HTMLElement }[] = [];
  private value = -1;

  constructor(private host: HTMLElement, cells = 3) {
    for (let i = 0; i < cells; i++) {
      const root = document.createElement('span');
      root.className = 'digit';
      const strip = document.createElement('span');
      strip.className = 'digit-strip';
      for (let d = 0; d <= 9; d++) {
        const s = document.createElement('span');
        s.textContent = String(d);
        strip.appendChild(s);
      }
      root.appendChild(strip);
      host.appendChild(root);
      this.cells.push({ root, strip });
    }
  }

  set(v: number, instant = false): void {
    const n = Math.max(0, Math.min(10 ** this.cells.length - 1, Math.round(v)));
    if (n === this.value && !instant) return;
    const prevLen = this.value < 0 ? 0 : String(this.value).length;
    this.value = n;
    const s = String(n).padStart(this.cells.length, ' ');
    this.cells.forEach((c, i) => {
      const ch = s[i];
      const hidden = ch === ' ';
      c.root.dataset.hidden = String(hidden);
      c.strip.style.setProperty('--v', hidden ? '0' : ch);
      c.strip.style.setProperty('--delay', `${(this.cells.length - 1 - i) * 40}ms`);
      if (instant) {
        c.strip.style.transition = 'none';
        void c.strip.offsetHeight;
        c.strip.style.transition = '';
      }
    });
    this.host.setAttribute('data-len', String(String(n).length || prevLen));
  }
}
