export const LAMPORTS_PER_SOL = 1_000_000_000;

export function formatSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  if (sol === 0) return '0 SOL';
  return `${sol.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 9 })} SOL`;
}

export function formatAddress(address: string): string {
  return address;
}

export function formatTimestamp(unixTime: number): string {
  return new Date(unixTime * 1000).toISOString();
}

export function formatTokenAmount(amount: number, decimals: number): string {
  const adjusted = amount / Math.pow(10, decimals);
  return adjusted.toLocaleString(undefined, { maximumFractionDigits: Math.min(decimals, 6) });
}

export function formatSolCompact(lamports: number): string {
  return `${(lamports / LAMPORTS_PER_SOL).toLocaleString(undefined, { maximumFractionDigits: 0 })} SOL`;
}
