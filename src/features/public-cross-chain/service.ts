import { uint256, type Call } from 'starknet';
import type { WalletStorage } from '@/wallet/storage';
import { NearIntentClient, type OneClickQuoteRequest, type OneClickQuoteResponse } from '@/features/near-intents/client';
import { loadNearIntentRoutes } from '@/features/near-intents/registry';
import { validateChainAddress } from '@/features/near-intents/address';
import { isValidStarknetAddress } from '@/features/near-intents/types';
import { NEAR_INTENT_SOURCE_TOKEN, type NearIntentRoute } from '@/features/near-intents/routes';

export interface PublicCrossInput { routeId: string; amount: bigint; recipient: string; slippageBps: number }
export interface PublicCrossQuote {
  id: string; route: NearIntentRoute; amount: string; recipient: string; refundTo: string;
  amountOut: string; minAmountOut: string; refundFee: string | null; withdrawFee: string | null;
  slippageBps: number; expiresAt: number; timeEstimate: number; depositAddress?: string; networkFee?: string;
}
export interface PublicCrossReceipt {
  version: 1; walletId: string; network: 'mainnet'; quote: PublicCrossQuote;
  phase: 'submitting' | 'pending' | 'unknown' | 'success' | 'refunded' | 'recovery-required';
  transactionHash: string | null; destinationTxHashes: string[]; amountOut: string | null;
  refundedAmount: string | null; message: string; updatedAt: number;
}
interface Dependencies {
  walletId: string; address: string; network: string; storage: WalletStorage;
  assertActive(): void; balance(): Promise<bigint>; estimate(calls: Call[]): Promise<bigint>;
  send(calls: Call[]): Promise<{ transactionHash: string }>;
  client?: NearIntentClient; routes?: () => Promise<NearIntentRoute[]>;
}
const integer = (value: unknown): value is string => typeof value === 'string' && /^\d+$/.test(value);
const terminal = (r: PublicCrossReceipt) => r.phase === 'success' || r.phase === 'refunded';
const executing = new Set<string>();
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Explicit PUBLIC funding. This service never accepts private notes or calls a privacy fallback. */
export class PublicCrossChainService {
  private readonly client: NearIntentClient;
  private readonly issued = new Map<string, PublicCrossQuote>();
  private readonly key: string;
  constructor(private readonly d: Dependencies) {
    this.client = d.client ?? new NearIntentClient();
    this.key = `orrange_public_cross_swap:${d.network}:${d.walletId}`;
  }
  private active() {
    this.d.assertActive();
    if (this.d.network !== 'mainnet') throw new Error('Cross-chain settlement requires Starknet Mainnet. Sepolia tokens cannot be swapped to other chains.');
    if (!isValidStarknetAddress(this.d.address)) throw new Error('Invalid source wallet address.');
  }
  readReceipt(): PublicCrossReceipt | null {
    const raw = this.d.storage.getItem(this.key);
    if (!raw) return null;
    try {
      const r = JSON.parse(raw) as PublicCrossReceipt;
      if (r.version !== 1 || r.walletId !== this.d.walletId || r.network !== 'mainnet'
        || !r.quote || !isValidStarknetAddress(r.quote.depositAddress ?? '')
        || !integer(r.quote.amount) || !integer(r.quote.minAmountOut)
        || !['submitting','pending','unknown','success','refunded','recovery-required'].includes(r.phase)) throw new Error();
      return r;
    } catch { throw new Error('The saved cross-chain receipt is unreadable. Recover it before sending another deposit.'); }
  }
  private persist(r: PublicCrossReceipt) {
    const raw = JSON.stringify(r);this.d.storage.setItem(this.key, raw);
    if (this.d.storage.getItem(this.key) !== raw) throw new Error('Could not save the swap receipt. Keep this window open and do not send again.');
  }
  private available() {
    this.active();const r=this.readReceipt();
    if (r && !terminal(r)) throw new Error('An existing cross-chain deposit needs reconciliation. Check its status before starting another swap.');
  }
  private request(q: Pick<PublicCrossQuote,'route'|'amount'|'recipient'|'slippageBps'|'refundTo'>, dry: boolean): OneClickQuoteRequest {
    return { dry, swapType:'EXACT_INPUT', depositType:'ORIGIN_CHAIN', recipientType:'DESTINATION_CHAIN', refundType:'ORIGIN_CHAIN',
      originAsset:q.route.originAssetId, destinationAsset:q.route.destinationAssetId, amount:q.amount,
      recipient:q.recipient, refundTo:q.refundTo, slippageTolerance:q.slippageBps,
      deadline:new Date(Date.now()+(dry?180_000:900_000)).toISOString() };
  }
  private parse(response: OneClickQuoteResponse, request: OneClickQuoteRequest, base: Omit<PublicCrossQuote,'amountOut'|'minAmountOut'|'refundFee'|'withdrawFee'|'timeEstimate'|'expiresAt'>): PublicCrossQuote {
    const q=response.quote;const echo=response.quoteRequest;
    if (echo) for (const key of ['dry','swapType','depositType','recipientType','refundType','originAsset','destinationAsset','amount','recipient','refundTo','slippageTolerance'] as const) {
      if (echo[key] !== request[key]) throw new Error('The routing service returned a different swap. No funds were sent.');
    }
    if (!q || !integer(q.amountIn) || q.amountIn!==request.amount || !integer(q.amountOut) || !integer(q.minAmountOut)
      || BigInt(q.amountOut)<=0n || BigInt(q.minAmountOut)<=0n || BigInt(q.minAmountOut)>BigInt(q.amountOut)) throw new Error('The routing service returned an invalid quote.');
    const floor=BigInt(q.amountOut)*BigInt(10000-request.slippageTolerance)/10000n;
    if (BigInt(q.minAmountOut)<floor) throw new Error('The route does not meet your slippage protection.');
    const expiry=Math.min(Date.parse(request.deadline),q.deadline?Date.parse(q.deadline):Infinity,q.timeWhenInactive?Date.parse(q.timeWhenInactive):Infinity);
    if (!Number.isFinite(expiry)||expiry<=Date.now()) throw new Error('The route expired. Get a fresh quote.');
    return {...base,amountOut:q.amountOut,minAmountOut:q.minAmountOut,refundFee:integer(q.refundFee)?q.refundFee:null,
      withdrawFee:integer(q.withdrawFee)?q.withdrawFee:null,timeEstimate:Number.isFinite(q.timeEstimate)?q.timeEstimate!:0,expiresAt:Math.min(expiry,Date.now()+180_000)};
  }
  async quote(input: PublicCrossInput): Promise<PublicCrossQuote> {
    this.available();
    if (input.amount<=0n||input.amount>=(1n<<256n)||!Number.isInteger(input.slippageBps)||input.slippageBps<0||input.slippageBps>500) throw new Error('Enter a positive amount and slippage between 0% and 5%.');
    const route=(await (this.d.routes??loadNearIntentRoutes)()).find(r=>r.id===input.routeId);
    this.active();if (!route) throw new Error('This route is no longer available. Refresh the asset list.');
    const error=validateChainAddress(input.recipient,route.destinationAddressKind);if(error)throw new Error(error);
    const base={id:crypto.randomUUID(),route:copy(route),amount:input.amount.toString(),recipient:input.recipient,refundTo:this.d.address,slippageBps:input.slippageBps};
    const request=this.request(base,true);const response=await this.client.requestQuote(request);this.active();
    const q=this.parse(response,request,base);this.issued.clear();this.issued.set(q.id,copy(q));return copy(q);
  }
  private known(id:string, prepared=false) {
    const q=this.issued.get(id);
    if(!q||q.expiresAt<=Date.now()||!!q.depositAddress!==prepared)throw new Error('Quote expired or changed. Request and review a fresh quote.');
    return q;
  }
  calls(q: PublicCrossQuote): Call[] {
    if(!isValidStarknetAddress(q.depositAddress??''))throw new Error('Invalid deposit address.');
    const value=uint256.bnToUint256(BigInt(q.amount));
    return [{contractAddress:NEAR_INTENT_SOURCE_TOKEN.address,entrypoint:'transfer',calldata:[q.depositAddress!,String(value.low),String(value.high)]}];
  }
  async prepare(id:string):Promise<PublicCrossQuote> {
    this.available();const original=this.known(id);const request=this.request(original,false);
    const response=await this.client.requestQuote(request);this.active();this.known(id);
    const q=this.parse(response,request,{...original,id:crypto.randomUUID()});
    if(BigInt(q.minAmountOut)<BigInt(original.minAmountOut))throw new Error('The price moved below your reviewed minimum. Get another quote.');
    const address=response.quote?.depositAddress;
    if(!isValidStarknetAddress(address??'')||BigInt(address!)===BigInt(this.d.address)||BigInt(address!)===BigInt(NEAR_INTENT_SOURCE_TOKEN.address))throw new Error('Invalid route deposit address. No funds were sent.');
    q.depositAddress=address;
    const fee=await this.d.estimate(this.calls(q));this.active();
    if(fee<=0n)throw new Error('Network fee is unavailable.');
    q.networkFee=(fee*3n/2n).toString();
    const balance=await this.d.balance();this.active();
    if(balance<BigInt(q.amount)+BigInt(q.networkFee))throw new Error('Insufficient public STRK for this amount and the network fee.');
    q.expiresAt=Math.min(q.expiresAt,Date.now()+60_000);this.issued.delete(id);this.issued.set(q.id,copy(q));return copy(q);
  }
  async execute(id:string):Promise<PublicCrossReceipt> {
    const work=async()=>{
      if(executing.has(this.key))throw new Error('A cross-chain submission is already in progress.');
      executing.add(this.key);
      try {
        this.available();const q=this.known(id,true);const calls=this.calls(q);
        const fee=await this.d.estimate(calls);this.active();this.known(id,true);
        if(fee>BigInt(q.networkFee!))throw new Error('The network fee increased. Get a new quote and review it again.');
        const balance=await this.d.balance();this.active();this.known(id,true);this.available();
        if(balance<BigInt(q.amount)+BigInt(q.networkFee!))throw new Error('Insufficient public STRK for amount and fees.');
        let receipt:PublicCrossReceipt={version:1,walletId:this.d.walletId,network:'mainnet',quote:copy(q),phase:'submitting',transactionHash:null,
          destinationTxHashes:[],amountOut:null,refundedAmount:null,message:'Submitting the Starknet deposit. Do not send another deposit.',updatedAt:Date.now()};
        // Persist BEFORE the first signing/submission attempt. A timeout or reload never permits resending.
        this.persist(receipt);this.issued.delete(id);
        try {
          const result=await this.d.send(calls);
          if(!isValidStarknetAddress(result.transactionHash))throw new Error('Submission returned no valid transaction hash.');
          receipt={...receipt,phase:'pending',transactionHash:result.transactionHash,message:'Starknet deposit submitted. Destination settlement is pending.',updatedAt:Date.now()};
          this.persist(receipt);
        } catch(error) {
          receipt={...receipt,phase:'unknown',message:'Submission is unconfirmed. Check the saved deposit status; do not send again.',updatedAt:Date.now()};this.persist(receipt);throw error;
        }
        // Notification is optional. Its timeout must never turn into another transfer.
        void this.client.submitDepositTx(q.depositAddress!,receipt.transactionHash!).catch(()=>{});
        return copy(receipt);
      } finally { executing.delete(this.key); }
    };
    if(typeof navigator!=='undefined'&&navigator.locks)return navigator.locks.request(this.key,{ifAvailable:true},lock=>{if(!lock)throw new Error('Another tab is submitting this swap.');return work();});
    return work();
  }
  async refresh():Promise<PublicCrossReceipt|null> {
    this.active();const saved=this.readReceipt();if(!saved)return null;
    if (terminal(saved)) return copy(saved);
    const status=await this.client.getStatus(saved.quote.depositAddress!);this.active();
    const detail=status.swapDetails;
    const txs=(detail?.destinationChainTxHashes??[]).map(t=>typeof t==='string'?t:t.hash).filter(t=>typeof t==='string'&&t.length>0);
    const amount=integer(detail?.amountOut)?detail.amountOut:null;
    let phase:PublicCrossReceipt['phase']='pending';let message='Waiting for destination settlement. Do not send another deposit.';
    if(status.status==='SUCCESS'){
      if(!amount||BigInt(amount)<BigInt(saved.quote.minAmountOut)||txs.length===0){phase='unknown';message='The provider reports success but delivery evidence is incomplete. Check status again.';}
      else {phase='success';message='Destination delivery reported with a transaction receipt.';}
    }else if(status.status==='REFUNDED'){
      if(integer(detail?.refundedAmount)&&BigInt(detail.refundedAmount)>0n){phase='refunded';message='Refund reported to your public Starknet wallet, less provider fees.';}
      else {phase='recovery-required';message='Refund reported without an amount. Reconcile with the provider.';}
    }else if(status.status==='FAILED'||status.status==='INCOMPLETE_DEPOSIT'){phase='recovery-required';message='The provider could not complete this swap. Check the deposit and refund with the provider before sending again.';}
    else if(!['PENDING_DEPOSIT','KNOWN_DEPOSIT_TX','PROCESSING'].includes(status.status??'')){phase='unknown';message='Settlement status is unrecognized. Do not send again.';}
    const receipt={...saved,phase,message,amountOut:amount,destinationTxHashes:txs,refundedAmount:integer(detail?.refundedAmount)?detail.refundedAmount:null,updatedAt:Date.now()};
    // Do not overwrite a newer receipt if another tab completed a subsequent swap.
    if(this.readReceipt()?.quote.id!==saved.quote.id)throw new Error('Swap changed in another tab. Refresh the receipt.');
    this.persist(receipt);return copy(receipt);
  }
}
