// lib/plan.ts — the farm plan for one protocol.
//
// A plan is five to eight steps. Each step is an action, what it costs and how long it takes, and
// every one of them is derived from the protocol's own record: its category picks the play, its
// chains pick the gas and the bridge, its TVL picks the position size and the depth warning, and its
// age picks the qualifying window. Nothing here names a protocol, and nothing here invents a figure
// the snapshot does not carry: there is no APY in this file, because the snapshot has none. Where a
// number is a guess it is written as a range and called an estimate.
//
// The play by category, in the words of the market rather than a slogan:
//   Risk Curators            a curator runs other people's lending vaults; the farmable side is
//                            depositing into the vaults it runs and, where it takes applications,
//                            becoming a curator or a delegate under it.
//   Onchain Capital Allocator  a vault factory: pick a vault, read its fee and its redemption queue,
//                            deposit, and stay through a redemption cycle.
//   Lending / CDP            supply the asset the protocol lends against, or borrow against it and
//                            redeposit, watching the health factor every week.
//   Dexs / Yield / Farm      provide liquidity in the pool the TVL actually sits in, in range, and
//                            rebalance rather than leave a position out of range.
//   RWA                      mint or buy the protocol's yield asset and hold it through a distribution.
//   Basis Trading            a delta-neutral basis: long spot, short the perp, collect the funding.
//   Derivatives              trade the venue's own book with margin small enough to survive a wick.
//   Chain                    bridge a real amount onto the chain and use one app on it.
//   everything else          a deposit into the protocol's own product, sized to its TVL.

import type { SnapshotProtocol, Valuation } from './model.ts';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** What a chain charges for one ordinary transaction, as a range in dollars. */
interface GasTier {
  label: string;
  /** One transaction: deposit, approve, swap. */
  tx: string;
  /** One week of ordinary activity on the protocol. */
  week: string;
  /** Bridging onto the chain, when the reader is not already there. */
  bridge: string;
}

/**
 * Gas by chain. These are order-of-magnitude ranges for an ordinary transaction, not quotes: a
 * crowded block on Ethereum costs more, an empty one on an L2 costs less. The tier a chain falls in
 * is public knowledge about that chain, not a figure from the snapshot.
 */
const GAS: Record<string, GasTier> = {
  Ethereum: { label: 'Ethereum mainnet', tx: '$2 to $12', week: '$8 to $40', bridge: '$5 to $20' },
  Bitcoin: { label: 'Bitcoin', tx: '$1 to $6', week: '$3 to $15', bridge: '$2 to $10' },
  Solana: { label: 'Solana', tx: 'under $0.02', week: 'under $0.10', bridge: '$1 to $3' },
  Binance: { label: 'BNB Chain', tx: '$0.05 to $0.30', week: '$0.20 to $1', bridge: '$1 to $4' },
  Tron: { label: 'Tron', tx: '$0.30 to $2', week: '$1 to $6', bridge: '$2 to $8' },
  Avalanche: { label: 'Avalanche C-Chain', tx: '$0.05 to $0.50', week: '$0.20 to $2', bridge: '$1 to $5' },
  Polygon: { label: 'Polygon PoS', tx: '$0.01 to $0.10', week: 'under $0.40', bridge: '$1 to $4' },
  Arbitrum: { label: 'Arbitrum One', tx: '$0.05 to $0.40', week: '$0.20 to $1.50', bridge: '$1 to $5' },
  Optimism: { label: 'OP Mainnet', tx: '$0.05 to $0.40', week: '$0.20 to $1.50', bridge: '$1 to $5' },
  Base: { label: 'Base', tx: '$0.02 to $0.20', week: 'under $0.80', bridge: '$0.50 to $3' },
  Unichain: { label: 'Unichain', tx: '$0.02 to $0.15', week: 'under $0.60', bridge: '$0.50 to $3' },
  Ink: { label: 'Ink', tx: '$0.02 to $0.15', week: 'under $0.60', bridge: '$0.50 to $3' },
  Linea: { label: 'Linea', tx: '$0.05 to $0.30', week: 'under $1', bridge: '$1 to $4' },
  Scroll: { label: 'Scroll', tx: '$0.05 to $0.30', week: 'under $1', bridge: '$1 to $4' },
  Mantle: { label: 'Mantle', tx: '$0.02 to $0.20', week: 'under $0.80', bridge: '$1 to $4' },
  Sonic: { label: 'Sonic', tx: '$0.02 to $0.20', week: 'under $0.80', bridge: '$1 to $4' },
  Berachain: { label: 'Berachain', tx: '$0.05 to $0.40', week: '$0.20 to $1.50', bridge: '$1 to $5' },
  Monad: { label: 'Monad', tx: '$0.01 to $0.10', week: 'under $0.40', bridge: '$0.50 to $3' },
  Plasma: { label: 'Plasma', tx: '$0.01 to $0.10', week: 'under $0.40', bridge: '$1 to $3' },
  Katana: { label: 'Katana', tx: '$0.02 to $0.15', week: 'under $0.60', bridge: '$1 to $4' },
  Hyperliquid: { label: 'Hyperliquid L1', tx: 'under $0.05', week: 'under $0.20', bridge: '$1 to $3' },
  'Hyperliquid L1': { label: 'Hyperliquid L1', tx: 'under $0.05', week: 'under $0.20', bridge: '$1 to $3' },
  Sui: { label: 'Sui', tx: 'under $0.05', week: 'under $0.20', bridge: '$1 to $3' },
  Aptos: { label: 'Aptos', tx: 'under $0.05', week: 'under $0.20', bridge: '$1 to $3' },
  Stellar: { label: 'Stellar', tx: 'under $0.01', week: 'under $0.05', bridge: '$1 to $3' },
  Algorand: { label: 'Algorand', tx: 'under $0.01', week: 'under $0.05', bridge: '$1 to $3' },
  Flare: { label: 'Flare', tx: 'under $0.05', week: 'under $0.20', bridge: '$1 to $3' },
  'Plume Mainnet': { label: 'Plume', tx: '$0.02 to $0.20', week: 'under $0.80', bridge: '$1 to $4' },
  'Robinhood Chain': { label: 'Robinhood Chain', tx: 'under $0.10', week: 'under $0.40', bridge: '$1 to $3' },
};

const DEFAULT_GAS: GasTier = { label: 'its chain', tx: '$0.10 to $1', week: '$0.50 to $4', bridge: '$1 to $6' };

/** The gas tier for the chain a protocol is farmed on. */
export function gasFor(chain: string): GasTier {
  return GAS[chain] ?? DEFAULT_GAS;
}

/** The midpoint of a gas string like "$2 to $12" or "under $0.05", in dollars. */
function midpoint(text: string): number {
  const nums = text.match(/\d+(?:\.\d+)?/g);
  if (nums === null || nums.length === 0) return 0;
  const values = nums.map(Number);
  return values.length === 1 ? values[0]! : (values[0]! + values[values.length - 1]!) / 2;
}

/**
 * What one farm position costs in gas, all in: the deposit and its approval, a month of weekly
 * checks, and the withdrawal. Derived from the same tier table the step text quotes, so the figure
 * and the prose cannot drift apart. An estimate, and the step that uses it says so.
 */
export function gasUsdFor(chain: string): number {
  const tier = gasFor(chain);
  return Math.round(3 * midpoint(tier.tx) + midpoint(tier.week));
}

/** How much one position needs: a slice of the protocol's own TVL, in round dollars. */
export function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 5_000_000_000) return 300;
  if (tvlUsd >= 1_000_000_000) return 200;
  if (tvlUsd >= 250_000_000) return 150;
  if (tvlUsd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from how long the protocol has run with no token. */
export function holdDaysFor(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 180) return 90;
  if (ageDays < 365) return 60;
  if (ageDays < 730) return 45;
  return 30;
}

/** A whole-dollar figure for prose: $1.24B, $340M, $75M. Two decimals under $10B so it never rounds a TVL up by more than it should. */
function usdShort(n: number): string {
  if (n >= 1e10) return `$${(n / 1e9).toFixed(0)}B`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** A list in prose: "A", "A and B", "A, B and C". */
function andList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The chain the plan is written for: the one carrying most of the protocol's TVL, as the list orders them. */
function primaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
}

/** The other chains the protocol runs on, named so a reader knows where else the position fits. */
function otherChains(p: SnapshotProtocol): string[] {
  return p.chains.slice(1, 4);
}

/** The category as a lower-case key the plan switches on. */
function keyOf(p: SnapshotProtocol): string {
  return (p.category ?? 'other').toLowerCase();
}

/** A step as one string: its action, then its cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page for the rest.`;
  return s;
}

/** The opening step every plan shares: the wallet, and the chain it has to be funded on. */
function walletStep(p: SnapshotProtocol, gas: GasTier): FarmStep {
  const chain = primaryChain(p);
  return {
    text: `Use a wallet that holds only this farm's money and keep its seed phrase off this machine; fund it on ${gas.label} rather than bridging after you start.`,
    cost: `nothing to open the wallet, and about ${gas.bridge} if you bridge onto ${chain}`,
    time: '10 minutes',
  };
}

/** The closing step every plan shares: the exit, and the log that makes the position repeatable. */
function logStep(capital: number, hold: number): FarmStep {
  return {
    text: `Write the wallet, the dates, every transaction hash and the amount in a farm log, and set a reminder for day ${hold} so you unwind on purpose instead of forgetting the position.`,
    cost: `no fee for the log itself, though the $${capital} stays committed until you close`,
    time: `${hold} days, then 15 minutes to close`,
  };
}

/** The depth warning: a position that is large against the protocol's TVL moves the price against itself. */
function depthStep(p: SnapshotProtocol, capital: number): FarmStep {
  return {
    text: `Keep the position under about 1% of the protocol's ${usdShort(p.tvl_usd)} of TVL: above that your own entry and exit move the pool, and the slippage costs more than the position is likely to earn.`,
    cost: `no fee to size it, and slippage of a few tenths of a percent at this size`,
    time: '5 minutes',
  };
}

/**
 * The last step, and the only one that puts a number on the trade: the position the plan describes,
 * priced at the odds this protocol's record turns into a token, less the gas the plan spends. Every
 * term is derived — the size from the TVL, the odds from the snapshot's own base rates, the gas from
 * the chain's tier — and the whole thing is labelled an estimate, because it is one.
 */
function netStep(p: SnapshotProtocol, ctx: Ctx): FarmStep {
  const odds = ctx.valuation.odds;
  const position = ctx.capital;
  const gas = gasUsdFor(primaryChain(p));
  const gross = Math.round(position * odds);
  const net = gross - gas;
  // The size at which the expected value just clears the gas: the reader can compare it with what
  // they actually have, which is the decision the earlier steps do not make for them.
  const breakEven = ctx.hold === 0 ? 0 : Math.round(gas / Math.max(odds, 0.01));
  const verdict = net >= 0
    ? `that clears the gas by $${net}`
    : `the gas costs $${-net} more than the position's expected value, so at this size the farm does not pay`;
  return {
    text: `Price the whole farm before you start. A $${position} position at this protocol's ${(odds * 100).toFixed(1)}% chance of a token is $${gross} of expected value, and about $${gas} of gas to open, watch for a month and close: ${verdict}. Break-even needs a position of about $${breakEven}. Every figure here is an estimate from this protocol's own bucket rates and its chain's fee tier, not a quote.`,
    cost: `$${gas} of gas across the open, the weekly checks and the close, subtracted above`,
    time: '10 minutes to size it, before any money moves',
  };
}

/**
 * A plan for a risk curator: the farmable side is the vaults the curator runs, and the application
 * where it takes one. A curator's own token, if it ever issues one, prices the book it manages.
 */
function curatorPlan(p: SnapshotProtocol, ctx: Ctx): FarmStep[] {
  const gas = ctx.gas;
  const chain = primaryChain(p);
  const other = otherChains(p);
  return [
    walletStep(p, gas),
    {
      text: `Open the curator's own vault list and pick the vault on ${chain} with the deepest TVL and the shortest redemption delay; note its fee and its underlying lending market before you deposit anything.`,
      cost: 'nothing to read the vault page',
      time: '20 minutes',
    },
    {
      text: `Deposit $${ctx.capital} of USDC into that vault and keep the vault shares in the same wallet: the deposit is the position a curator's own launch would count.`,
      cost: `$${ctx.capital} of capital plus ${gas.tx} of gas for the approval and the deposit`,
      time: '15 minutes',
    },
    other.length > 0
      ? {
          text: `Spread a second, smaller position across the curator's vaults on ${andList(other)} so the activity is not one chain's snapshot; keep the two positions in the same wallet.`,
          cost: `another $${Math.round(ctx.capital / 2)} of capital plus ${gas.bridge} to move it and ${gas.tx} to deposit`,
          time: '30 minutes',
        }
      : {
          text: `Add a second vault from the same curator rather than a second protocol: two vaults under one curator count as one relationship and cost one more deposit.`,
          cost: `another $${Math.round(ctx.capital / 2)} of capital plus ${gas.tx} of gas`,
          time: '15 minutes',
        },
    {
      text: `If the curator publishes a curator or delegate application, apply with the same wallet and the same address history: the application is free, and it is the only route from depositor to the role a launch would reward.`,
      cost: 'nothing but the form, and no deposit is required to apply',
      time: '30 minutes, then however long their review takes',
    },
    {
      text: `Re-check the vault every week: a curator's book can be withdrawn from a lending market under it, and a vault whose TVL falls by a third is a vault to leave before the redemption queue fills.`,
      cost: `${gas.week} of gas for a weekly check and any rebalance`,
      time: '10 minutes a week',
    },
    depthStep(p, ctx.capital),
    logStep(ctx.capital, ctx.hold),
    netStep(p, ctx),
  ];
}

/** A plan for an onchain capital allocator: a vault factory, so the work is picking the vault and the fee. */
function allocatorPlan(p: SnapshotProtocol, ctx: Ctx): FarmStep[] {
  const gas = ctx.gas;
  const chain = primaryChain(p);
  return [
    walletStep(p, gas),
    {
      text: `List the vaults this allocator runs on ${chain} and compare three things on each: the management fee, the performance fee and the redemption delay. A vault with a 30-day queue is a different position from one that pays out same-day.`,
      cost: 'nothing to compare them',
      time: '25 minutes',
    },
    {
      text: `Deposit $${ctx.capital} of USDC into the vault whose fee is lowest and whose underlying strategy you can describe in one sentence; if you cannot describe it, pick another vault.`,
      cost: `$${ctx.capital} of capital plus ${gas.tx} of gas for the approval and the deposit`,
      time: '15 minutes',
    },
    {
      text: `Stay through one full redemption cycle, not just the deposit: the allocator's own record is built from money that stayed, and a deposit withdrawn in a week is a fee paid for nothing.`,
      cost: `the $${ctx.capital} stays deposited, and the vault's management fee comes out of it`,
      time: `${ctx.hold} days`,
    },
    {
      text: `Before you withdraw, read the redemption terms again and start the queue early; a queue that takes longer than you planned is the most common way a farm position turns into a forced hold.`,
      cost: `${gas.tx} of gas to start the redemption, and no penalty for reading first`,
      time: '15 minutes, plus the queue',
    },
    depthStep(p, ctx.capital),
    logStep(ctx.capital, ctx.hold),
    netStep(p, ctx),
  ];
}

/** A plan for a lending market or a CDP: supply the asset, or borrow against it and redeposit. */
function lendingPlan(p: SnapshotProtocol, ctx: Ctx): FarmStep[] {
  const gas = ctx.gas;
  const chain = primaryChain(p);
  const isCdp = keyOf(p).includes('cdp');
  return [
    walletStep(p, gas),
    isCdp
      ? {
          text: `Open a position against the collateral the protocol accepts on ${chain}: deposit $${Math.round(ctx.capital * 1.5)} of it, mint no more than a third of its value in the protocol's stable asset, and keep the rest of the collateral unused.`,
          cost: `$${Math.round(ctx.capital * 1.5)} of collateral plus ${gas.tx} of gas for the deposit and the mint`,
          time: '20 minutes',
        }
      : {
          text: `Supply $${ctx.capital} of USDC to the market on ${chain} and note the utilisation of the pool you entered: above 90% utilisation the withdrawal is a queue, not a click.`,
          cost: `$${ctx.capital} of capital plus ${gas.tx} of gas for the approval and the supply`,
          time: '15 minutes',
        },
    isCdp
      ? {
          text: `Put the minted stable asset to work rather than leaving it idle: supply it back into a lending market on the same chain, and keep the two positions in one wallet so the health factor is one number to watch.`,
          cost: `${gas.tx} of gas to supply the minted asset, and no extra capital`,
          time: '15 minutes',
        }
      : {
          text: `Borrow a small amount against the supply, no more than a third of it, and supply that back: the borrow is the second action a lending market's own record counts, and it costs interest rather than capital.`,
          cost: `interest on the borrow, currently a few percent a year, plus ${gas.tx} of gas`,
          time: '20 minutes',
        },
    {
      text: `Check the health factor every week and keep it above 1.5; a market whose collateral price falls 30% in a week liquidates a position that was safe when it opened.`,
      cost: `${gas.week} of gas for the weekly check and any top-up`,
      time: '10 minutes a week',
    },
    {
      text: `Withdraw in two steps rather than one: repay the borrow first, then the supply, so no hour passes with collateral posted against a debt you have already closed.`,
      cost: `${gas.tx} of gas for the repay and ${gas.tx} for the withdrawal`,
      time: '20 minutes',
    },
    depthStep(p, ctx.capital),
    logStep(ctx.capital, ctx.hold),
    netStep(p, ctx),
  ];
}

/** A plan for a DEX, a yield farm or a yield aggregator: liquidity in the pool the TVL actually sits in. */
function liquidityPlan(p: SnapshotProtocol, ctx: Ctx): FarmStep[] {
  const gas = ctx.gas;
  const chain = primaryChain(p);
  return [
    walletStep(p, gas),
    {
      text: `Find the pool on ${chain} that holds most of this protocol's ${usdShort(p.tvl_usd)} of TVL, and read its fee tier and its current range before you add anything; a pool off its range earns fees on nothing.`,
      cost: 'nothing to read the pool',
      time: '20 minutes',
    },
    {
      text: `Add $${ctx.capital} of liquidity as a pair rather than a single asset, in the range you expect the price to hold for the next month, and approve only the two tokens the pool takes.`,
      cost: `$${ctx.capital} of capital plus ${gas.tx} of gas for two approvals and the deposit`,
      time: '20 minutes',
    },
    {
      text: `Set a reminder to check the range twice a week: a position that drifts out of range stops earning and starts holding the losing side of the pair, which is the cost nobody quotes.`,
      cost: `${gas.week} of gas for the rebalances, and the impermanent loss if the pair moves`,
      time: '10 minutes twice a week',
    },
    {
      text: `Claim the pool's fees and any emissions on the schedule the protocol publishes, not daily: a claim costs gas every time and the reward does not compound faster than the fee you pay to take it.`,
      cost: `${gas.tx} per claim, so claim monthly rather than weekly`,
      time: '15 minutes a month',
    },
    depthStep(p, ctx.capital),
    logStep(ctx.capital, ctx.hold),
    netStep(p, ctx),
  ];
}

/** A plan for an RWA protocol: mint or buy the yield asset and hold it through a distribution. */
function rwaPlan(p: SnapshotProtocol, ctx: Ctx): FarmStep[] {
  const gas = ctx.gas;
  const chain = primaryChain(p);
  return [
    walletStep(p, gas),
    {
      text: `Read the protocol's own terms on ${chain} first: which entity issues the asset, what the redemption window is, and whether the position needs a permissioned wallet. An RWA that cannot be redeemed in your jurisdiction is not a farm position.`,
      cost: 'nothing to read the terms, and no deposit to check eligibility',
      time: '30 minutes',
    },
    {
      text: `Mint or buy $${ctx.capital} of the protocol's yield asset and hold it in a wallet you control rather than in the protocol's own custody page, so the position survives the protocol's front end going down.`,
      cost: `$${ctx.capital} of capital plus ${gas.tx} of gas for the mint or the swap`,
      time: '20 minutes',
    },
    {
      text: `Hold through at least one distribution or interest payment: the record that matters for an RWA is a holder across a payment date, and a position opened and closed between two of them leaves nothing behind.`,
      cost: `the $${ctx.capital} stays invested, and the issuer's fee comes out of the yield`,
      time: `${ctx.hold} days`,
    },
    {
      text: `Start the redemption before you need the money: an RWA's exit runs through the issuer's own process and can take days to weeks, and it is the step that surprises people who treat it like a token swap.`,
      cost: `${gas.tx} of gas to redeem, plus whatever the issuer charges for an early exit`,
      time: '15 minutes to start, then the issuer\'s window',
    },
    depthStep(p, ctx.capital),
    logStep(ctx.capital, ctx.hold),
    netStep(p, ctx),
  ];
}

/** A plan for a basis-trading venue: long spot, short the perpetual, collect the funding. */
function basisPlan(p: SnapshotProtocol, ctx: Ctx): FarmStep[] {
  const gas = ctx.gas;
  const chain = primaryChain(p);
  return [
    walletStep(p, gas),
    {
      text: `Open the two legs together on ${chain}: buy $${ctx.capital} of the spot asset and short the same dollar amount of its perpetual on the venue, so the position is flat on price and earns the funding instead.`,
      cost: `$${ctx.capital} of capital plus ${gas.tx} of gas for the spot leg and the venue's own trading fee`,
      time: '30 minutes',
    },
    {
      text: `Keep margin on the short leg above the venue's maintenance requirement by a wide margin: a basis trade is safe on price and still liquidated when the short leg runs out of margin in a squeeze.`,
      cost: `about a third of the position held as margin, and ${gas.tx} to top it up`,
      time: '15 minutes to set the buffer',
    },
    {
      text: `Check the funding rate every week and close the trade when it turns negative: a basis position pays while funding is positive and costs you while it is not, so the exit is a signal, not a date.`,
      cost: `${gas.week} of gas and the venue's fees on each rebalance`,
      time: '10 minutes a week',
    },
    {
      text: `Unwind both legs in one session, spot first and short second, so the position is never naked on one side for longer than a single block.`,
      cost: `${gas.tx} of gas and the venue's closing fee`,
      time: '20 minutes',
    },
    depthStep(p, ctx.capital),
    logStep(ctx.capital, ctx.hold),
    netStep(p, ctx),
  ];
}

/** A plan for a derivatives venue: trade its own book with margin small enough to survive a wick. */
function derivativesPlan(p: SnapshotProtocol, ctx: Ctx): FarmStep[] {
  const gas = ctx.gas;
  const chain = primaryChain(p);
  return [
    walletStep(p, gas),
    {
      text: `Deposit $${ctx.capital} of USDC as margin on ${chain} and read the venue's fee schedule and liquidation rules before the first trade; a perps venue's record counts volume, and volume is cheap only if the fees are.`,
      cost: `$${ctx.capital} of margin plus ${gas.tx} of gas for the deposit`,
      time: '20 minutes',
    },
    {
      text: `Trade small and often rather than large and once: a position at 2x leverage survives a 40% wick, one at 10x does not, and the record counts the trade either way.`,
      cost: `the venue's taker fee on each trade, and no more than 2x leverage`,
      time: '15 minutes a week',
    },
    {
      text: `Keep a liquidation price you can watch: write the price at which the position dies next to the position, and close it yourself before the venue does.`,
      cost: `${gas.tx} of gas to close, and the funding you pay while it is open`,
      time: '10 minutes a week',
    },
    {
      text: `Withdraw the margin in one go at the end rather than leaving it: a perps venue is a trading venue, not a savings account, and idle margin earns nothing.`,
      cost: `${gas.tx} of gas for the withdrawal`,
      time: '15 minutes',
    },
    depthStep(p, ctx.capital),
    logStep(ctx.capital, ctx.hold),
    netStep(p, ctx),
  ];
}

/** A plan for a chain or a payments network: bridge a real amount on and use one app on it. */
function chainPlan(p: SnapshotProtocol, ctx: Ctx): FarmStep[] {
  const gas = ctx.gas;
  const chain = primaryChain(p);
  return [
    walletStep(p, gas),
    {
      text: `Bridge $${ctx.capital} onto ${chain} through the chain's own canonical bridge, not a third-party one, and keep the bridged asset in the wallet you will use for everything else on the chain.`,
      cost: `$${ctx.capital} of capital plus ${gas.bridge} of bridge fees and ${gas.tx} for the destination transaction`,
      time: '30 minutes',
    },
    {
      text: `Use one application on the chain with that money rather than holding it: a chain's record counts addresses that did something, and a bridged balance that never moves is a bridge user, not a chain user.`,
      cost: `${gas.tx} of gas for the first transaction, and whatever the application charges`,
      time: '20 minutes',
    },
    {
      text: `Come back at least twice in different weeks: one visit is a tourist, and a chain's own snapshot counts returning addresses.`,
      cost: `${gas.week} of gas for the return visits`,
      time: '10 minutes a week for three weeks',
    },
    {
      text: `Bridge out through the same canonical route when you are done, and check the exit before you commit the money: some chains' bridges take hours or a challenge period to release.`,
      cost: `${gas.bridge} of bridge fees and ${gas.tx} for the exit transaction`,
      time: '30 minutes, plus the bridge delay',
    },
    depthStep(p, ctx.capital),
    logStep(ctx.capital, ctx.hold),
    netStep(p, ctx),
  ];
}

/** The plan for a category this file has no special case for: a deposit into the protocol's own product. */
function genericPlan(p: SnapshotProtocol, ctx: Ctx): FarmStep[] {
  const gas = ctx.gas;
  const chain = primaryChain(p);
  const category = p.category ?? 'unlisted category';
  return [
    walletStep(p, gas),
    {
      text: `Read what the protocol actually takes on ${chain}: it is filed as ${category}, and the deposit it wants is not always the one the category suggests.`,
      cost: 'nothing to read its own page',
      time: '20 minutes',
    },
    {
      text: `Deposit $${ctx.capital} into the protocol's main product on ${chain} and keep the receipt token, if it issues one, in the same wallet.`,
      cost: `$${ctx.capital} of capital plus ${gas.tx} of gas for the approval and the deposit`,
      time: '20 minutes',
    },
    {
      text: `Do one more thing with the position each month, a claim, a vote or a rebalance: a protocol's own record counts actions, and a deposit that never moves is one action.`,
      cost: `${gas.week} of gas a month`,
      time: '10 minutes a month',
    },
    depthStep(p, ctx.capital),
    logStep(ctx.capital, ctx.hold),
    netStep(p, ctx),
  ];
}

/** Everything a plan is built from, derived once per row. */
interface Ctx {
  gas: GasTier;
  capital: number;
  hold: number;
  /** The scored row: the plan prices its last step from the same valuation the board ranks on. */
  valuation: Valuation;
}

/**
 * The farm plan for one protocol: the category picks the play, the chain picks the gas, the TVL
 * picks the size and the depth warning, and the age picks the qualifying window. The same function
 * serves every row; the plan travels into board.json and into the page unchanged.
 */
export function farmPlanFor(p: SnapshotProtocol, valuation: Valuation): string[] {
  const ctx: Ctx = {
    gas: gasFor(primaryChain(p)),
    capital: capitalFor(p.tvl_usd),
    hold: holdDaysFor(valuation.age),
    valuation,
  };
  const key = keyOf(p);
  let steps: FarmStep[];
  if (key.includes('curator')) steps = curatorPlan(p, ctx);
  else if (key.includes('allocator')) steps = allocatorPlan(p, ctx);
  else if (key.includes('lend') || key.includes('cdp') || key.includes('collateral')) steps = lendingPlan(p, ctx);
  else if (key.includes('dex') || key.includes('yield') || key.includes('farm') || key.includes('liquidity')) steps = liquidityPlan(p, ctx);
  else if (key.includes('rwa') || key.includes('index') || key.includes('otc')) steps = rwaPlan(p, ctx);
  else if (key.includes('basis')) steps = basisPlan(p, ctx);
  else if (key.includes('derivative') || key.includes('perpetual') || key.includes('option')) steps = derivativesPlan(p, ctx);
  else if (key === 'chain' || key.includes('payment') || key.includes('governance')) steps = chainPlan(p, ctx);
  else steps = genericPlan(p, ctx);
  return steps.map(stepText);
}
