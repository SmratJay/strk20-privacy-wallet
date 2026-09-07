/** Solana addresses are case-sensitive base58 encodings of exactly 32 bytes. */
export function isSolanaAddress(value: string): boolean {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  let decoded = 0n;
  for (const char of value) decoded = decoded * 58n + BigInt(alphabet.indexOf(char));
  let bytes = 0;
  while (decoded > 0n) { bytes++; decoded >>= 8n; }
  const zeros = value.match(/^1*/)?.[0].length ?? 0;
  return bytes + zeros === 32;
}

export function validateChainAddress(value: unknown, kind: 'evm' | 'solana'): string | null {
  if (typeof value !== 'string') return 'destination address must be a string';
  if (kind === 'solana') return isSolanaAddress(value) ? null : 'Enter a valid Solana address (32-byte base58).';
  return /^0x[0-9a-fA-F]{40}$/.test(value) && BigInt(value) !== 0n
    ? null : 'malformed destination address (expected a nonzero EVM 0x address)';
}

export function sameDestination(a: string, b: string, chain: 'base' | 'solana'): boolean {
  return chain === 'solana' ? a === b : a.toLowerCase() === b.toLowerCase();
}
