/** A recomputed hash with the characters that differ from the committed one marked in red (underlined, not colour alone). */
export function HashDiff({ a, b }: { a: string; b: string }) {
  if (a === b) return <span className="hash">{b}</span>;
  return <span className="hash">{[...b].map((ch, i) => (ch === a[i] ? ch : <span key={i} className="diff">{ch}</span>))}<span className="sr-only"> (differs from the committed root)</span></span>;
}
