// Cuts the Round 1 video from the recorded clips (record.mjs), the Blender title shot and the
// Kokoro voice-over (voice.mjs): captions that fade, short cross-dissolves, voice placed at the
// marks the recorder logged, loudness normalised to -16 LUFS.
// Usage: node video/build.mjs   ->  assets/demo.mp4 (1920x1080, 60 fps) and assets/demo-upload.mp4 (< 9.5 MB)
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const W = fileURLToPath(new URL('./work/v2/', import.meta.url));
const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url));
const FRAMES_3D = fileURLToPath(new URL('./work/3d/frames60/', import.meta.url));
const OUT = `${ASSETS}demo.mp4`;
const UPLOAD = `${ASSETS}demo-upload.mp4`;
const VO = JSON.parse(readFileSync(`${W}vo/lengths.json`, 'utf8'));
const FPS = 60;
const X = 0.3; // cross-dissolve between shots, seconds
mkdirSync(`${W}seg`, { recursive: true });

const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const ffOut = (args) => spawnSync('ffmpeg', ['-y', '-hide_banner', ...args], { encoding: 'utf8' }).stderr; // loudnorm reports on stderr
const probeDur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
const clipInfo = (name) => JSON.parse(readFileSync(`${W}clips/${name}.json`, 'utf8'));
const markAt = (name, id) => {
  const info = clipInfo(name);
  if (!(id in info.marks)) throw new Error(`no mark ${id} in ${name}`);
  return info.marks[id] / info.fps;
};

// Shots in order. vo: [line id, seconds into the shot]; caps: [caption id, start, end] (seconds into the shot).
// Every `vo:<line>` mark the recorder logged places that line; cards and the 3D shot set theirs here.
const voFromMarks = (name, lead = 0.12) => Object.entries(clipInfo(name).marks)
  .filter(([k]) => k.startsWith('vo:')).map(([k, f]) => [k.slice(3), f / FPS + lead]);
const SHOTS = [
  { clip: 'hook', vo: voFromMarks('hook', 0.3) },
  { frames3d: true, len: 5.6, vo: [['title', 0.3]], caps: [['walls3d', 0.4, 5.2]] },
  { clip: 'card-logo', vo: [['name', 1.2]] },
  { clip: 'setup', vo: voFromMarks('setup') },
  { clip: 'probe', vo: voFromMarks('probe') },
  { clip: 'find', vo: voFromMarks('find') },
  { clip: 'plans', vo: voFromMarks('plans') },
  { clip: 'hostel', vo: voFromMarks('hostel') },
  { clip: 'swap', vo: voFromMarks('swap') },
  { clip: 'edit', vo: voFromMarks('edit') },
  { clip: 'honest', vo: voFromMarks('honest') },
  { clip: 'card-why', vo: [['why', 0.25]] },
  { clip: 'card-close', vo: [['close', 1.3]] },
];

// 1. each shot -> a normalised 1080p60 segment with its captions burned in
const segs = [];
SHOTS.forEach((s, i) => {
  const seg = `${W}seg/${String(i).padStart(2, '0')}.mp4`;
  const len = s.frames3d ? s.len : clipInfo(s.clip).frames / FPS;
  const inputs = s.frames3d
    ? ['-framerate', String(FPS), '-i', `${FRAMES_3D}f_%04d.png`]
    : ['-i', `${W}clips/${s.clip}.mp4`];
  let graph = `[0:v]fps=${FPS},scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=1,trim=duration=${len.toFixed(3)},setpts=PTS-STARTPTS[v0]`;
  let last = 'v0';
  (s.caps ?? []).forEach(([id, a, b], k) => {
    const end = b ?? len - 0.35;
    inputs.push('-loop', '1', '-framerate', String(FPS), '-t', len.toFixed(3), '-i', `${W}cap/${id}.png`);
    graph += `;[${k + 1}:v]format=rgba,fade=t=in:st=${a.toFixed(2)}:d=0.3:alpha=1,fade=t=out:st=${(end - 0.3).toFixed(2)}:d=0.3:alpha=1[c${k}]`;
    graph += `;[${last}][c${k}]overlay=0:0:format=auto:shortest=1[v${k + 1}]`;
    last = `v${k + 1}`;
  });
  ff([...inputs, '-filter_complex', graph, '-map', `[${last}]`, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-r', String(FPS), '-pix_fmt', 'yuv420p', seg]);
  segs.push({ seg, len, vo: s.vo ?? [] });
});

// 2. join with cross-dissolves; place the voice at absolute times
let graph = '';
let prev = '0:v';
let offset = 0;
const starts = [0];
for (let i = 1; i < segs.length; i++) {
  offset += segs[i - 1].len - X;
  starts.push(offset);
  graph += `[${prev}][${i}:v]xfade=transition=fade:duration=${X}:offset=${offset.toFixed(3)}[x${i}];`;
  prev = `x${i}`;
}
const total = offset + segs[segs.length - 1].len;
const voInputs = [];
const voLabels = [];
segs.forEach((s, i) => s.vo.forEach(([id, at]) => {
  const n = segs.length + voInputs.length / 2;
  voInputs.push('-i', `${W}vo/${id}.wav`);
  const ms = Math.round((starts[i] + at) * 1000);
  graph += `[${n}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[a${voLabels.length}];`;
  voLabels.push(`[a${voLabels.length}]`);
}));
graph += `${voLabels.join('')}amix=inputs=${voLabels.length}:normalize=0:dropout_transition=0,apad,atrim=duration=${total.toFixed(3)}[amix]`;
const mix = `${W}mix.wav`;
const joined = `${W}joined.mp4`;
ff([...segs.flatMap((s) => ['-i', s.seg]), ...voInputs, '-filter_complex', graph, '-map', `[${prev}]`, '-map', '[amix]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'pcm_s16le', joined]);

// 3. loudness: two-pass loudnorm to -16 LUFS integrated, -1.5 dBTP
const meas = ffOut(['-i', joined, '-vn', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']);
const j = JSON.parse(meas.slice(meas.lastIndexOf('{'), meas.lastIndexOf('}') + 1));
const ln = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000`;
ff(['-i', joined, '-vn', '-af', ln, '-c:a', 'pcm_s16le', mix]);

// 4. master: 1080p60 H.264, CRF 17, slow preset
ff(['-i', joined, '-i', mix, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p',
  '-profile:v', 'high', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-shortest', OUT]);

// 5. upload copy under 9.5 MB: two-pass H.264 at a computed bitrate
const dur = probeDur(OUT);
const targetBytes = 9.0 * 1024 * 1024;
const audioK = 96;
const upload = (h, fps) => {
  const vK = Math.floor((targetBytes * 8) / dur / 1000 - audioK - 8);
  const vf = `scale=-2:${h}:flags=lanczos,fps=${fps}`;
  const common = ['-i', joined, '-i', mix, '-map', '0:v', '-map', '1:a', '-vf', vf, '-t', dur.toFixed(3), '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${vK}k`, '-pix_fmt', 'yuv420p', '-passlogfile', `${W}x264pass`];
  ff([...common, '-pass', '1', '-an', '-f', 'mp4', '/dev/null']);
  ff([...common, '-pass', '2', '-c:a', 'aac', '-b:a', `${audioK}k`, '-ar', '48000', '-movflags', '+faststart', UPLOAD]);
  return vK;
};
const uploadRes = process.env.UPLOAD_H ? Number(process.env.UPLOAD_H) : 1080;
const vK = upload(uploadRes, 30);
for (const f of ['x264pass-0.log', 'x264pass-0.log.mbtree']) if (existsSync(`${W}${f}`)) rmSync(`${W}${f}`);

const timeline = segs.map((s, i) => ({ shot: SHOTS[i].clip ?? '3d', start: +starts[i].toFixed(2), len: +s.len.toFixed(2), vo: s.vo.map(([id, at]) => ({ id, at: +(starts[i] + at).toFixed(2), len: VO[id] })) }));
writeFileSync(fileURLToPath(new URL('./timeline.json', import.meta.url)), JSON.stringify(timeline, null, 1));
console.log(`demo.mp4 ${dur.toFixed(2)} s, ${(statSync(OUT).size / 1048576).toFixed(2)} MB; demo-upload.mp4 ${uploadRes}p30 @ ${vK}k, ${(statSync(UPLOAD).size / 1048576).toFixed(2)} MB; loudness in ${j.input_i} LUFS`);
