// NEAR Intents 1Click API — live probe (read-only, keyless, no funds moved).
//
// Verifies the REAL integration surface the near-intents adapter talks to:
//   1. GET  /v0/tokens                 → confirm STRK (Starknet) + Base USDC asset ids
//   2. POST /v0/quote  (dry: true)     → confirm real pricing
//   3. POST /v0/quote  (dry: false)    → confirm a real Starknet deposit address is reserved
//   4. GET  /v0/status                 → confirm status shape (PENDING_DEPOSIT)
//
// The non-dry quote reserves an unfunded deposit address that expires on its own (no funds, no
// execution). Usage: node scripts/near-intents-probe.mjs
const BASE = "https://1click.chaindefuser.com";
const ORIGIN = "nep141:starknet.omft.near";
const DEST = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const RECIPIENT = "0x742d35cc6634c0532925a3b8d84b2021f90a51a3";
const REFUND_TO = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
const AMOUNT = "2000000000000000000"; // 2 STRK

async function main() {
  const tokens = await (await fetch(`${BASE}/v0/tokens`)).json();
  const strk = tokens.find((t) => t.symbol === "STRK" && t.blockchain === "starknet");
  const usdc = tokens.find((t) => t.symbol === "USDC" && t.blockchain === "base");
  console.log("[tokens] STRK:", strk?.assetId, "| Base USDC:", usdc?.assetId);

  const dry = await post(`${BASE}/v0/quote`, {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: ORIGIN,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: DEST,
    amount: AMOUNT,
    recipient: RECIPIENT,
    recipientType: "DESTINATION_CHAIN",
    refundTo: REFUND_TO,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
  });
  console.log("[dry quote] amountOut:", dry.quote?.amountOut, "minAmountOut:", dry.quote?.minAmountOut);

  const live = await post(`${BASE}/v0/quote`, {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: ORIGIN,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: DEST,
    amount: AMOUNT,
    recipient: RECIPIENT,
    recipientType: "DESTINATION_CHAIN",
    refundTo: REFUND_TO,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(Date.now() + 60 * 1000).toISOString(),
  });
  console.log("[live quote] depositAddress:", live.quote?.depositAddress, "correlationId:", live.correlationId);

  if (live.quote?.depositAddress) {
    const status = await (await fetch(`${BASE}/v0/status?depositAddress=${live.quote.depositAddress}`)).json();
    console.log("[status] code:", status.status, "depositAddress:", live.quote.depositAddress);
  }
}

async function post(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(json)}`);
  return json;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
