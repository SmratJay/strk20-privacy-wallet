# PEL LP Security & Attack Model

**Document Version:** 1.0.0  
**Specification:** PEL Liquidity & Counterparty System Design v1.0 (22 Aug 2026)

---

## 1. Threat Vectors & Defenses

| Attack Vector | Vulnerability Mechanism | PEL Defense Implemented |
|---|---|---|
| **First Depositor Inflation** | Manipulate initial share price by donating assets | Virtual shares bootstrap (1:1 fixed bootstrap + scaled integer math) |
| **Late LP PnL Capture** | Deposit right before a known settlement | 1-hour withdrawal cooldown + NAV snapshot policy |
| **Reserve Draining** | Withdraw shares while trader obligations exist | calcAvailableLiquidity enforces 50% locked margin reserve buffer |
| **Profit Insolvency** | High trader leverage drains pool | Max Gross OI (2.0x NAV) + Net OI (0.5x NAV) + Insurance Reserve |
| **Double Liquidation** | Replaying liquidation proofs | Nullifier tracking table (used_nullifiers in Cairo) |
| **Keeper Bounty Exploitation** | Liquidators claiming arbitrary fees | On-chain contract computes min(2% * seized,  cap) |
