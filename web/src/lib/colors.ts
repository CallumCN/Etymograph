// Categorical palette restricted to shades of grey, blue, red, and green,
// so any number of distinct languages/lexemes can get a stable color
// without drifting into unrelated hues.
const PALETTE = [
  '#2f5fa8', // blue
  '#a13a3a', // red
  '#2e7d4f', // green
  '#6b6e72', // grey
  '#5b84c4', // light blue
  '#c96a6a', // light red
  '#4fa374', // light green
  '#9a9a9a', // light grey
  '#1d3f73', // dark blue
  '#73211f', // dark red
  '#1f5c38', // dark green
  '#45484c', // dark grey
];

const assigned = new Map<string, string>();
let next = 0;

export function colorFor(id: string): string {
  if (!assigned.has(id)) {
    assigned.set(id, PALETTE[next % PALETTE.length]);
    next += 1;
  }
  return assigned.get(id)!;
}
