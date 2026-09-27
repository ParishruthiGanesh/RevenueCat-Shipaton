/**
 * On-device text understanding primitives: normalisation, synonym expansion and a
 * deterministic hashed embedding. This gives useful fuzzy/semantic matching fully offline;
 * when cloud AI is enabled, provider embeddings (see src/ai/embeddings.ts) are layered on top.
 */

const STOP = new Set(
  'a an the my your our their his her its this that these those is are was were be been of in on at to for with from into onto by and or where what which who whom when did do does have has had i me we you it thing things stuff little small big one ones use used using put left keep kept store stored find show tell please last seen'.split(
    ' ',
  ),
);

/** Lightweight household-object synonym groups. First term is the canonical form. */
const SYNONYM_GROUPS: string[][] = [
  ['charger', 'adapter', 'power brick', 'power adapter', 'plug', 'wall charger', 'charging block'],
  ['cable', 'cord', 'wire', 'lead'],
  ['earbuds', 'airpods', 'earphones', 'buds', 'in-ear'],
  ['headphones', 'headset', 'over-ear', 'cans'],
  ['laptop', 'macbook', 'notebook computer', 'computer'],
  ['phone', 'iphone', 'smartphone', 'mobile', 'cellphone'],
  ['passport', 'travel document'],
  ['documents', 'papers', 'paperwork', 'files', 'document'],
  ['keys', 'key', 'keyring', 'key ring', 'keychain'],
  ['wallet', 'purse', 'billfold', 'cardholder'],
  ['glasses', 'spectacles', 'eyeglasses', 'specs', 'reading glasses'],
  ['sunglasses', 'shades'],
  ['medication', 'medicine', 'meds', 'pills', 'tablets', 'prescription'],
  ['power bank', 'battery pack', 'portable charger', 'powerbank'],
  ['hub', 'dongle', 'dock', 'usb hub', 'multiport'],
  ['hdmi', 'display adapter', 'video adapter', 'monitor adapter'],
  ['box', 'bin', 'tote', 'crate', 'carton'],
  ['drawer', 'drawers'],
  ['shelf', 'shelves', 'rack', 'shelving'],
  ['cabinet', 'cupboard', 'closet', 'wardrobe'],
  ['bag', 'backpack', 'rucksack', 'tote bag', 'daypack'],
  ['suitcase', 'luggage', 'carry-on', 'roller bag'],
  ['pouch', 'case', 'sleeve', 'organizer'],
  ['screwdriver', 'screwdrivers', 'driver set'],
  ['drill', 'power drill', 'driver drill'],
  ['camera', 'dslr', 'mirrorless', 'point and shoot'],
  ['winter clothes', 'coats', 'sweaters', 'jackets', 'scarves', 'winter clothing'],
  ['batteries', 'battery', 'aa', 'aaa'],
  ['coffee grinder', 'grinder', 'burr grinder'],
  ['mug', 'mugs', 'cup', 'cups'],
  ['watch', 'smartwatch', 'wristwatch'],
  ['remote', 'remote control', 'clicker'],
  ['ssd', 'external drive', 'hard drive', 'external ssd', 'storage drive'],
  ['usb-c', 'usb c', 'type-c', 'type c', 'thunderbolt'],
  ['christmas lights', 'fairy lights', 'string lights', 'holiday lights'],
  ['dresser', 'chest of drawers', 'bureau'],
  ['nightstand', 'bedside table', 'night table'],
  ['desk', 'workstation', 'writing desk'],
];

const CANON = new Map<string, string>();
for (const group of SYNONYM_GROUPS) for (const t of group) CANON.set(t, group[0]);

export const COLOR_WORDS = [
  'black',
  'white',
  'grey',
  'gray',
  'silver',
  'gold',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'navy',
  'purple',
  'pink',
  'brown',
  'beige',
  'tan',
  'clear',
  'transparent',
];

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]s\b/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t && !STOP.has(t));
}

/** Tokens plus canonical synonyms for single words and bigrams. */
export function expandedTokens(s: string): string[] {
  const t = normalize(s).split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i < t.length; i++) {
    const w = t[i];
    if (!STOP.has(w)) out.add(stem(w));
    const c1 = CANON.get(w);
    if (c1) out.add(stem(c1));
    if (i + 1 < t.length) {
      const bi = `${w} ${t[i + 1]}`;
      const c2 = CANON.get(bi);
      if (c2) out.add(stem(c2));
    }
    if (i + 2 < t.length) {
      const c3 = CANON.get(`${w} ${t[i + 1]} ${t[i + 2]}`);
      if (c3) out.add(stem(c3));
    }
  }
  return [...out];
}

export function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('es') && /(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function colorsIn(s: string): string[] {
  const n = ` ${normalize(s)} `;
  return COLOR_WORDS.filter((c) => n.includes(` ${c} `)).map((c) => (c === 'gray' ? 'grey' : c));
}

// ───────────────────────────── hashed embedding ─────────────────────────────

export const LOCAL_EMBEDDING_MODEL = 'pm-hash-v1';
export const LOCAL_EMBEDDING_DIM = 384;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Feature-hashed embedding over (expanded) words and character trigrams.
 * Captures lexical + synonym + typo-tolerant similarity. L2-normalised.
 */
export function localEmbed(text: string): number[] {
  const v = new Array<number>(LOCAL_EMBEDDING_DIM).fill(0);
  const add = (feat: string, w: number) => {
    const h = fnv1a(feat);
    v[h % LOCAL_EMBEDDING_DIM] += (h & 0x80000000 ? -1 : 1) * w;
  };
  for (const t of expandedTokens(text)) {
    add(`w:${t}`, 2.0);
    const padded = `#${t}#`;
    for (let i = 0; i + 3 <= padded.length; i++) add(`c:${padded.slice(i, i + 3)}`, 0.5);
  }
  return l2(v);
}

export function l2(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
  return n === 0 ? v : v.map((x) => x / n);
}

export function cosine(a: number[] | undefined, b: number[] | undefined): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Jaccard overlap of expanded token sets. */
export function tokenOverlap(a: string, b: string): number {
  const A = new Set(expandedTokens(a));
  const B = new Set(expandedTokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((t) => B.has(t) && inter++);
  return inter / (A.size + B.size - inter);
}

/** Share of query tokens found in the document (asymmetric; good for short queries). */
export function queryCoverage(query: string, doc: string): number {
  const Q = expandedTokens(query);
  if (!Q.length) return 0;
  const D = new Set(expandedTokens(doc));
  return Q.filter((t) => D.has(t)).length / Q.length;
}
