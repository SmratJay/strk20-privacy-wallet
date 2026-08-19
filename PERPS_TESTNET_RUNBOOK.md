# PEL Private BTC-PERP — Testnet Operator Runbook

**Target Network:** Starknet Sepolia Testnet  
**Core Market:** `BTC-PERP`  
**Explorer:** [Starkscan Sepolia](https://sepolia.starkscan.co) / [Voyager](https://sepolia.voyager.online)  

---

## 1. Deployed Contract Addresses (Sepolia)

| Contract | Address |
| :--- | :--- |
| **`PELPerpsCore`** | `0x0283c7499256247ec691d575c32fa1d5f3083e95085e3a897b6ff03b57f86f7a` |
| **`STRK20Adapter`** | `0x04052f567087093bc2f605fa8618bc321c83ec8971fbebe437e280ffba6d57ba` |
| **`OracleAdapter`** | `0x067a9bb128d5462cf1b4f4c547847c234a961d6ec7a8e52eec89e6ba727df94a` |
| **`StwoVerifier`** | `0x01a357f86d88b43825838ef67252277d33d9c7ba98725893d1421e42a98f1234` |
| **Pragma BTC/USD Median** | `0x02a85bd616f91f7374a182440cb324300184c60142cb6b3357a429da331545f0` |

---

## 2. Operator Lifecycle Workflows

### 1. Build and Run the Protocol Frontend
```bash
# In repository root
npm install
npm run dev
# Open http://localhost:3000 -> Navigate to "Perps" tab
```

### 2. Open a Private BTC-PERP Position
1. Connect Braavos / Argent X wallet on Sepolia.
2. Select **BTC-PERP**, choose **LONG** or **SHORT**, leverage ($2\times - 50\times$), and Margin ($10 - $5,000 USDC).
3. Click **Open Position**:
   - Prover computes private witness and Poseidon commitment $C_0$.
   - Encrypted witness is saved locally into encrypted storage.
   - Wallet prompts transaction calling `PELPerpsCore.open_position`.
   - On confirmation, position is displayed in **Active Private Positions** table with live mark price and PnL.

### 3. Run the Autonomous Keeper Bot
```bash
# In repository root
KEEPER_RECIPIENT_ADDRESS=0x<YOUR_STARKNET_KEEPER_ADDRESS> npx tsx keeper/keeperBot.ts
```
The keeper will:
- Poll on-chain Pragma median price feeds.
- Scan active commitments discovered by `positionIndexerService`.
- Compute solvency invariants ($E_t \le M_{\text{maint}}$).
- Automatically trigger `liquidate_position` and collect $2\%$ liquidation bounties when positions breach maintenance margin.

### 4. Settle / Close a Position
1. In the **Perps** tab under **Active Private Positions**, click **Close Position**.
2. Prover generates `CLOSE` transition fact with verified payout equity.
3. Transaction calls `PELPerpsCore.close_position`.
4. Payout note commitment is registered in `STRK20Adapter`.

---

## 3. Verification & Diagnostic Commands

```bash
# 1. Run full 113-test invariant & adversarial test suite
npx vitest run

# 2. Re-compile Cairo contracts with Scarb
cd contracts && scarb build

# 3. Verify Next.js production bundle
npm run build
```
