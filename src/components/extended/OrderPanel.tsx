'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  Loader2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { Balance, Market } from '@/extended/types';
import type { PlaceOrderParams } from '@/extended/adapter';

const fmt = (v: string | number | undefined, dp = 2): string => {
  if (v === undefined || v === null || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
};

const ORDER_STATUS_COLORS: Record<string, string> = {
  SUBMITTED: 'text-amber-400',
  NEW: 'text-amber-400',
  UNTRIGGERED: 'text-amber-400',
  PARTIALLY_FILLED: 'text-orange-400',
  FILLED: 'text-emerald-400',
  CANCELLED: 'text-zinc-400',
  REJECTED: 'text-rose-400',
  EXPIRED: 'text-zinc-500',
};

export type OrderSide = 'BUY' | 'SELL';
export type OrderKind = 'LIMIT' | 'MARKET';

interface OrderPanelProps {
  market: Market | null;
  balance: Balance | null;
  canTrade: boolean;
  leverage: string;
  leverageLoading: boolean;
  setLeverageForMarket: (v: string) => Promise<void>;
  submitting: boolean;
  lastOrder: { id: number; externalId: string } | null;
  lastOrderStatus: string | null;
  trackingOrder: boolean;
  actionError: string | null;
  clearActionError: () => void;
  placeOrder: (params: Omit<PlaceOrderParams, 'market'> & { market?: string }) => Promise<unknown>;
  /** A price chosen from the order book (side is which side the level is on). */
  orderBookPrice?: { price: string; side: 'BUY' | 'SELL' } | null;
  setOrderBookPrice: (v: { price: string; side: 'BUY' | 'SELL' } | null) => void;
}

export function OrderPanel(props: OrderPanelProps) {
  const {
    market,
    balance,
    canTrade,
    leverage,
    leverageLoading,
    setLeverageForMarket,
    submitting,
    lastOrder,
    lastOrderStatus,
    trackingOrder,
    actionError,
    clearActionError,
    placeOrder,
    orderBookPrice,
    setOrderBookPrice,
  } = props;

  const [side, setSide] = useState<OrderSide>('BUY');
  const [orderType, setOrderType] = useState<OrderKind>('LIMIT');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [leverageInput, setLeverageInput] = useState('');

  const mark = market?.marketStats.markPrice ?? '0';
  const maxLeverage = Number(market?.tradingConfig.maxLeverage ?? 1) || 1;
  const minOrderSize = market?.tradingConfig.minOrderSize;
  const minPriceChange = market?.tradingConfig.minPriceChange;

  const effectivePrice = orderType === 'MARKET' ? mark : price || mark;

  useEffect(() => {
    if (!qty && minOrderSize) setQty(minOrderSize);
  }, [minOrderSize, qty]);

  useEffect(() => {
    if (leverage && !leverageInput) setLeverageInput(leverage);
  }, [leverage, leverageInput]);

  // Apply a price selected from the order book (and switch to limit mode).
  useEffect(() => {
    if (orderBookPrice) {
      setOrderType('LIMIT');
      setPrice(orderBookPrice.price);
      setSide(orderBookPrice.side);
      setOrderBookPrice(null);
    }
  }, [orderBookPrice, setOrderBookPrice]);

  const qtyNum = Number(qty || 0);
  const priceNum = Number(effectivePrice || 0);
  const notional = qtyNum * priceNum;
  const lev = Math.max(1, Number(leverageInput || 1));
  const estMargin = notional / lev;

  const errors: string[] = useMemo(() => {
    const out: string[] = [];
    if (!market) {
      out.push('Select a market to trade.');
      return out;
    }
    if (qtyNum <= 0) out.push('Enter a quantity.');
    else if (minOrderSize && qtyNum < Number(minOrderSize)) out.push(`Size must be at least ${minOrderSize} ${market.assetName}.`);
    if (orderType === 'LIMIT' && priceNum <= 0) out.push('Enter a limit price.');
    if (minPriceChange && orderType === 'LIMIT' && Number(price) > 0 && Number(price) % Number(minPriceChange) !== 0) {
      out.push(`Price tick must be a multiple of ${minPriceChange}.`);
    }
    if (lev < 1) out.push('Leverage must be at least 1x.');
    if (lev > maxLeverage) out.push(`Leverage cannot exceed ${maxLeverage}x.`);
    if (notional <= 0) out.push('Order value must be positive.');
    else if (market.tradingConfig.maxMarketOrderValue && orderType === 'MARKET' && notional > Number(market.tradingConfig.maxMarketOrderValue)) {
      out.push(`Market order exceeds max value $${fmt(market.tradingConfig.maxMarketOrderValue, 0)}.`);
    }
    if (estMargin > 0 && balance) {
      const available = Number(balance.availableForTrade ?? 0);
      if (estMargin > available) out.push(`Requires $${fmt(estMargin)} margin but only $${fmt(available)} is available.`);
    }
    return out;
  }, [market, qtyNum, priceNum, orderType, price, minOrderSize, minPriceChange, lev, maxLeverage, notional, estMargin, balance]);

  // Taker fee is 5 bps by default (matches server-side order signing). A live per-market
  // fee schedule would come from GET /user/fees — we never invent one locally.
  const estFee = notional * 0.0005;

  const handleSubmit = async () => {
    clearActionError();
    try {
      await placeOrder({
        market: market?.name ?? '',
        side,
        qty: String(qty),
        price: String(effectivePrice),
        type: orderType,
        timeInForce: orderType === 'MARKET' ? 'IOC' : 'GTT',
        reduceOnly: reduceOnly || undefined,
      });
    } catch {
      // Error is surfaced via actionError.
    }
  };

  const statusColor = ORDER_STATUS_COLORS[lastOrderStatus ?? ''] ?? 'text-zinc-400';

  return (
    <div className="border border-zinc-800 bg-zinc-950/60 rounded-lg p-4 space-y-3 sticky top-16">
      <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-400 flex items-center gap-2">
        <ArrowLeftRight className="w-3.5 h-3.5" /> Place Order — {market?.name ?? '…'}
      </h2>

      {/* Side */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setSide('BUY')}
          className={`py-2 rounded text-xs font-bold transition-colors ${side === 'BUY' ? 'bg-emerald-500 text-black' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
        >
          <TrendingUp className="w-4 h-4 inline mr-1" /> Long
        </button>
        <button
          onClick={() => setSide('SELL')}
          className={`py-2 rounded text-xs font-bold transition-colors ${side === 'SELL' ? 'bg-rose-500 text-black' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
        >
          <TrendingDown className="w-4 h-4 inline mr-1" /> Short
        </button>
      </div>

      {/* Type */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setOrderType('LIMIT')}
          className={`py-1.5 rounded text-[11px] font-mono font-bold border transition-colors ${orderType === 'LIMIT' ? 'border-orange-500 text-orange-400 bg-orange-500/10' : 'border-zinc-800 text-zinc-400'}`}
        >
          Limit
        </button>
        <button
          onClick={() => setOrderType('MARKET')}
          className={`py-1.5 rounded text-[11px] font-mono font-bold border transition-colors ${orderType === 'MARKET' ? 'border-orange-500 text-orange-400 bg-orange-500/10' : 'border-zinc-800 text-zinc-400'}`}
        >
          Market
        </button>
      </div>

      {/* Leverage */}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">
          Leverage (max {maxLeverage}x)
        </label>
        <div className="flex items-center gap-2 mt-1">
          <input
            type="number"
            min={1}
            max={maxLeverage}
            step={1}
            value={leverageInput}
            onChange={(e) => setLeverageInput(e.target.value)}
            onBlur={() => {
              const v = Number(leverageInput);
              if (leverageInput && v >= 1 && v <= maxLeverage && leverageInput !== leverage) {
                void setLeverageForMarket(String(Math.floor(v)));
              }
            }}
            className="w-24 px-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-orange-500 rounded text-sm font-mono outline-none"
          />
          <span className="text-xs font-mono text-zinc-500">x</span>
          <button
            onClick={() => {
              const v = String(maxLeverage);
              setLeverageInput(v);
              void setLeverageForMarket(v);
            }}
            disabled={!canTrade || leverageLoading}
            className="text-[10px] font-mono px-2 py-1.5 border border-zinc-700 text-zinc-400 hover:text-white disabled:opacity-40"
          >
            Max
          </button>
          {leverageLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
        </div>
      </div>

      {/* Quantity */}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">
          Quantity ({market?.assetName ?? 'asset'})
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder={minOrderSize ? `min ${minOrderSize}` : '0.00'}
          className="w-full mt-1 px-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-orange-500 rounded text-sm font-mono outline-none"
        />
      </div>

      {/* Price */}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">
          {orderType === 'MARKET' ? 'Price (mark — worst accepted)' : 'Limit Price (USDC)'}
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={orderType === 'MARKET' ? mark : price}
          onChange={(e) => setPrice(e.target.value)}
          disabled={orderType === 'MARKET'}
          placeholder={orderType === 'MARKET' ? 'Mark price' : '0.00'}
          className="w-full mt-1 px-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-orange-500 rounded text-sm font-mono outline-none disabled:opacity-60"
        />
      </div>

      {/* Available / estimates */}
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-zinc-400">
        <div className="border border-zinc-800 rounded p-2">
          <div className="text-[9px] uppercase text-zinc-500">Est. Notional</div>
          <div className="font-bold text-white">${fmt(notional || 0)}</div>
        </div>
        <div className="border border-zinc-800 rounded p-2">
          <div className="text-[9px] uppercase text-zinc-500">Est. Margin ({lev}x)</div>
          <div className="font-bold text-purple-300">${fmt(estMargin || 0)}</div>
        </div>
        <div className="border border-zinc-800 rounded p-2">
          <div className="text-[9px] uppercase text-zinc-500">Est. Fee</div>
          <div className="font-bold text-orange-300">${fmt(estFee)}</div>
        </div>
        <div className="border border-zinc-800 rounded p-2">
          <div className="text-[9px] uppercase text-zinc-500">Available</div>
          <div className="font-bold text-emerald-400">${fmt(balance?.availableForTrade)}</div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
        <input
          type="checkbox"
          checked={reduceOnly}
          onChange={(e) => setReduceOnly(e.target.checked)}
          className="accent-orange-500"
        />
        Reduce-only
      </label>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div className="space-y-1">
          {errors.map((e) => (
            <div key={e} className="text-[11px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded p-1.5 font-mono">
              {e}
            </div>
          ))}
        </div>
      )}

      {actionError && (
        <div className="text-[11px] text-rose-400 border border-rose-500/30 bg-rose-500/10 rounded p-2 font-mono break-words">
          {actionError}
        </div>
      )}

      <button
        disabled={!canTrade || submitting || errors.length > 0 || !market}
        onClick={() => void handleSubmit()}
        className={`w-full py-3 rounded text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          side === 'BUY' ? 'bg-emerald-500 hover:bg-emerald-400 text-black' : 'bg-rose-500 hover:bg-rose-400 text-black'
        }`}
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Submitting…
          </span>
        ) : side === 'BUY' ? (
          reduceOnly ? 'Close Short (Reduce)' : 'Buy / Long'
        ) : (
          reduceOnly ? 'Close Long (Reduce)' : 'Sell / Short'
        )}
      </button>

      {/* Order lifecycle */}
      {lastOrder && (
        <div className={`flex items-start gap-2 text-[11px] font-mono border rounded p-2 ${statusColor} ${statusColor === 'text-emerald-400' || statusColor === 'text-rose-400' ? 'border-current/30' : 'border-zinc-700/60'} bg-zinc-900/40 break-words`}>
          {trackingOrder ? <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : lastOrderStatus === 'FILLED' ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : null}
          <div>
            <div>
              Extended order <span className="text-white">#{lastOrder.id}</span> — <span className={`font-bold ${statusColor}`}>{lastOrderStatus ?? 'SUBMITTED'}</span>
            </div>
            {trackingOrder && <div className="text-zinc-500">Waiting for Extended to confirm the order…</div>}
          </div>
        </div>
      )}

      {!canTrade && (
        <p className="text-[10px] text-zinc-600 font-mono">
          Connect your Ready wallet and complete Extended onboarding above to unlock trading.
        </p>
      )}
    </div>
  );
}