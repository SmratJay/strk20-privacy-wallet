import { parseAmountToBase } from '@/wallet/amount';
import type { WalletRuntimeView } from '@/wallet/runtime';

/** Display-only validation. Execution still validates through the wallet/services. */
export function validateWalletAmount(value: string, decimals: number, balance: bigint | null) {
  try {
    const units = parseAmountToBase(value, decimals);
    if (units <= 0n) return { units: 0n, error: 'Enter an amount greater than zero.' };
    if (balance === null) return { units, error: 'Balance is unavailable. Refresh your balance before continuing.' };
    if (units > balance) return { units, error: 'This amount exceeds your available balance.' };
    return { units, error: null };
  } catch {
    return { units: 0n, error: value.trim() ? `Enter a valid amount with up to ${decimals} decimal places.` : 'Enter an amount.' };
  }
}

export function walletErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  if (/password|decrypt/i.test(text)) return 'Unable to unlock this wallet. Check your password and try again.';
  if (/stale|expired|quote moved|slippage/i.test(text)) return 'This quote has changed or expired. Get a fresh quote and review it again.';
  if (/insufficient|exceeds.*balance/i.test(text)) return 'Not enough available funds. Leave some STRK for fees or try a smaller amount.';
  if (/reject|denied|cancel/i.test(text)) return 'The transaction was not approved. Review the details before trying again.';
  if (/CONTRACT_NOT_FOUND|contract not found/i.test(text)) return 'Unable to find this account or asset on the selected network.';
  if (/amount|bigint|decimal/i.test(text)) return 'Enter a valid amount for the selected asset.';
  if (/recipient|address/i.test(text)) return 'Check the recipient address and selected network.';
  if (/locked/i.test(text)) return 'Unlock your wallet to continue.';
  if (/deploy/i.test(text)) return 'Your account needs activation. Add STRK for fees and activate it from Wallet.';
  if (/matur|confirmation|block/i.test(text)) return 'Waiting for network confirmations. Give it a moment, then refresh.';
  if (/configur|unavailable|endpoint|provider|fetch|network|rpc|timeout|service/i.test(text)) return 'This service is unavailable on the selected network. Try again shortly or check Settings.';
  if (/unknown|reconcil/i.test(text)) return 'The transaction status is not confirmed. Check Activity before sending again.';
  return 'We couldn’t complete this action. Check the details below before trying again.';
}

export const networkLabel = (network: string) => network === 'mainnet' ? 'Starknet Mainnet' : 'Starknet Sepolia · Testnet';
export const transactionUrl = (network: string, hash: string) => `${network === 'mainnet' ? 'https://starkscan.co' : 'https://sepolia.starkscan.co'}/tx/${encodeURIComponent(hash)}`;

/** Do not allow another action to spend notes while a submission is unresolved. */
export function walletOperationPending(state: WalletRuntimeView): boolean {
  return [state.privacyOp.phase, state.executionOp.phase, state.swapOp.phase, state.nearIntentOp.phase]
    .some(phase => !['idle', 'success', 'failed', 'reverted', 'rejected', 'refunded', 'expired'].includes(phase));
}
