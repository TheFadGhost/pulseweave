export const DIFFICULTIES = ['EASY', 'NORMAL', 'HARD']

const ionDrift = {
  id: 'ion-drift',
  title: 'Ion Drift',
  bpm: 104,
  bars: 64,
  rootMidi: 45,
  scale: 'minor',
  seed: 1337,
  sections: [
    { startBar: 0, energy: 'low' },
    { startBar: 8, energy: 'mid' },
    { startBar: 24, energy: 'high' },
    { startBar: 40, energy: 'peak' },
    { startBar: 48, energy: 'mid' },
  ],
  drums: {
    low: { kick: '', snare: '', hat: '', ohat: '' },
    mid: {
      kick: 'x.......x.......',
      snare: '....x.......x...',
      hat: '..x...x...x...x.',
      ohat: '......x.........',
    },
    high: {
      kick: 'x.......x...x...',
      snare: '....x.......x...',
      hat: '..x...x...x...x.',
      ohat: '......x.......x.',
    },
    peak: {
      kick: 'x...x...x...x...',
      snare: '....x.......x..x',
      hat: 'x.x.x.x.x.x.x.x.',
      ohat: '..x...x...x...x.',
    },
  },
  bassline: {
    rhythm: 'x.......x.......',
    degrees: [0, 0, 5, 3, 0, 0, 4, 2],
  },
  lead: {
    patterns: [
      '1.......5.......',
      '4.......6.......',
      '1.....3.8.......',
      '6.....5.3.......',
    ],
    octave: 5,
  },
  pads: { low: true, mid: true, high: true, peak: true },
  fx: {
    risersAtBars: [23, 39],
    impactsAtBars: [0, 24, 40],
  },
  colors: {
    lane: ['#35f0d0', '#2bb8d8', '#8a5cff', '#c04df0'],
    accent: '#9ff5ff',
    bg: '#04060d',
  },
}

const cobaltCircuit = {
  id: 'cobalt-circuit',
  title: 'Cobalt Circuit',
  bpm: 128,
  bars: 72,
  rootMidi: 40,
  scale: 'minor',
  seed: 4242,
  sections: [
    { startBar: 0, energy: 'low' },
    { startBar: 8, energy: 'mid' },
    { startBar: 24, energy: 'high' },
    { startBar: 40, energy: 'peak' },
    { startBar: 56, energy: 'high' },
    { startBar: 64, energy: 'mid' },
  ],
  drums: {
    low: {
      kick: 'x...............',
      snare: '',
      hat: '..x...x...x...x.',
      ohat: '',
    },
    mid: {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      hat: '..x...x...x...x.',
      ohat: '....x.......x...',
    },
    high: {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      hat: 'x.x.x.x.x.x.x.x.',
      ohat: '..x...x...x...x.',
    },
    peak: {
      kick: 'x...x...x...x...',
      snare: '....x.......x..x',
      hat: 'xxxxxxxxxxxxxxxx',
      ohat: '..x...x...x...x.',
    },
  },
  bassline: {
    rhythm: 'x.x.x.xxx.x.x.x.',
    degrees: [0, 0, 3, 3, 5, 5, 6, 4],
  },
  lead: {
    patterns: [
      '1.3.5.3.1.3.5.3.',
      '1.4.6.4.1.4.6.4.',
      '5.3.1.3.5.3.1.3.',
      '8.6.4.6.8.6.5.3.',
    ],
    octave: 5,
  },
  pads: { low: true, mid: true, high: true, peak: false },
  fx: {
    risersAtBars: [23, 39, 55],
    impactsAtBars: [0, 24, 40, 56],
  },
  colors: {
    lane: ['#00e5ff', '#19b8ff', '#ff2fd6', '#ff6ae6'],
    accent: '#ffffff',
    bg: '#04060d',
  },
}

const staticBloom = {
  id: 'static-bloom',
  title: 'Static Bloom',
  bpm: 160,
  bars: 80,
  rootMidi: 48,
  scale: 'minor',
  seed: 9001,
  sections: [
    { startBar: 0, energy: 'low' },
    { startBar: 8, energy: 'mid' },
    { startBar: 20, energy: 'high' },
    { startBar: 32, energy: 'peak' },
    { startBar: 48, energy: 'mid' },
    { startBar: 56, energy: 'peak' },
    { startBar: 70, energy: 'high' },
    { startBar: 76, energy: 'low' },
  ],
  drums: {
    low: {
      kick: 'x..x..x.........',
      snare: '....x.......x...',
      hat: 'x...x...x...x...',
      ohat: '',
    },
    mid: {
      kick: 'x..x..x.x..x....',
      snare: '....x..x....x..x',
      hat: 'x.x.x.x.x.x.x.x.',
      ohat: '......x.......x.',
    },
    high: {
      kick: 'x..x..x.x..x..x.',
      snare: '....x..x....x.x.',
      hat: 'x.xxx.x.x.xxx.x.',
      ohat: '....x.......x...',
    },
    peak: {
      kick: 'x..x..x.x..x..xx',
      snare: '....x..x..x.x..x',
      hat: 'xxxxxxxxxxxxxxxx',
      ohat: '......x.......x.',
    },
  },
  bassline: {
    rhythm: 'x..xx..x..xx.x..',
    degrees: [0, 0, 0, 3, 0, 0, 5, 6],
  },
  lead: {
    patterns: [
      '1..1..1...1.1...',
      '1.1.....1.1.....',
      '6..5..6...8.....',
      '1.1.1...6.5.4...',
    ],
    octave: 4,
  },
  pads: { low: true, mid: true, high: false, peak: false },
  fx: {
    risersAtBars: [19, 31, 55, 69],
    impactsAtBars: [0, 8, 20, 32, 48, 56, 70],
  },
  colors: {
    lane: ['#ff3b30', '#ff5e1f', '#ff9e00', '#ffc94d'],
    accent: '#ffd166',
    bg: '#04060d',
  },
}

export const TRACKS = [ionDrift, cobaltCircuit, staticBloom]

export const TRACKS_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t]))
