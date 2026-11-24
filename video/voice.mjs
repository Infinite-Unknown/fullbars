// Voice-over: one WAV per line of script.mjs, made with the Kokoro text-to-speech model.
// Usage: node video/voice.mjs [id ...]
// Needs KOKORO_PY (python with kokoro_onnx) and TTS_SCRIPT, or the default paths below.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LINES, VOICE, SPEED } from './script.mjs';

const WORKSPACE = fileURLToPath(new URL('../../../', import.meta.url));
const PY = process.env.KOKORO_PY ?? `${WORKSPACE}tools/kokoro/.venv/bin/python`;
const TTS = process.env.TTS_SCRIPT ?? `${WORKSPACE}scripts/tts.py`;
const OUT = fileURLToPath(new URL('./work/v2/vo/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const only = process.argv.slice(2);
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
const lens = {};
for (const [id, text] of Object.entries(LINES)) {
  const wav = `${OUT}${id}.wav`;
  if (!only.length || only.includes(id)) {
    execFileSync(PY, ['-I', TTS, text, wav, '--voice', VOICE, '--speed', String(SPEED)], { stdio: 'ignore' });
  }
  lens[id] = +dur(wav).toFixed(2);
}
writeFileSync(`${OUT}lengths.json`, JSON.stringify(lens, null, 1));
console.log(lens, 'total', Object.values(lens).reduce((a, b) => a + b, 0).toFixed(1));
