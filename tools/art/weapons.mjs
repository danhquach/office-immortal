// Weapon icon SVGs: 6 families x 5 grades, drawn on a 64x64 grid, thick dark outline,
// flat colours. tools/art/render-weapons.mjs renders them for tools/art/build.py.
const O = '#1a1423';
const SW = 2.6; // outline width

const G = {
  mortal: { d: '#4a4a55', m: '#6e6e7a', l: '#9a9aa6', h: '#c8c8d0', gem: null, trim: '#6e6e7a' },
  spirit: {
    d: '#1e2f5c',
    m: '#2f5fb3',
    l: '#5aa0f0',
    h: '#a8d8ff',
    gem: '#a8d8ff',
    trim: '#c8c8d0',
  },
  earth: {
    d: '#1f4d3a',
    m: '#2f8a5a',
    l: '#5fd08a',
    h: '#b8f5c8',
    gem: '#5fd08a',
    trim: '#f5c542',
  },
  heaven: {
    d: '#c8c8d0',
    m: '#f2f2f5',
    l: '#f2f2f5',
    h: '#fff1a8',
    gem: '#5aa0f0',
    trim: '#f5c542',
  },
  immortal: {
    d: '#6e1b25',
    m: '#b82e3a',
    l: '#f05a5a',
    h: '#f1c7a1',
    gem: '#f5c542',
    trim: '#f5c542',
  },
};
const GRADES = Object.keys(G);

const s = (o) =>
  `stroke="${O}" stroke-width="${o ?? SW}" stroke-linejoin="round" stroke-linecap="round"`;
const wrap = (body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-28 -28 120 120" width="384" height="384">${defs}${body}</svg>`;
// Long items are drawn upright, tip at top, then turned to the usual diagonal.
const diag = (body) => `<g transform="rotate(45 32 32)">${body}</g>`;

function glow(id, colour, op = 0.55) {
  return `<defs><radialGradient id="${id}"><stop offset="0" stop-color="${colour}" stop-opacity="${op}"/><stop offset="1" stop-color="${colour}" stop-opacity="0"/></radialGradient></defs>`;
}

// ---------- Flying Sword: slim jian, guard, tassel, qi streaks ----------
function flyingSword(g) {
  const c = G[g];
  const blade = g === 'heaven' ? '#f2f2f5' : c.l;
  const edge = g === 'heaven' ? '#fff1a8' : c.h;
  const hilt = {
    mortal: '#6b3e26',
    spirit: '#1e2f5c',
    earth: '#1f4d3a',
    heaven: '#e88a2a',
    immortal: '#6e1b25',
  }[g];
  const guard = {
    mortal: '#6e6e7a',
    spirit: '#c8c8d0',
    earth: '#f5c542',
    heaven: '#f5c542',
    immortal: '#f5c542',
  }[g];
  const tassel = {
    mortal: '#b82e3a',
    spirit: '#5aa0f0',
    earth: '#b82e3a',
    heaven: '#b82e3a',
    immortal: '#f5c542',
  }[g];
  let streaks = '';
  if (g !== 'mortal') {
    const sc = { spirit: '#a8d8ff', earth: '#b8f5c8', heaven: '#fff1a8', immortal: '#e88a2a' }[g];
    streaks = `<g stroke="${sc}" stroke-width="2" stroke-linecap="round" opacity="0.9">
      <line x1="22" y1="16" x2="22" y2="30"/><line x1="42" y1="12" x2="42" y2="24"/>${g === 'heaven' || g === 'immortal' ? '<line x1="44" y1="30" x2="44" y2="40"/>' : ''}</g>`;
  }
  const flame =
    g === 'immortal'
      ? `<path d="M32 2 C27 9 29 13 32 15 C35 13 37 9 32 2 Z" fill="#f5c542" ${s(1.6)}/>`
      : '';
  const gem = c.gem ? `<circle cx="32" cy="45.5" r="2.3" fill="${c.gem}" ${s(1.4)}/>` : '';
  const body = `
    ${streaks}
    ${flame}
    <path d="M32 4 L36 12 L36 43 L28 43 L28 12 Z" fill="${blade}" ${s()}/>
    <path d="M32 7 L32 42" stroke="${edge}" stroke-width="1.6"/>
    <path d="M22 43 Q32 49 42 43 L42 46.5 Q32 52 22 46.5 Z" fill="${guard}" ${s()}/>
    ${gem}
    <rect x="29.5" y="49" width="5" height="10" rx="1.5" fill="${hilt}" ${s()}/>
    <circle cx="32" cy="60.5" r="2.4" fill="${guard}" ${s(1.6)}/>
    <path d="M32 62 Q26 64 24 70" fill="none" stroke="${O}" stroke-width="4" stroke-linecap="round"/>
    <path d="M32 62 Q26 64 24 70" fill="none" stroke="${tassel}" stroke-width="2" stroke-linecap="round"/>`;
  return wrap(diag(body));
}

// ---------- Horsetail Whisk: handle + flowing hair, fuller and richer each grade ----------
const WHISK = {
  // L: hair length, W: half width, n: tips, bands: tip colours from root to tip
  mortal: {
    L: 30,
    W: 7,
    n: 5,
    sw: 0,
    hair: '#c8c8d0',
    sh: '#9a9aa6',
    bands: [],
    handle: '#8a5a35',
    hi: '#a8693f',
    cap: '#4a4a55',
    ring: '#4a4a55',
    gem: null,
    flame: false,
  },
  spirit: {
    L: 36,
    W: 8,
    n: 6,
    sw: 0,
    hair: '#f2f2f5',
    sh: '#a8d8ff',
    bands: ['#a8d8ff'],
    handle: '#2f5fb3',
    hi: '#5aa0f0',
    cap: '#c8c8d0',
    ring: '#c8c8d0',
    gem: '#a8d8ff',
    flame: false,
  },
  earth: {
    L: 42,
    W: 9,
    n: 6,
    sw: 0,
    hair: '#f2f2f5',
    sh: '#b8f5c8',
    bands: ['#b8f5c8', '#5fd08a'],
    handle: '#2f8a5a',
    hi: '#5fd08a',
    cap: '#f5c542',
    ring: '#f5c542',
    gem: '#5fd08a',
    flame: false,
  },
  heaven: {
    L: 48,
    W: 10,
    n: 7,
    sw: 0,
    hair: '#f2f2f5',
    sh: '#fff1a8',
    bands: ['#fff1a8', '#f5c542'],
    handle: '#f2f2f5',
    hi: '#fff1a8',
    cap: '#f5c542',
    ring: '#f5c542',
    gem: '#5aa0f0',
    flame: false,
  },
  immortal: {
    L: 52,
    W: 11,
    n: 7,
    sw: 0,
    hair: '#fff1a8',
    sh: '#f5c542',
    bands: ['#e88a2a', '#b82e3a'],
    handle: '#b82e3a',
    hi: '#f05a5a',
    cap: '#f5c542',
    ring: '#f5c542',
    gem: '#f5c542',
    flame: true,
  },
};

// Point on a chain of cubic beziers [[p0,p1,p2,p3], ...] at t in 0..1, with tangent.
function chainAt(segs, t) {
  const n = segs.length,
    f = Math.min(t * n, n - 1e-9),
    i = Math.floor(f),
    u = f - i;
  const [a, b, c, d] = segs[i],
    v = 1 - u;
  const pt = [0, 1].map(
    (k) => v * v * v * a[k] + 3 * v * v * u * b[k] + 3 * v * u * u * c[k] + u * u * u * d[k],
  );
  const tg = [0, 1].map(
    (k) => 3 * v * v * (b[k] - a[k]) + 6 * v * u * (c[k] - b[k]) + 3 * u * u * (d[k] - c[k]),
  );
  const len = Math.hypot(tg[0], tg[1]) || 1;
  return { p: pt, n: [-tg[1] / len, tg[0] / len] };
}

// A tapering ribbon along the chain from t0 to t1: half width hw(t), side shift off(t) in -1..1.
function ribbon(segs, hw, t0 = 0, t1 = 1, steps = 48) {
  const L = [],
    R = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const { p, n } = chainAt(segs, t),
      w = hw(t);
    L.push(`${(p[0] + n[0] * w).toFixed(2)} ${(p[1] + n[1] * w).toFixed(2)}`);
    R.push(`${(p[0] - n[0] * w).toFixed(2)} ${(p[1] - n[1] * w).toFixed(2)}`);
  }
  return `M${L.join(' L')} L${R.reverse().join(' L')} Z`;
}
function line(segs, hw, k, t0, t1, steps = 40) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const { p, n } = chainAt(segs, t),
      w = hw(t) * k;
    pts.push(`${(p[0] + n[0] * w).toFixed(2)} ${(p[1] + n[1] * w).toFixed(2)}`);
  }
  return `M${pts.join(' L')}`;
}

function whisk(g) {
  // A real fly whisk held as an upside-down V: the handle rises from the bottom left to the
  // peak, and the hair goes over the peak and hangs down the right side like a ponytail.
  const p = WHISK[g];
  const W = p.W;
  const top = [30, 15]; // handle top / hair root
  const tail = [
    [
      [30, 13],
      [30, 4],
      [38, 1],
      [44, 8],
    ],
    [
      [44, 8],
      [50, 14],
      [51, 26],
      [50, 36],
    ],
    [
      [50, 36],
      [50, 46],
      [54, 54],
      [56, 64],
    ],
  ];
  const root = 3;
  const hw = (t) =>
    t < 0.62
      ? root + (W - root) * Math.sin((Math.PI / 2) * (t / 0.62))
      : Math.max(1.6, W * Math.pow(1 - (t - 0.62) / 0.38, 0.6));
  const body = ribbon(tail, hw);
  const shares = p.bands.length === 1 ? [0.68] : [0.55, 0.78];
  const bands = p.bands
    .map((c, k) => `<path d="${ribbon(tail, hw, shares[k], 1)}" fill="${c}"/>`)
    .join('');
  let strands = '';
  for (let i = 0; i < p.n; i++) {
    const k = -0.75 + (1.5 * i) / Math.max(1, p.n - 1);
    strands += `<path d="${line(tail, hw, k, 0.08, 0.97)}" fill="none" stroke="${p.sh}" stroke-width="0.9" stroke-linecap="round"/>`;
  }
  if (g === 'heaven' || g === 'immortal') {
    for (const k of [-0.4, 0.1, 0.55])
      strands += `<path d="${line(tail, hw, k, 0.1, 0.9)}" fill="none" stroke="#f5c542" stroke-width="0.8" stroke-linecap="round"/>`;
  }
  const id = `wt-${g}`;
  let flames = '';
  if (p.flame) {
    for (const [t, side, c] of [
      [0.55, 1, '#e88a2a'],
      [0.72, -1, '#e88a2a'],
      [0.86, 1, '#f5c542'],
      [0.98, 0, '#e88a2a'],
    ]) {
      const { p: q, n } = chainAt(tail, t);
      const w = hw(t) * side;
      const bx = q[0] + n[0] * w,
        by = q[1] + n[1] * w;
      const ox = side ? n[0] * side * 7 : 1,
        oy = side ? n[1] * side * 7 + 3 : 8;
      flames += `<path d="M${bx - 2} ${by - 1} Q${bx + ox * 0.6 - 1} ${by + oy * 0.6} ${bx + ox} ${by + oy} Q${bx + ox * 0.4 + 1} ${by + oy * 0.4} ${bx + 2} ${by + 1} Z" fill="${c}" ${s(1.3)}/>`;
    }
  }
  const hair = `<defs><clipPath id="${id}"><path d="${body}"/></clipPath></defs>
    ${flames}
    <path d="${body}" fill="${p.hair}"/>
    <g clip-path="url(#${id})">${strands}${bands}</g>
    <path d="${body}" fill="none" ${s()}/>`;
  // handle: from the pommel at the bottom left up to the peak; local +y runs down the handle
  const ang = 19;
  const fancy = g === 'heaven' || g === 'immortal';
  const handle = `<g transform="translate(${top[0]} ${top[1]}) rotate(${ang})">
    <rect x="-2.6" y="0" width="5.2" height="42" rx="2" fill="${p.handle}" ${s()}/>
    <line x1="-1" y1="2" x2="-1" y2="40" stroke="${p.hi}" stroke-width="1.4"/>
    ${fancy ? `<path d="M-2.6 10 h5.2 M-2.6 14 h5.2 M-2.6 30 h5.2" stroke="#f5c542" stroke-width="1.4"/>` : ''}
    ${p.gem ? `<circle cx="0" cy="22" r="2.4" fill="${p.gem}" ${s(1.3)}/>` : ''}
    <rect x="-4.2" y="-3" width="8.4" height="6" rx="1.6" fill="${p.ring}" ${s()}/>
    ${
      fancy
        ? `<path d="M-4.5 42 L-3 49 L-1 45.5 L0 50.5 L1 45.5 L3 49 L4.5 42 Z" fill="#f5c542" ${s(1.6)}/>`
        : `<circle cx="0" cy="44.5" r="3.2" fill="${p.cap}" ${s(1.8)}/>`
    }
    ${g !== 'mortal' ? `<path d="M0 47 Q-6 50 -6 58" fill="none" stroke="${O}" stroke-width="3.6" stroke-linecap="round"/><path d="M0 47 Q-6 50 -6 58" fill="none" stroke="${g === 'spirit' ? '#5aa0f0' : '#b82e3a'}" stroke-width="1.6" stroke-linecap="round"/>` : ''}
  </g>`;
  const fx =
    g === 'heaven'
      ? `<path d="M58 20 h4 M60 18 v4 M38 40 h4 M40 38 v4 M60 52 h3" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/>`
      : g === 'spirit' || g === 'earth'
        ? `<path d="M58 22 C62 28 58 34 61 40" fill="none" stroke="${p.sh}" stroke-width="2" stroke-linecap="round"/>`
        : g === 'immortal'
          ? `<circle cx="40" cy="44" r="1.6" fill="#f5c542"/><circle cx="62" cy="40" r="1.6" fill="#f5c542"/><circle cx="44" cy="60" r="1.2" fill="#e88a2a"/>`
          : '';
  return wrap(`${fx}${handle}${hair}`);
}

// ---------- Peachwood Sword: wooden blade, talisman paper, cord ----------
function peachwood(g) {
  const wood = {
    mortal: '#d9a06f',
    spirit: '#e8a08a',
    earth: '#d9a06f',
    heaven: '#6b3e26',
    immortal: '#b82e3a',
  }[g];
  const woodHi = {
    mortal: '#f1c7a1',
    spirit: '#f1c7a1',
    earth: '#f1c7a1',
    heaven: '#a8693f',
    immortal: '#f05a5a',
  }[g];
  const grain = {
    mortal: '#a8693f',
    spirit: '#a8693f',
    earth: '#8a5a35',
    heaven: '#4a2f1f',
    immortal: '#6e1b25',
  }[g];
  const guard = {
    mortal: '#8a5a35',
    spirit: '#a8693f',
    earth: '#2f8a5a',
    heaven: '#f5c542',
    immortal: '#f5c542',
  }[g];
  const cord = {
    mortal: '#b82e3a',
    spirit: '#5aa0f0',
    earth: '#b82e3a',
    heaven: '#b82e3a',
    immortal: '#f5c542',
  }[g];
  const talismans = { mortal: 1, spirit: 1, earth: 2, heaven: 2, immortal: 3 }[g];
  let paper = '';
  const spots = [
    [30, 20],
    [30, 31],
    [30, 9],
  ];
  for (let i = 0; i < talismans; i++) {
    const [x, y] = spots[i];
    paper += `<g transform="rotate(${i % 2 ? -8 : 8} ${x + 2} ${y})">
      <rect x="${x + 4}" y="${y - 3}" width="7" height="12" fill="#f5c542" ${s(1.6)}/>
      <path d="M${x + 6} ${y} h3 M${x + 7.5} ${y} v6 M${x + 6} ${y + 3} h3" stroke="#b82e3a" stroke-width="1.2" stroke-linecap="round"/></g>`;
  }
  const inlay =
    g === 'immortal' || g === 'heaven'
      ? `<path d="M32 10 L32 40" stroke="#f5c542" stroke-width="1.4" stroke-dasharray="3 2"/>`
      : '';
  const bolt =
    g === 'heaven'
      ? `<path d="M20 6 L24 13 L21 14 L25 22" fill="none" stroke="#fff1a8" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/><path d="M44 18 L40 24 L43 25 L39 31" fill="none" stroke="#fff1a8" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`
      : g === 'immortal'
        ? `<circle cx="32" cy="22" r="20" fill="url(#gl)"/>`
        : g === 'earth'
          ? `<path d="M22 14 l3 0 M41 22 l3 0 M23 30 l2 0" stroke="#b8f5c8" stroke-width="2" stroke-linecap="round"/>`
          : '';
  const defs = g === 'immortal' ? glow('gl', '#f5c542', 0.6) : '';
  const body = `
    ${bolt}
    <path d="M32 3 L37 11 L37 43 L27 43 L27 11 Z" fill="${wood}" ${s()}/>
    <path d="M29.5 12 L29.5 41" stroke="${woodHi}" stroke-width="1.6"/>
    <path d="M34.5 14 Q33.5 22 34.5 28 M34.5 32 Q33.5 37 34.5 41" fill="none" stroke="${grain}" stroke-width="1.1"/>
    ${inlay}
    ${paper}
    <rect x="22" y="43" width="20" height="4.5" rx="2" fill="${guard}" ${s()}/>
    <rect x="29.5" y="47.5" width="5" height="11" rx="1.5" fill="${grain}" ${s()}/>
    <path d="M29.5 51 h5 M29.5 54.5 h5" stroke="${cord}" stroke-width="1.4"/>
    <circle cx="32" cy="60.5" r="2.4" fill="${guard}" ${s(1.6)}/>
    <path d="M32 62 Q37 64 39 70" fill="none" stroke="${O}" stroke-width="4" stroke-linecap="round"/>
    <path d="M32 62 Q37 64 39 70" fill="none" stroke="${cord}" stroke-width="2" stroke-linecap="round"/>`;
  return wrap(diag(body), defs);
}

// ---------- Feather Fan (every grade) ----------
function fan(g) {
  const P = {
    mortal: {
      fe: ['#f2f2f5', '#c8c8d0', '#9a9aa6'],
      tip: null,
      handle: '#8a5a35',
      band: '#6e6e7a',
      gem: null,
      fx: null,
    },
    spirit: {
      fe: ['#a8d8ff', '#5aa0f0', '#2f5fb3'],
      tip: null,
      handle: '#1e2f5c',
      band: '#c8c8d0',
      gem: '#a8d8ff',
      fx: '#a8d8ff',
    },
    earth: {
      fe: ['#b8f5c8', '#5fd08a', '#2f8a5a'],
      tip: '#1f4d3a',
      handle: '#1f4d3a',
      band: '#f5c542',
      gem: '#5fd08a',
      fx: '#b8f5c8',
    },
    heaven: {
      fe: ['#f2f2f5', '#fff1a8', '#e88a2a'],
      tip: '#f5c542',
      handle: '#e88a2a',
      band: '#f5c542',
      gem: '#5aa0f0',
      fx: '#f5c542',
    },
    immortal: {
      fe: ['#f05a5a', '#b82e3a', '#6e1b25'],
      tip: '#f5c542',
      handle: '#6e1b25',
      band: '#f5c542',
      gem: '#f5c542',
      fx: '#e88a2a',
    },
  }[g];
  const n = g === 'mortal' || g === 'spirit' ? 7 : 9;
  let feathers = '';
  for (let i = 0; i < n; i++) {
    const a = -60 + (120 / (n - 1)) * i;
    const tip = P.tip
      ? `<path d="M28.2 13 C29.5 9 30.8 7.5 32 6 C33.2 7.5 34.5 9 35.8 13 Q32 15 28.2 13 Z" fill="${P.tip}" stroke="none"/>`
      : '';
    feathers += `<g transform="rotate(${a} 32 46)">
      <path d="M32 46 C25 34 26 14 32 6 C38 14 39 34 32 46 Z" fill="${i % 2 ? P.fe[1] : P.fe[0]}" ${s(2)}/>
      ${tip}
      <path d="M32 46 C25 34 26 14 32 6 C38 14 39 34 32 46 Z" fill="none" ${s(2)}/>
      <path d="M32 44 L32 14" stroke="${P.fe[2]}" stroke-width="1.2"/></g>`;
  }
  const fx = P.fx
    ? g === 'immortal'
      ? `<path d="M8 50 C4 44 8 40 6 34 C12 38 12 44 8 50 Z M56 50 C60 44 56 40 58 34 C52 38 52 44 56 50 Z" fill="#e88a2a" ${s(1.6)}/>`
      : g === 'heaven'
        ? `<path d="M6 30 l4 0 M8 28 l0 4 M56 26 l4 0 M58 24 l0 4" stroke="#f5c542" stroke-width="2" stroke-linecap="round"/>`
        : `<path d="M6 54 C12 50 16 56 22 52" fill="none" stroke="${P.fx}" stroke-width="2" stroke-linecap="round"/><path d="M42 56 C48 52 52 58 58 54" fill="none" stroke="${P.fx}" stroke-width="2" stroke-linecap="round"/>`
    : '';
  const gem = P.gem ? `<circle cx="32" cy="46" r="2.4" fill="${P.gem}" ${s(1.4)}/>` : '';
  const tassel =
    g === 'heaven' || g === 'immortal'
      ? `<path d="M32 61 Q36 64 37 70" fill="none" stroke="${O}" stroke-width="4" stroke-linecap="round"/><path d="M32 61 Q36 64 37 70" fill="none" stroke="#b82e3a" stroke-width="2" stroke-linecap="round"/>`
      : '';
  return wrap(`${fx}${feathers}
    <path d="M24 44 Q32 40 40 44 L36 50 L28 50 Z" fill="${P.band}" ${s()}/>
    ${gem}
    ${tassel}
    <rect x="29.5" y="50" width="5" height="11" rx="1.5" fill="${P.handle}" ${s()}/>`);
}

// ---------- Mountain Seal (every grade) ----------
function seal(g) {
  const c = {
    mortal: {
      top: '#9a9aa6',
      side: '#6e6e7a',
      dark: '#4a4a55',
      knob: '#c8c8d0',
      mark: '#6e1b25',
      trim: '#4a4a55',
    },
    spirit: {
      top: '#5aa0f0',
      side: '#2f5fb3',
      dark: '#1e2f5c',
      knob: '#a8d8ff',
      mark: '#f2f2f5',
      trim: '#c8c8d0',
    },
    earth: {
      top: '#5fd08a',
      side: '#2f8a5a',
      dark: '#1f4d3a',
      knob: '#b8f5c8',
      mark: '#b82e3a',
      trim: '#f5c542',
    },
    heaven: {
      top: '#f2f2f5',
      side: '#c8c8d0',
      dark: '#9a9aa6',
      knob: '#f5c542',
      mark: '#b82e3a',
      trim: '#f5c542',
    },
    immortal: {
      top: '#f05a5a',
      side: '#b82e3a',
      dark: '#6e1b25',
      knob: '#f5c542',
      mark: '#f5c542',
      trim: '#f5c542',
    },
  }[g];
  // A square seal block in 3/4 view, a three-peak mountain carved as its knob.
  const defs =
    g === 'immortal'
      ? glow('sg', '#f5c542', 0.55)
      : g === 'heaven'
        ? glow('sg', '#fff1a8', 0.6)
        : '';
  const halo =
    g === 'heaven' || g === 'immortal' ? `<circle cx="32" cy="36" r="30" fill="url(#sg)"/>` : '';
  const cracks =
    g === 'immortal'
      ? `<path d="M10 62 l5 -4 M54 62 l-5 -4 M32 63 v-3" stroke="#e88a2a" stroke-width="2" stroke-linecap="round"/>`
      : '';
  return wrap(
    `${halo}
    <path d="M12 26 L20 12 Q22 9 24 12 L27 17 L30 7 Q32 3 34 7 L39 17 L42 13 Q44 10 46 13 L52 26 Z" fill="${c.knob}" ${s()}/>
    <path d="M27.5 12 L30 7 Q32 3 34 7 L36.5 12 L34 10.5 L32 13 L30 10.5 Z" fill="#f2f2f5" stroke="none"/>
    <path d="M20 12 Q22 9 24 12 L25 14 L22 13 L19 14 Z" fill="#f2f2f5"/>
    <path d="M42 13 Q44 10 46 13 L47 15 L44 14 L41 15 Z" fill="#f2f2f5"/>
    <path d="M8 30 L32 22 L56 30 L32 38 Z" fill="${c.top}" ${s()}/>
    <path d="M8 30 L32 38 L32 58 L8 50 Z" fill="${c.side}" ${s()}/>
    <path d="M56 30 L32 38 L32 58 L56 50 Z" fill="${c.dark}" ${s()}/>
    <path d="M8 46 L32 54 L56 46" fill="none" stroke="${c.trim}" stroke-width="1.8"/>
    <path d="M14 38 h10 M19 38 v8 M14 43 h10" stroke="${c.mark}" stroke-width="1.6" stroke-linecap="round" transform="skewY(18) translate(0 -5)"/>
    ${cracks}`,
    defs,
  );
}

// ---------- Vajra Pestle: three-pronged head, banded shaft, wrapped grip ----------
function pestle(g) {
  const c = G[g];
  const P = {
    mortal: { shaft: '#6e6e7a', hi: '#9a9aa6', band: '#4a4a55', grip: '#6b3e26', bolt: null },
    spirit: { shaft: '#2f5fb3', hi: '#5aa0f0', band: '#c8c8d0', grip: '#1e2f5c', bolt: '#a8d8ff' },
    earth: { shaft: '#2f8a5a', hi: '#5fd08a', band: '#f5c542', grip: '#1f4d3a', bolt: '#b8f5c8' },
    heaven: { shaft: '#f2f2f5', hi: '#fff1a8', band: '#f5c542', grip: '#e88a2a', bolt: '#fff1a8' },
    immortal: {
      shaft: '#b82e3a',
      hi: '#f05a5a',
      band: '#f5c542',
      grip: '#6e1b25',
      bolt: '#e88a2a',
    },
  }[g];
  const defs =
    g === 'immortal'
      ? glow('vg', '#f5c542', 0.55)
      : g === 'heaven'
        ? glow('vg', '#fff1a8', 0.6)
        : '';
  const halo =
    g === 'heaven' || g === 'immortal' ? `<circle cx="32" cy="16" r="20" fill="url(#vg)"/>` : '';
  // Thunder zigzags beside the head from Spirit up; a third from Heaven up.
  const bolts = P.bolt
    ? `<g fill="none" stroke="${P.bolt}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9">
      <path d="M15 8 l3 4 l-3 3 l3 4"/><path d="M49 8 l-3 4 l3 3 l-3 4"/>${g === 'heaven' || g === 'immortal' ? '<path d="M45 31 l-2 3 l2 2 l-2 3"/>' : ''}</g>`
    : '';
  const flame =
    g === 'immortal'
      ? `<path d="M32 -3 C28 2 29.5 5 32 6.5 C34.5 5 36 2 32 -3 Z" fill="#f5c542" ${s(1.6)}/>`
      : '';
  const gem = c.gem ? `<circle cx="32" cy="48.5" r="2.6" fill="${c.gem}" ${s(1.3)}/>` : '';
  // Each outer prong is a dark stroke under a coloured one, so it reads as its own bar.
  const prong = (d) =>
    `<path d="${d}" fill="none" stroke="${O}" stroke-width="7" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${P.hi}" stroke-width="3.4" stroke-linecap="round"/>`;
  const body = `
    ${halo}
    ${bolts}
    ${flame}
    ${prong('M27 23 Q17 14 30 5')}
    ${prong('M37 23 Q47 14 34 5')}
    <path d="M32 2 L36 12 L32 24 L28 12 Z" fill="${P.shaft}" ${s()}/>
    <path d="M32 5 L32 20" stroke="${P.hi}" stroke-width="1.6"/>
    <rect x="21" y="22" width="22" height="6" rx="3" fill="${P.band}" ${s()}/>
    <path d="M25 28 L39 28 L37.5 44 L26.5 44 Z" fill="${P.shaft}" ${s()}/>
    <path d="M29 29.5 L29 42.5" stroke="${P.hi}" stroke-width="2"/>
    <path d="M25.5 33.5 H38.5 M26 39 H38" stroke="${P.band}" stroke-width="2.4"/>
    <circle cx="32" cy="48.5" r="6" fill="${P.band}" ${s()}/>
    ${gem}
    <rect x="28.5" y="54" width="7" height="8" rx="1.8" fill="${P.grip}" ${s()}/>
    <path d="M29 57 L35 55.4 M29 60.4 L35 58.8" stroke="${O}" stroke-width="1.1" opacity="0.6"/>
    <path d="M32 61.5 L35.5 65 L32 68.5 L28.5 65 Z" fill="${P.band}" ${s(1.6)}/>`;
  return wrap(diag(body), defs);
}

export const FAMILIES = [
  {
    id: 'flying',
    names: [
      'Iron Flying Sword',
      'Azure Cloud Flying Sword',
      'Jade Serpent Flying Sword',
      'Golden Crow Flying Sword',
      'Phoenix Flame Flying Sword',
    ],
    draw: flyingSword,
  },
  {
    id: 'whisk',
    names: [
      'Hempen Horsetail Whisk',
      'Azure Silk Whisk',
      'Jade Thread Whisk',
      'Golden Sun Whisk',
      'Phoenix Plume Whisk',
    ],
    draw: whisk,
  },
  {
    id: 'peach',
    names: [
      'Peachwood Sword',
      'Spirit Peachwood Sword',
      'Hundred-Year Peachwood Sword',
      'Thunderstruck Peachwood Sword',
      'Thousand-Year Peachwood Sword',
    ],
    draw: peachwood,
  },
  {
    id: 'fan',
    names: [
      'Feather Fan',
      'Azure Wind Fan',
      'Jade Crane Fan',
      'Golden Cloud Fan',
      'Phoenix Flame Fan',
    ],
    draw: fan,
  },
  {
    id: 'seal',
    names: [
      'Stone Mountain Seal',
      'Azure Peak Seal',
      'Jade Mountain Seal',
      'Golden Mountain Seal',
      'Heaven-Crushing Seal',
    ],
    draw: seal,
  },
  {
    id: 'pestle',
    names: [
      'Iron Vajra Pestle',
      'Azure Thunder Vajra Pestle',
      'Jade Demon-Subduing Vajra Pestle',
      'Golden Vajra Pestle',
      'Phoenix Flame Vajra Pestle',
    ],
    draw: pestle,
  },
];
export { GRADES };
