// The Round 1 ad: voice-over lines, captions and which footage plays under them.
// `clip` is a recording from video/record.mjs; `from` is the second in that clip to start at.
// `min` is the shortest the segment may be (to let an on-screen action finish).
export const VOICE = 'Daniel';
export const RATE = 178;

export const SEGMENTS = [
  { id: 'hook', clip: 'card-hook', from: 0.3, min: 5.4, lead: 2.3,
    vo: "Your Wi-Fi isn't slow. Your router is in the wrong place." },
  { id: 'walls3d', clip: 'card-3d', from: 0.0, min: 4.0,
    vo: 'Every wall between you and the router eats signal, and concrete eats the most.',
    cap: 'Predicted 5 GHz signal, router by the front door' },
  { id: 'problem', clip: 'problem', from: 1.2, min: 8.0,
    vo: 'Leave the router by the front door, and the bedrooms get the scraps.',
    cap: 'Behind one concrete wall: weak signal (predicted)' },
  { id: 'name', clip: 'card-logo', from: 0.1, min: 3.6, lead: 1.0,
    vo: 'Meet FullBars.' },
  { id: 'plans', clip: 'see', from: 0.4, min: 5.6,
    vo: 'Pick a floor plan,',
    cap: 'Pick a floor plan' },
  { id: 'walls', clip: 'see', from: 6.6, min: 7.4,
    vo: 'or draw your own walls.',
    cap: 'or draw your own walls' },
  { id: 'drag', clip: 'see', from: 15.0, min: 14.0,
    vo: 'Drop in your router and move it. The predicted signal follows, through every wall, before you move a thing.',
    cap: 'See the predicted signal through every wall, before you move a thing' },
  { id: 'best', clip: 'best', from: 0.6, min: 9.5,
    vo: 'Then press one button. FullBars checks hundreds of spots, and slides the router to the one that covers the most of your home.',
    cap: 'One button checks hundreds of spots' },
  { id: 'result', clip: 'best', from: 5.4, min: 3.4, freeze: true,
    vo: 'Here, seventy-eight percent becomes one hundred.',
    cap: '78% → 100% of this flat at 3 bars or more (predicted)' },
  { id: 'value', clip: 'value', from: 0.3, min: 21.6,
    vo: 'Two point four or five gigahertz. A flat, a hostel, a terrace house. Swap a block wall for plasterboard, and the room behind it gets more signal.',
    cap: '2.4 or 5 GHz · flats, hostels, houses · any wall material' },
  { id: 'working', clip: 'working', from: 0.3, min: 8.0,
    vo: 'And it shows its working. Wall losses come from the ITU’s published building-material data. Signal levels come from the Wi-Fi standard.',
    cap: 'Wall losses: ITU-R P.2040 · Signal levels: IEEE 802.11' },
  { id: 'why', clip: 'card-why', from: 0.0, min: 5.2,
    vo: 'Free. Nothing to install. Your floor plan never leaves your browser.' },
  { id: 'close', clip: 'card-close', from: 0.0, min: 4.6, lead: 1.2,
    vo: 'FullBars. Move it once. Get it right.' },
];
