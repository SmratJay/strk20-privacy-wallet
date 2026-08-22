# PEL LP Economic Model & Solvency

**Document Version:** 1.0.0  
**Specification:** PEL Liquidity & Counterparty System Design v1.0 (22 Aug 2026)

---

## 1. Economic Counterparty Symmetry

A perpetual position is an economic promise:
- **When a trader profits**: Trader receives value from LP Pool NAV (and Insurance Reserve for tail losses).
- **When a trader loses**: LP Pool NAV increases by the realized loss (+70% to LP NAV, 20% to Insurance, 10% to Treasury).
- **When a position is liquidated**: Trader remaining collateral is seized. The keeper receives a bounded bounty (2% capped at .00), and remaining collateral enters the Insurance and LP pools.

```
Trader Equity = margin + PnL - funding - fees
Pool NAV = LiquidCash + RealizedLosses - RealizedProfits - PendingClaims - ReservedBuffer
```

---

## 2. LP Shares & Proportional Pricing

LPs own pro-rata shares of the pool NAV.

```
SharePrice = NAV / TotalShares
```

### Deposit Math (Fair Entry)
New LPs do **not** capture historical PnL:

```
SharesMinted = floor(DepositAmount * TotalShares / NAV)
```

### Withdrawal Math
```
GrossPayout = floor(SharesBurned * NAV / TotalShares)
```

---

## 3. Transparent Fee Distribution

- **70% of Trading Fees & Losses** -> LP Pool NAV (compensates LPs for taking counterparty risk).
- **20% of Trading Fees & Losses** -> PEL Insurance Reserve (builds tail-risk cushion).
- **10% of Trading Fees & Losses** -> Protocol Treasury (infrastructure & relayer funding).
