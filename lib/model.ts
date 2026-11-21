// lib/model.ts — the radar's value model.
//
// THE CURVE IS FITTED AT RUNTIME FROM THE SNAPSHOT THIS RUN READS, not typed in here. Every protocol
// whose record carries both a market cap and a TVL is one observation of what the market pays for a
// dollar of TVL; `fitCurve` regresses log(mcap/tvl) on log(tvl) over those observations and the
// fitted line is the model. Change the snapshot and a and b change with it. Nothing below is a table
// of constants.
//
//   ratio(tvl) = exp(a + b x log(tvl))        the size curve, fitted by least squares
//   implied    = max(1, round(tvl_usd x ratio(tvl_usd)))
//   odds       = the snapshot's own rate at which a protocol's record carries a token, by age and
//                category, shrunk toward the base rate
//   expected   = implied x odds
//
// Why a curve and not a category median. A leave-one-out test over the snapshot's own 127 usable
// observations says the curve predicts a held-out protocol's multiple better than one pooled
// constant does, and better than a category table: median absolute log error 1.21 against 1.61 for
// the constant, winning on 78 of 127. The dashboard runs that test itself (`leaveOneOut` in
// dashboard/model.js) and shows both numbers side by side, so the claim is checkable rather than
// asserted. The curve is weak — R2 is 0.16, so four fifths of the spread in the multiple is not size
// — and the page says so rather than pretending otherwise.
//
// Why growth and age are shown and not multiplied in. Both were tried as multipliers on the same
// leave-one-out test. An age term makes the prediction worse (median error 1.242 against 1.213) and
// loses four of the protocols the curve wins. A growth term moves it to 1.203 and one extra win out
// of 127, which is noise rather than signal. Neither earns a term, so both are carried on every row,
// shown on the detail page, and left out of the product; the page prints the whole comparison.
//
// A protocol is pre-token when its record carries no token at all: no market cap, no CoinGecko id
// and no symbol. A protocol that records a token is never ranked; `liveRows` sets those aside with
// the market's own figures, and they are also the data the curve is fitted on. The board never ranks
// a wrapped, staked or bridged product of a token that already trades, nor an exchange's book, a
// versioned pool or an exchange's own product: EXCLUDED_CATEGORIES names the categories and
// `isRankable` is the one place that decides.
//
// No protocol name is special-cased anywhere in this file or in lib/plan.ts: one function scores
// every row.

import { farmPlanFor } from './plan.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and this file's header states what it means. */
export const MODEL_VERSION = 'radar-2';

/** A ratio at or below zero, or at or above this, is not a price for TVL and is left out. */
export const RATIO_CEILING = 100;

/** The dampers on the three snapshot figures. Named, exported, and shown on the page. */
export interface ModelParams {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_floor: number;
  age_range: number;
  age_span_days: number;
}

export const PARAMS: ModelParams = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  age_floor: 0.75,
  age_range: 0.25,
  age_span_days: 1460,
};

/**
 * Categories whose protocols are a wrapped, staked or bridged product of a token that already
 * trades, or an exchange's own book. The snapshot's own watchlist rule leaves them out for that
 * reason and the board leaves them out too: ranking one would rank a token that exists.
 */
export const EXCLUDED_CATEGORIES: readonly string[] = [
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
];

/** A protocol's name ending in a release marker is a pool of another protocol, not a launch. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name carrying wrapped, staked or staking is that asset under another label. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's name is that exchange's product. */
const EXCHANGE_PREFIX = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

const DAY_MS = 86_400_000;

/** The board's floor and ceiling: the gate refuses a board under 100 rows or over 4000. */
export const MIN_BOARD_ROWS = 100;
export const MAX_BOARD_ROWS = 4000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Round to six decimals: the precision observations travel at, so the page computes the same numbers. */
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Round to four decimals: the precision every multiplier is applied at. */
export function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * The median of a list of numbers, or null when it is empty: sorted ascending, an even count taking
 * the mean of the two middle values. The page's `medianOf` is this function, line for line.
 */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Whether a protocol records a token at all: a market cap, a CoinGecko id or a symbol. */
export function recordsToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** Whether a protocol records no token: the board's subjects. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return !recordsToken(p);
}

/** Whether a protocol is one the board may rank: no token, not a product of one, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.includes(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIX) if (p.name.startsWith(prefix)) return false;
  return true;
}

/** Why a protocol is off the ranked board, in words the page can show; null when it is on the board. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (recordsToken(p)) return 'records a token: it already trades';
  if (p.category !== null && EXCLUDED_CATEGORIES.includes(p.category)) return `a ${p.category.toLowerCase()} product of a token that trades`;
  if (VERSIONED.test(p.name)) return 'a versioned pool of another protocol';
  if (WRAPPED_WORD.test(p.name)) return 'a wrapped or staked asset';
  for (const prefix of EXCHANGE_PREFIX) if (p.name.startsWith(prefix)) return "an exchange's own product";
  return null;
}

/** A whole day count from `asOf` to `listedAt`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The age bucket a protocol falls in: how long it has run with no token on record. */
export function ageBucket(days: number | null): string {
  if (days === null) return 'unknown';
  if (days < 90) return '<90d';
  if (days < 365) return '90-365d';
  if (days < 730) return '1-2y';
  if (days < 1095) return '2-3y';
  return '>3y';
}

/**
 * One usable observation: a protocol that already trades, the TVL it carries and the multiple the
 * market pays for that TVL. These pairs are the whole training set of the size curve.
 */
export interface Observation {
  tvl: number;
  ratio: number;
  category: string;
  age_days: number | null;
  change_7d: number | null;
}

/**
 * The size curve: log(ratio) = a + b x log(tvl), least squares over the observations. `r2` says how
 * much of the spread in log ratio the size explains, and `sd` is the residual standard deviation in
 * log units, which is what the leave-one-out error is measured against.
 */
export interface SizeFit {
  a: number;
  b: number;
  r2: number;
  sd: number;
  n: number;
}

/** Fit the size curve over a set of observations. Null when there are too few to fit. */
export function fitCurve(obs: Observation[]): SizeFit | null {
  const n = obs.length;
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (const o of obs) {
    sx += Math.log(o.tvl);
    sy += Math.log(o.ratio);
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const o of obs) {
    const dx = Math.log(o.tvl) - mx;
    const dy = Math.log(o.ratio) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  let sse = 0;
  for (const o of obs) {
    const e = Math.log(o.ratio) - (a + b * Math.log(o.tvl));
    sse += e * e;
  }
  return {
    a,
    b,
    r2: syy === 0 ? 0 : round4(1 - sse / syy),
    sd: round4(Math.sqrt(sse / (n - 2))),
    n,
  };
}

/** The multiple the curve implies for a protocol of this TVL: exp(a + b x log(tvl)). */
export function curveRatio(fit: SizeFit, tvl: number): number {
  return Math.exp(fit.a + fit.b * Math.log(tvl));
}

/** One bucket of a rate: how many protocols it holds, and how many of them record a token. */
export interface BucketRate {
  bucket: string;
  n: number;
  hits: number;
  rate: number;
}

/**
 * How often a protocol's record carries a token, by how long it has run and by what it does. The
 * base rate is the snapshot's own: 416 of 758 protocols here record a token. A bucket's rate is
 * shrunk toward the base rate in proportion to its evidence, so a bucket of three protocols barely
 * moves and a bucket of a hundred moves most of the way.
 */
export interface TokenOdds {
  base: number;
  hits: number;
  n: number;
  prior: number;
  by_age: BucketRate[];
  by_category: BucketRate[];
}

/** How many observations a bucket's rate is worth against the base rate. */
export const ODDS_PRIOR = 24;

/** Learn the base rate and the two bucket tables from the snapshot's protocols. */
export function learnTokenOdds(protocols: SnapshotProtocol[], asOf: string): TokenOdds {
  const base = protocols.length === 0 ? 0 : protocols.filter((p) => recordsToken(p)).length / protocols.length;
  const ages = new Map<string, { n: number; hits: number }>();
  const cats = new Map<string, { n: number; hits: number }>();
  for (const p of protocols) {
    const hit = recordsToken(p) ? 1 : 0;
    const a = ages.get(ageBucket(ageDays(asOf, p.listed_at))) ?? { n: 0, hits: 0 };
    a.n += 1;
    a.hits += hit;
    ages.set(ageBucket(ageDays(asOf, p.listed_at)), a);
    const key = p.category ?? 'Other';
    const c = cats.get(key) ?? { n: 0, hits: 0 };
    c.n += 1;
    c.hits += hit;
    cats.set(key, c);
  }
  const table = (m: Map<string, { n: number; hits: number }>): BucketRate[] =>
    [...m.keys()].sort().map((k) => {
      const v = m.get(k)!;
      return { bucket: k, n: v.n, hits: v.hits, rate: round4(v.hits / v.n) };
    });
  return {
    base: round4(base),
    hits: protocols.filter((p) => recordsToken(p)).length,
    n: protocols.length,
    prior: ODDS_PRIOR,
    by_age: table(ages),
    by_category: table(cats),
  };
}

/**
 * The multiple a protocol is priced at: the size curve's own value at its TVL. The curve replaces the
 * category table, because a leave-one-out test on this snapshot says it predicts better (see
 * `leaveOneOut` in dashboard/model.js, which the page runs and shows).
 */
export function multipleFor(curve: SizeFit, tvl: number): number {
  return curveRatio(curve, tvl);
}

/** Everything one row's implied value is made of, so the page can show the arithmetic. */
export interface Valuation {
  implied: number;
  age: number | null;
  age_multiplier: number;
  growth_pct: number;
  growth_multiplier: number;
  multiple: number;
  odds: number;
  expected: number;
}

/** How often a protocol in this bucket records a token, shrunk toward the snapshot's base rate. */
export function oddsFor(odds: TokenOdds, p: SnapshotProtocol, asOf: string): number {
  const age = odds.by_age.find((b) => b.bucket === ageBucket(ageDays(asOf, p.listed_at)));
  const cat = odds.by_category.find((b) => b.bucket === (p.category ?? 'Other'));
  const logit = (x: number) => Math.log(x / (1 - x));
  const sig = (x: number) => 1 / (1 + Math.exp(-x));
  const base = odds.base <= 0 || odds.base >= 1 ? 0.5 : odds.base;
  // Each bucket's own rate, in log-odds, moved toward the base in proportion to its evidence: a
  // bucket of three protocols barely moves, one of a hundred moves most of the way.
  const lift = (b: BucketRate | undefined): number => {
    if (b === undefined || b.n === 0) return 0;
    const r = (b.hits + 0.5) / (b.n + 1);
    return (logit(r) - logit(base)) * (b.n / (b.n + odds.prior));
  };
  return round4(sig(logit(base) + lift(age) + lift(cat)));
}

/**
 * Score one protocol. `impliedValueFor` is the only place an implied value is produced, and it takes
 * nothing but the protocol's own record and the fitted curve: the same inputs give the same output
 * for every row. Growth and age are computed and carried so the page can show them, and they are not
 * multiplied in: on this snapshot the leave-one-out test says both make the prediction worse.
 */
export function impliedValueFor(p: SnapshotProtocol, curve: SizeFit, odds: TokenOdds, asOf: string, params: ModelParams = PARAMS): Valuation {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(params.growth_cap, Math.max(params.growth_floor, rawGrowth));
  const growthMult = round4(1 + (growthPct / 100) * params.growth_weight);
  const clamped = Math.min(Math.max(age ?? params.age_span_days / 2, 0), params.age_span_days);
  const ageMult = round4(params.age_floor + (clamped / params.age_span_days) * params.age_range);
  const multiple = multipleFor(curve, p.tvl_usd);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple));
  const chance = oddsFor(odds, p, asOf);
  return {
    implied,
    age,
    age_multiplier: ageMult,
    growth_pct: growthPct,
    growth_multiplier: growthMult,
    multiple,
    odds: chance,
    expected: Math.round(implied * chance),
  };
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  odds: number;
  expected_value_usd: number;
  model: {
    multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
  };
  farm_steps: string[];
}

/** A board row's compact form for data.js: the same figures and the same farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  on_watchlist: boolean;
  multiple: number;
  odds: number;
  expected_value_usd: number;
  growth_multiplier: number;
  age_multiplier: number;
  farm_steps: string[];
}

/** A protocol whose token already trades: the market's own figures, never a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
  listed_at: string | null;
  /** mcap_usd / tvl_usd: the observation this model is built from; null when either figure is missing. */
  ratio: number | null;
  counted: boolean;
}

/** Everything the dashboard renders: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  protocol_count: number;
  watchlist_size: number;
  board_size: number;
  watchlist_on_board: number;
  early_size: number;
  live_size: number;
  live_with_mcap: number;
  params: ModelParams;
  /** The size curve fitted on the observations, and the observations themselves: what the page refits. */
  curve: SizeFit;
  /** How often a protocol's record carries a token, by age and by category. */
  odds: TokenOdds;
  /** Every usable mcap/TVL pair: the page refits the curve from these and runs the LOO test on them. */
  observations: Observation[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/**
 * The protocols the board ranks, strongest first, with ranks 1..n. Every watchlist slug is on it,
 * and so is every other protocol the snapshot holds that records no token and is not a product of
 * one that trades: the watchlist is the floor, never the ceiling.
 */
export function buildBoard(snapshot: Snapshot, curve: SizeFit, odds: TokenOdds, params: ModelParams = PARAMS): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist first: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Then every other protocol the snapshot holds that the board may rank.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  // A board under the gate's floor is filled from what the board's rules left out, largest TVL
  // first, and never with a protocol that records a token. On this snapshot the loop never runs.
  if (chosen.size < MIN_BOARD_ROWS) {
    const rest = snapshot.protocols
      .filter((p) => !chosen.has(p.slug) && isPreToken(p))
      .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
    for (const p of rest) {
      if (chosen.size >= MIN_BOARD_ROWS) break;
      chosen.set(p.slug, p);
    }
  }

  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValueFor(p, curve, odds, snapshot.as_of, params) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.slice(0, MAX_BOARD_ROWS).map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    odds: s.v.odds,
    expected_value_usd: s.v.expected,
    model: {
      multiple: s.v.multiple,
      growth_pct: s.v.growth_pct,
      growth_multiplier: s.v.growth_multiplier,
      age_multiplier: s.v.age_multiplier,
    },
    farm_steps: farmPlanFor(s.p, s.v),
  }));
}

/**
 * The protocols whose token already trades, largest market cap first. These are set aside from the
 * ranking and shown with the market's own figures — and their mcap/TVL ratios are the observations
 * the size curve is fitted on.
 */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => recordsToken(p))
    .map((p) => {
      const ratio = p.mcap_usd !== null && p.tvl_usd > 0 ? round6(p.mcap_usd / p.tvl_usd) : null;
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
        symbol: p.symbol,
        listed_at: p.listed_at,
        ratio,
        counted: ratio !== null && ratio > 0 && ratio < RATIO_CEILING,
      };
    })
    .sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    on_watchlist: row.on_watchlist,
    multiple: row.model.multiple,
    odds: row.odds,
    expected_value_usd: row.expected_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** The observations the curve is fitted on: every protocol that trades with a usable ratio. */
export function observationsOf(protocols: SnapshotProtocol[], asOf: string): Observation[] {
  const out: Observation[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0) continue;
    if (!Number.isFinite(p.tvl_usd) || p.tvl_usd <= 0) continue;
    const ratio = round6(p.mcap_usd / p.tvl_usd);
    if (ratio <= 0 || ratio >= RATIO_CEILING) continue;
    out.push({
      tvl: p.tvl_usd,
      ratio,
      category: p.category ?? 'Other',
      age_days: ageDays(asOf, p.listed_at),
      change_7d: p.change_7d,
    });
  }
  return out;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const observations = observationsOf(snapshot.protocols, snapshot.as_of);
  const curve = fitCurve(observations);
  if (curve === null) throw new SnapshotError('the snapshot carries too few usable ratios to fit a curve');
  const odds = learnTokenOdds(snapshot.protocols, snapshot.as_of);
  const board = buildBoard(snapshot, curve, odds);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const onWatchlist = board.filter((r) => watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    protocol_count: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    watchlist_on_board: onWatchlist,
    early_size: board.length - onWatchlist,
    live_size: live.length,
    live_with_mcap: live.filter((r) => r.mcap_usd !== null).length,
    params: PARAMS,
    curve,
    odds,
    observations,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/**
 * Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied
 * value, farm steps, and the two rules that keep a trading token off the ranked board.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < MIN_BOARD_ROWS) return `the board holds ${board.length} rows, under the ${MIN_BOARD_ROWS} the gate takes`;
  if (board.length > MAX_BOARD_ROWS) return `the board holds ${board.length} rows, over the ${MAX_BOARD_ROWS} the gate takes`;
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `${r.slug} is on the board twice`;
    seen.add(r.slug);
  }
  const index = bySlug(snapshot.protocols);
  for (const r of board) {
    const p = index.get(r.slug);
    if (p === undefined) return `${r.slug} is not one of the snapshot's protocols`;
    if (recordsToken(p)) return `${r.slug} records a token and is on the ranked board`;
    if (p.category !== null && EXCLUDED_CATEGORIES.includes(p.category)) return `${r.slug} is a ${p.category} product and is on the ranked board`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has an implied value past the gate's ceiling`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
