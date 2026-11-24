// The Round 1 ad: voice-over lines (Kokoro, voice af_heart) and on-screen captions.
// Each line belongs to one shot; build.mjs times the shot to its line.
// Numbers are said only as the app shows them.
export const VOICE = 'af_heart';
export const SPEED = 1.05;

export const LINES = {
  hook: "Your Wi-Fi isn't slow. Your router's just in the wrong place.",
  walls3d: 'Every wall between you and the router eats signal. And concrete eats the most.',
  name: 'Meet FullBars.',
  setup: "Here's a two-bedroom flat, with the router by the front door. At five gigahertz, only seventy-eight percent of it gets three bars or more.",
  probe: 'FullBars predicts the signal in every room, through every wall. Hover anywhere to see why: this bedroom is weak, with one concrete wall in the way.',
  find: 'Now the fun part. Press Find the best spot. FullBars checks hundreds of positions, then slides the router to the one that covers the most of your home.',
  result: 'Seventy-eight percent of the flat at three bars or more. Now, one hundred.',
  plans: 'Flats, hostels, terrace houses. Pick a plan and watch the signal spread, stalling at every wall before it pushes through.',
  band: 'Switch between two point four and five gigahertz, and see how each band gets through your walls.',
  hostel: 'In this hostel wing, the far rooms are dead zones. One click, and seventy percent becomes ninety-six.',
  swap: "Planning a change? Click any wall and swap what it's made of. Concrete to plasterboard, and the bedroom behind it gets more signal.",
  draw: 'Your place looks different? Draw your own walls, pick what they are made of, and watch the signal react.',
  drag: 'Drag the router anywhere. The map follows every move, live.',
  honest: "And it's honest. Every number is a prediction, not a measurement, built on published data: wall losses from the I T U, signal levels from the Wi-Fi standard.",
  why: 'Free. Nothing to install. Your floor plan never leaves your browser.',
  close: 'FullBars. Move it once. Get it right.',
};

// Lower-third captions (real numbers from the running app).
export const CAPTIONS = {
  walls3d: 'Predicted 5 GHz signal · router by the front door',
  setup: 'Router by the front door · 78% at 3 bars or more (predicted)',
  probe: 'Bedroom 1 · −75 dBm, weak · one concrete wall, −19.3 dB',
  find: '327 spots checked',
  result: '78% → 100% at 3 bars or more (predicted)',
  plans: 'Two-bedroom flat · hostel wing · terrace house',
  hostel: 'Hostel wing at 2.4 GHz: 70% → 96% (predicted)',
  swap: 'Bedroom 2 wall: concrete → plasterboard',
  draw: 'Draw walls in concrete, brick, plasterboard, glass or wood',
  drag: 'Live, every frame, through every wall',
  band: '2.4 GHz or 5 GHz',
  honest: 'Wall losses: ITU-R P.2040 · Signal levels: IEEE 802.11',
};
