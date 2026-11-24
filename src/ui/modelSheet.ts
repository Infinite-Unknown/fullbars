import { BAR_LABEL, THRESHOLDS, type Bars } from '../model/classes';
import { BAND_GHZ, MATERIALS, MATERIAL_ORDER, wallLossDb } from '../model/materials';
import { fsplDb } from '../model/propagation';
import type { MaterialId, ModelSettings } from '../model/types';
import { barsGlyph } from './icons';

export function renderModelSheet(host: HTMLElement, s: ModelSettings, onChange: (s: ModelSettings) => void): void {
  const f = BAND_GHZ[s.band];
  const fspl1 = fsplDb(1, f * 1000);
  const rows = MATERIAL_ORDER.map((id) => {
    const m = MATERIALS[id];
    const mm = Math.round(s.thicknessM[id] * 1000 * 10) / 10;
    const l24 = wallLossDb(id, '2.4', s.thicknessM[id]);
    const l5 = wallLossDb(id, '5', s.thicknessM[id]);
    return `<tr>
      <td>${m.label}<small>${m.layers > 1 ? `${m.layers} layers, ` : ''}ε′ = ${m.a}, σ = ${m.c}·f<sup>${m.d}</sup> S/m</small></td>
      <td class="num"><label class="visually-hidden" for="th-${id}">${m.label} thickness in millimetres</label><input type="number" id="th-${id}" data-mat="${id}" min="1" max="500" step="0.5" value="${mm}"> mm</td>
      <td class="num">${l24.toFixed(1)} dB</td>
      <td class="num">${l5.toFixed(1)} dB</td>
    </tr>`;
  }).join('');

  const thr: [Bars, string, string][] = [
    [4, `≥ ${THRESHOLDS[0]} dBm`, 'Cisco Voice over WLAN design guide: cell edge for voice and video'],
    [3, `≥ ${THRESHOLDS[1]} dBm`, 'IEEE 802.11 OFDM minimum receiver sensitivity at 24 Mbit/s'],
    [2, `≥ ${THRESHOLDS[2]} dBm`, 'Same table, 12 Mbit/s'],
    [1, `≥ ${THRESHOLDS[3]} dBm`, 'Same table, 6 Mbit/s, the slowest OFDM rate'],
    [0, `< ${THRESHOLDS[3]} dBm`, 'Below what a standard receiver must decode'],
  ];
  const thrRows = thr
    .map(([b, lvl, src]) => `<tr><td>${barsGlyph(b)}</td><td>${BAR_LABEL[b]}</td><td class="num">${lvl.replace('-', '−')}</td><td><small>${src}</small></td></tr>`)
    .join('');

  host.innerHTML = `
    <p>FullBars draws a straight line from the router to every point on the plan, adds up the loss along it, and colours the point by the level that is left. It is a prediction from published physics and measurements, not a site survey.</p>
    <div class="formula">
      <b>Received level</b> = EIRP − FSPL(1 m) − 10·n·log<sub>10</sub>(distance) − Σ wall losses<br>
      Now: ${s.eirpDbm} dBm − ${fspl1.toFixed(1)} dB − ${(10 * s.exponent).toFixed(0)}·log<sub>10</sub>(d) − walls, at ${f.toFixed(3)} GHz
    </div>

    <h3>Router and space</h3>
    <div class="field"><label for="eirp">Router power (EIRP)<small>20 dBm is the 2.4 GHz limit in ETSI EN 300 328. Check your router's spec sheet.</small></label><span><input type="number" id="eirp" min="0" max="36" step="1" value="${s.eirpDbm}"> dBm</span></div>
    <div class="field"><label for="exp">Distance exponent n<small>2 is free space. 3 was fitted from measurements in a building with walls counted separately (Kang and Seo, 2020).</small></label><span><input type="number" id="exp" min="1.6" max="4" step="0.1" value="${s.exponent}"></span></div>

    <h3>Wall loss per material</h3>
    <p>Computed from each material's measured electrical properties with the single-layer slab method of ITU-R P.2040-4, for a wave hitting the wall head-on. Change a thickness to match your walls.</p>
    <table>
      <thead><tr><th>Material</th><th class="num">Thickness</th><th class="num">2.4 GHz</th><th class="num">5 GHz</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <h3>What the bars mean</h3>
    <table>
      <thead><tr><th></th><th>Bars</th><th class="num">Level</th><th>Source</th></tr></thead>
      <tbody>${thrRows}</tbody>
    </table>
    <p>The coverage score is the share of the floor with 3 bars or more.</p>

    <h3>Limits, stated plainly</h3>
    <ul class="limits">
      <li>Straight lines only. No reflections, no bending round corners, so real signal near doorways is often a little better than shown.</li>
      <li>No furniture, people, appliances or neighbours' networks.</li>
      <li>Every wall is hit head-on. Walls crossed at a slant lose more in reality.</li>
      <li>One floor. One router.</li>
      <li>It ranks router positions well; it does not promise a speed.</li>
    </ul>

    <h3>Sources</h3>
    <ol class="sources">
      <li>ITU-R Recommendation P.2040-4 (09/2025), Effects of building materials and structures on radio-wave propagation. Table 3 (material properties) and eqs. (43b), (44), (57)-(59).</li>
      <li>3GPP TR 38.901 V19.5.0 (2026-09), Table 7.4.3-1, material penetration loss. Used as a cross-check: concrete agrees within 15%.</li>
      <li>COST Action 231 multi-wall model (Motley-Keenan form): free-space term plus the loss of each wall crossed.</li>
      <li>T. Kang and J. Seo, "Practical Simplified Indoor Multiwall Path-Loss Model", ICCAS 2020. Path-loss exponent 3 fitted at 2.45 GHz.</li>
      <li>ITU-R P.1238-13 (09/2025): its distance coefficients already include walls, so they are not used together with explicit walls.</li>
      <li>IEEE Std 802.11, OFDM PHY receiver minimum input sensitivity (6, 12, 24 Mbit/s: −82, −79, −74 dBm).</li>
      <li>Cisco Voice over Wireless LAN 4.1 Design Guide, ch. 3: −67 dBm cell edge.</li>
      <li>ETSI EN 300 328: 20 dBm EIRP limit at 2.4 GHz.</li>
    </ol>
  `;

  const commit = (patch: Partial<ModelSettings>) => onChange({ ...s, ...patch });
  host.querySelector<HTMLInputElement>('#eirp')!.addEventListener('change', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) commit({ eirpDbm: Math.max(0, Math.min(36, v)) });
  });
  host.querySelector<HTMLInputElement>('#exp')!.addEventListener('change', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) commit({ exponent: Math.max(1.6, Math.min(4, v)) });
  });
  host.querySelectorAll<HTMLInputElement>('input[data-mat]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v) || v <= 0) return;
      const id = inp.dataset.mat as MaterialId;
      commit({ thicknessM: { ...s.thicknessM, [id]: Math.min(500, v) / 1000 } });
    });
  });
}
