import { num } from 'starknet';

export function shortenAddress(address?: string, chars = 4): string {
  if (!address) return '';
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatTokenAmount(amount: bigint | string | number, decimals = 18, precision = 4): string {
  try {
    const bigAmount = typeof amount === 'bigint' ? amount : BigInt(amount.toString());
    const divisor = BigInt(10 ** decimals);
    const integerPart = bigAmount / divisor;
    const remainder = bigAmount % divisor;
    
    if (remainder === 0n) {
      return integerPart.toString();
    }
    
    const remainderStr = remainder.toString().padStart(decimals, '0');
    const trimmed = remainderStr.slice(0, precision).replace(/0+$/, '');
    
    return trimmed.length > 0 ? `${integerPart}.${trimmed}` : integerPart.toString();
  } catch {
    return '0.00';
  }
}

export function parseTokenAmount(amount: string, decimals = 18): bigint {
  if (!amount || isNaN(Number(amount))) return 0n;
  const [integerPart, fractionalPart = ''] = amount.split('.');
  const safeInteger = integerPart && integerPart.trim() !== '' ? integerPart : '0';
  const paddedFraction = fractionalPart.slice(0, decimals).padEnd(decimals, '0');
  const fullStr = `${safeInteger}${paddedFraction}`;
  try {
    return BigInt(fullStr);
  } catch {
    return 0n;
  }
}

export function areFeltAddressesEqual(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  try {
    return BigInt(num.toHex(a)) === BigInt(num.toHex(b));
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}
