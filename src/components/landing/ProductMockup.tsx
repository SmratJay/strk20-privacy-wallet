import { ArrowLeftRight, CandlestickChart, LockKeyhole, Send, ShieldCheck, WalletCards } from 'lucide-react';

const actions = [
  { label: 'Send', Icon: Send },
  { label: 'Shield', Icon: ShieldCheck },
  { label: 'Swap', Icon: ArrowLeftRight },
  { label: 'Trade', Icon: CandlestickChart },
];

export function ProductMockup() {
  return (
    <div className="orrange-product-float">
      <div className="orrange-product-tilt">
        <article className="orrange-product-window" id="product" aria-label="ORRANGE wallet preview">
          <div className="orrange-product-topline">
            <div className="orrange-product-brand"><span className="orrange-product-mark"><img src="/orrange.png" alt="" aria-hidden="true" /></span><span>ORRANGE</span></div>
            <span className="orrange-product-status"><span /> STRK20 / PREVIEW</span>
          </div>

          <div className="orrange-product-heading">
            <div>
              <span className="orrange-product-label">Total balance</span>
              <strong>$12,483.21</strong>
            </div>
            <span className="orrange-product-lock"><LockKeyhole aria-hidden="true" /> Wallet-owned</span>
          </div>

          <div className="orrange-balance-split" aria-label="Balance breakdown">
            <div><span>Public</span><strong>$4,203.18</strong></div>
            <div><span>Private</span><strong>$8,280.03</strong></div>
          </div>

          <div className="orrange-product-actions" aria-label="Available actions">
            {actions.map(({ label, Icon }) => <span key={label}><Icon aria-hidden="true" /> {label}</span>)}
          </div>

          <div className="orrange-assets-heading"><span>Private assets</span><span>STRK20 pool</span></div>
          <div className="orrange-asset-list">
            <div className="orrange-asset-row"><span className="orrange-asset-icon orrange-asset-icon-strk">S</span><span><strong>STRK</strong><small>Starknet</small></span><b>$4,280.21</b></div>
            <div className="orrange-asset-row"><span className="orrange-asset-icon orrange-asset-icon-usdc">$</span><span><strong>USDC</strong><small>USD Coin</small></span><b>$3,421.00</b></div>
          </div>

          <div className="orrange-product-foot"><span><WalletCards aria-hidden="true" /> Private balance</span><span>Demo values · not live</span></div>
        </article>
      </div>
    </div>
  );
}
