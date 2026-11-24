// The Round 1 ad: voice-over beats (one short sentence or clause each) and the few captions.
// Each beat is spoken while record.mjs shows a callout on the thing it names, so the
// beats are split exactly where the focus changes. Numbers are said only as the app shows them.
export const VOICE = 'af_heart';
export const SPEED = 1.05;

export const LINES = {
  // hook (app, zoomed on the router as the signal spreads)
  hook_a: "Your Wi-Fi isn't slow.",
  hook_b: "Your router's just in the wrong place.",
  // 3D title shot, then the logo card
  title: 'Meet FullBars: a live map of your Wi-Fi, room by room, before you move a thing.',
  name: 'See your Wi-Fi through the walls.',
  // setup
  setup_a: "Here's a two-bedroom flat.",
  setup_b: 'The router sits by the front door,',
  setup_c: 'and a concrete wall stands between it and both bedrooms.',
  setup_d: 'At five gigahertz, only seventy-eight percent of the flat gets three bars or more.',
  setup_e: 'Each row is a signal level, from strong down to dead zone.',
  // hover readout
  probe_a: 'Hover over a bedroom,',
  probe_b: 'and the readout says minus seventy-five dBm. Weak.',
  probe_c: 'One concrete wall is in the way. It costs nineteen point three decibels.',
  // best spot
  find_a: 'Now the fun part. Press Find the best spot.',
  find_b: 'It checks hundreds of spots, then slides the router to the one that covers the most of your home.',
  find_c: 'Seventy-eight percent before.',
  find_d: 'One hundred percent after.',
  find_e: 'Three hundred and twenty-seven spots checked.',
  // plans
  plans_a: 'Pick a plan: a flat, a hostel wing, or a terrace house.',
  plans_b: 'Watch the signal spread, stalling at every wall before it pushes through.',
  // band + hostel
  hostel_a: 'Switch between two point four and five gigahertz.',
  hostel_b: 'At two point four, the far rooms of this hostel are dead zones.',
  hostel_c: 'One click on Find the best spot,',
  hostel_d: 'and seventy percent becomes ninety-six.',
  // change a wall
  swap_a: 'Planning a change? Click any wall,',
  swap_b: "and choose what it's made of.",
  swap_c: 'Concrete to plasterboard, and bedroom two gets more signal.',
  // draw + drag
  edit_a: 'Draw your own walls,',
  edit_b: 'in concrete, brick, plasterboard, glass or wood,',
  edit_c: 'and watch the signal react.',
  edit_d: 'Drag the router anywhere. The map follows every move, live.',
  // honest
  honest_a: 'Every number here is a prediction, not a measurement.',
  honest_b: 'Open How it works',
  honest_c: 'for the formula behind every number,',
  honest_d: 'and the sources: wall losses from the I T U, signal levels from the Wi-Fi standard.',
  // cards
  why: 'Free. Nothing to install. Your floor plan never leaves your browser.',
  close: 'FullBars. Move it once. Get it right.',
};

// Lower-third captions (only where no callout label is on screen).
export const CAPTIONS = {
  walls3d: 'Predicted 5 GHz signal · router by the front door',
};
