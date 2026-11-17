export function signingDecisionFits(decision: unknown): boolean {
  const encoded=JSON.stringify(decision);
  return encoded!==undefined && new TextEncoder().encode(encoded).length<=12000;
}
