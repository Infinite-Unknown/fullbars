// Builds the Round 1 ad from the recorded clips: synthetic voice-over (macOS `say`),
// caption overlays rendered from video/cards.html, cut and joined with ffmpeg.
// Usage: node video/build.mjs [baseUrl]   ->  assets/demo.mp4
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SEGMENTS, VOICE, RATE } from './script.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5243/';
const W = fileURLToPath(new URL('./work/', import.meta.url));
const OUT = fileURLToPath(new URL('../assets/demo.mp4', import.meta.url));
for (const d of ['vo', 'cap', 'seg']) mkdirSync(W + d, { recursive: true });
const run = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

// 1. voice-over per segment
for (const s of SEGMENTS) {
  const aiff = `${W}vo/${s.id}.aiff`;
  execFileSync('say', ['-v', VOICE, '-r', String(RATE), '-o', aiff, s.vo]);
  run(['-i', aiff, '-ar', '48000', '-ac', '2', `${W}vo/${s.id}.wav`]);
}

// 2. captions as transparent PNGs, drawn in the app's own type
const browser = await chromium.launch({ args: ['--use-mock-keychain', '--password-store=basic'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const s of SEGMENTS) {
  if (!s.cap) continue;
  await page.goto(`${BASE}video/cards.html?card=cap&cap=${encodeURIComponent(s.cap)}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${W}cap/${s.id}.png`, omitBackground: true });
}
await browser.close();

// 3. one MP4 per segment: footage from `from`, length = voice + breathing room, captions over it
const parts = [];
let t = 0;
const timeline = [];
for (const s of SEGMENTS) {
  const vo = dur(`${W}vo/${s.id}.wav`);
  const lead = s.lead ?? 0.25; // footage before the voice starts
  const len = Math.max(s.min, lead + vo + 0.45);
  const clip = `${W}clips/${s.clip}.mp4`;
  if (!existsSync(clip)) throw new Error(`missing clip ${clip}`);
  const out = `${W}seg/${s.id}.mp4`;
  const inputs = ['-ss', String(s.from), '-i', clip, '-i', `${W}vo/${s.id}.wav`];
  // pad with the last frame when the footage is shorter than the segment
  let v = `[0:v]tpad=stop_mode=clone:stop_duration=${len},trim=duration=${len},setpts=PTS-STARTPTS,fps=30,format=yuv420p`;
  v += `,fade=t=in:st=0:d=0.18,fade=t=out:st=${(len - 0.18).toFixed(2)}:d=0.18[v0]`;
  let last = 'v0';
  if (s.cap) {
    inputs.push('-loop', '1', '-t', String(len), '-i', `${W}cap/${s.id}.png`);
    v += `;[2:v]format=rgba,fade=t=in:st=${lead.toFixed(2)}:d=0.25:alpha=1,fade=t=out:st=${(len - 0.35).toFixed(2)}:d=0.25:alpha=1[c];[v0][c]overlay=0:0:format=auto[v1]`;
    last = 'v1';
  }
  const a = `[1:a]adelay=${Math.round(lead * 1000)}|${Math.round(lead * 1000)},apad,atrim=duration=${len}[a]`;
  run([...inputs, '-filter_complex', `${v};${a}`, '-map', `[${last}]`, '-map', '[a]',
    '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', String(len), out]);
  parts.push(out);
  timeline.push({ id: s.id, start: +t.toFixed(2), len: +len.toFixed(2), vo: s.vo, cap: s.cap ?? null });
  t += len;
}

// 4. join
writeFileSync(`${W}seg/list.txt`, parts.map((p) => `file '${p}'`).join('\n'));
run(['-f', 'concat', '-safe', '0', '-i', `${W}seg/list.txt`, '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-movflags', '+faststart', OUT]);
writeFileSync(fileURLToPath(new URL('./timeline.json', import.meta.url)), JSON.stringify(timeline, null, 1));
console.log(`demo.mp4: ${dur(OUT).toFixed(1)} s, ${SEGMENTS.length} segments`);
