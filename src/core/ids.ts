/** Pluggable ID/clock so core logic stays deterministic in tests. */

let generator: () => string = defaultUuid;
let clock: () => Date = () => new Date();

function defaultUuid(): string {
  // RFC4122 v4 layout. The app swaps this for expo-crypto's CSPRNG-backed randomUUID.
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[(Math.random() * 4) | 8];
    else out += hex[(Math.random() * 16) | 0];
  }
  return out;
}

export const newId = (): string => generator();
export const now = (): Date => clock();
export const nowIso = (): string => clock().toISOString();

export function setIdGenerator(fn: () => string): void {
  generator = fn;
}

export function setClock(fn: () => Date): void {
  clock = fn;
}

export function resetDeterminism(): void {
  generator = defaultUuid;
  clock = () => new Date();
}
