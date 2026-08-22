# PEL Risk & Capacity Engine

**Document Version:** 1.0.0  
**Specification:** PEL Liquidity & Counterparty System Design v1.0 (22 Aug 2026)

---

## 1. Capacity Limits & Solvency Gates

Before any position is opened or updated, PELPerpsCore and RiskEngine evaluate:

| Parameter | V1 Baseline | Purpose |
|---|---|---|
| **Max Leverage** | 50x Nominal | Hard user-level leverage ceiling |
| **Max Gross Open Interest** | 2.0x LP NAV | Caps total directional exposure |
| **Max Net Directional Skew** | 0.5x LP NAV | Caps one-sided market risk |
| **Single Position Cap** | 5% LP NAV | Prevents single-whale domination |
| **Maintenance Margin** | 2.00% | Liquidation threshold |
| **Reserve Buffer** | 50% Locked Margin | Solvency buffer preventing pool drain |
| **Withdrawal Cooldown** | 1 Funding Epoch (1 hr) | Prevents JIT deposit/withdrawal arbitrage |
| **Max Execution Deviation** | 100 bps (1.0%) | Binds execution against oracle |

---

## 2. Liquidation Waterfall

1. **Trader Remaining Collateral**: Seized as first-loss capital.
2. **Keeper Bounty**: 2% of seized remainder (capped at .00).
3. **Loss Distribution**: 70% to LP NAV, 20% to Insurance Reserve, 10% to Treasury.
4. **Underwater Deficit (Bad Debt)**: Absorbed by PELInsuranceReserve before emergency LP drawdown.
