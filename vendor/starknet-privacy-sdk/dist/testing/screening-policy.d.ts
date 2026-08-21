import type { Account, RpcProvider } from "starknet";
/**
 * Lists `depositor` as an open-note depositor whose deposits carry no screening requirement.
 *
 * An Invoke target that funds open notes and carries no policy is the transaction's screening
 * subject, so the pool demands an attestation naming the target itself. Anonymizers and executors
 * act on behalf of many users and are exempt on the deployed pools, so a devnet exercising those
 * flows has to list them too, or every deposit through one reverts with `SCREENING_REQUIRED`.
 *
 * `admin` deploys the pool as its governance admin, which is not the role that sets policies. Walk
 * the pool's role graph the same way its Cairo test harness does: the governance admin grants
 * itself `AppRoleAdmin`, which grants it `AppGovernor`, which may then set the policy. All three
 * calls ride one transaction, in order. Re-granting a held role is a no-op, so calling this for
 * several depositors is safe.
 */
export declare function exemptOpenNoteDepositor(admin: Account, provider: RpcProvider, poolAddress: string, depositor: string): Promise<void>;
//# sourceMappingURL=screening-policy.d.ts.map