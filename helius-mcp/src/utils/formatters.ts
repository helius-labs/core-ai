export function formatSol(lamports: number): string {
  return `${(lamports / 1e9).toFixed(4)} SOL`;
}

export function formatAddress(address: string): string {
  return address;
}

export function formatTimestamp(unixTime: number): string {
  return new Date(unixTime * 1000).toISOString();
}

export function formatTokenAmount(amount: number, decimals: number): string {
  return (amount / Math.pow(10, decimals)).toFixed(decimals > 6 ? 6 : decimals);
}
