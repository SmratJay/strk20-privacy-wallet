/**
 * Privacy Core — private execution.
 *
 * The application-execution boundary. `StarknetPrivateExecutor` is the first executor: it turns a
 * minimal `PrivateExecutionIntent` into a safe `PrivateExecutionReceipt` through the STRK20
 * privacy layer (WalletPrivacySession → Strk20Adapter → official SDK), with the shadow identity
 * resolved from the existing `PrivateIdentity` primitive, scoped to the active wallet + network.
 */
export {
  validatePrivateExecutionIntent,
  canonicalFelt,
  IDLE_PRIVATE_EXECUTION,
  type PrivateExecutionAction,
  type PrivateExecutionPhase,
  type PrivateExecutionIntent,
  type PrivateExecutionOpState,
  type PrivateExecutionReceipt,
} from "./types";
export type { PrivateExecutor } from "./PrivateExecutor";
export { StarknetPrivateExecutor, type StarknetPrivateExecutorOptions } from "./StarknetPrivateExecutor";