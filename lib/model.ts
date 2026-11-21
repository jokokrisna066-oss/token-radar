// lib/model.ts — the radar's value model.
//
// THE MULTIPLES ARE LEARNED AT RUNTIME FROM THE SNAPSHOT THIS RUN READS, not typed in here. Every
// protocol whose record carries both a market cap and a TVL is an observation of the market's own
// price for a dollar of TVL; `learnCategoryMultiples` groups those observations by the protocol's
// category, drops the unusable ones, and takes the median of each group. A group with at least
// MIN_OBSERVATIONS usable observations sets its category's multiple. A group with fewer does not have
// enough evidence to price a category on its own, so it falls back to the median of every observation
// pooled together. Nothing below is a table of category constants: change the snapshot and the
// multiples change with it. The dashboard ships the same observations in data.js and recomputes the
// table in the page (`learnFromObservations` in dashboard/app.js), so a reader can check the
// arithmetic instead of taking it on trust.
//
//   multiple   = median(mcap_usd / tvl_usd) over the category's usable observations
//                (or the pooled median when the category has fewer than MIN_OBSERVATIONS of them)
//   growth     = clamp(change_7d, growth_floor, growth_cap) per cent; a null change_7d counts as 0
//   growthMult = 1 + (growth / 100) x growth_weight
//   ageMult    = age_floor + min(age_days, age_span_days) / age_span_days x age_range
//                (an unknown age takes the snapshot's own median age, computed in learnCategoryMultiples)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x ageMult))
//
// Why these shapes:
//   * The median, not the mean: a category's ratio distribution has a long right tail (one protocol
//     whose token trades far above its TVL drags a mean up by an order of magnitude). The median is
//     the ratio half that category's tokens actually clear.
//   * Growth is halved and clamped: seven days of TVL change is a noisy signal, and a protocol that
//     lost 40% of its TVL this week is not worth 40% less than one that stood still, so the
//     multiplier moves between 0.7 and 1.6 and no further.
//   * Age is credited, saturating at four years: a protocol that has run longer without a token has
//     more of a record behind it, and a longer window in which a launch would already have shipped
//     had its team wanted one. The credit is modest (0.75 to 1.0), because a long wait proves nothing.
//   * A protocol is pre-token when its record carries no token at all: no market cap, no CoinGecko id
//     and no symbol. A protocol that records a token is never ranked; `liveRows` sets those aside
//     with the market's own figures, and they are also the data this model learns from.
//   * The board never ranks a wrapped, staked or bridged product of a token that already trades, nor
//     an exchange's book, a versioned pool or an exchange's own product: those are products of a
//     token that exists, not protocols waiting on one. EXCLUDED_CATEGORIES names the categories and
//     `isRankable` is the one place that decides.
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

/** How many usable mcap/TVL observations a category needs before it prices itself. */
export const MIN_OBSERVATIONS = 4;
/** How many observations the pooled median is worth when a thin category is shrunk toward it. */
export const PRIOR_OBSERVATIONS = 4;

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

/** One category's learned multiple and the evidence behind it. */
export interface CategoryStat {
  category: string;
  observations: number;
  median: number | null;
  multiple: number;
  learned: boolean;
}

/** The whole learned table: every category's evidence, the pooled fallback, and the median age. */
export interface LearnTable {
  min_observations: number;
  ratio_ceiling: number;
  overall_observations: number;
  overall_median: number;
  overall_multiple: number;
  median_age_days: number;
  categories: CategoryStat[];
  /** category -> its usable ratios: what the page recomputes the whole table from. */
  observations: Record<string, number[]>;
}

/** A whole day count from `asOf` to `listedAt`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The learning set: every protocol whose record carries both a market cap and a TVL, grouped by
 * category, with the ratios that price a dollar of TVL and the outliers dropped. This is the whole
 * training data — 127 usable observations on this snapshot, all of them from protocols that trade.
 */
export function observedRatios(protocols: SnapshotProtocol[]): { byCategory: Map<string, number[]>; pooled: number[] } {
  const byCategory = new Map<string, number[]>();
  const pooled: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0) continue;
    if (!Number.isFinite(p.tvl_usd) || p.tvl_usd <= 0) continue;
    const ratio = round6(p.mcap_usd / p.tvl_usd);
    if (ratio <= 0 || ratio >= RATIO_CEILING) continue;
    const key = p.category ?? 'Other';
    const bucket = byCategory.get(key);
    if (bucket === undefined) byCategory.set(key, [ratio]);
    else bucket.push(ratio);
    pooled.push(ratio);
  }
  return { byCategory, pooled };
}

/**
 * Learn the category multiples from the snapshot: the median ratio of every category with enough
 * evidence, and the pooled median for the rest. Deterministic: categories are emitted sorted by name.
 */
export function learnCategoryMultiples(protocols: SnapshotProtocol[], asOf: string): LearnTable {
  const { byCategory, pooled } = observedRatios(protocols);
  const overallMedian = medianOf(pooled) ?? 0;
  const overallMultiple = round4(overallMedian);
  const categories: CategoryStat[] = [];
  const observations: Record<string, number[]> = {};
  for (const key of [...byCategory.keys()].sort()) {
    const ratios = byCategory.get(key)!;
    const median = medianOf(ratios);
    const learned = ratios.length >= MIN_OBSERVATIONS && median !== null;
    // A category with too few observations is not priced at the pooled median outright: its own
    // median is still evidence, just weak. Shrink it toward the pooled median in proportion to how
    // much of it there is -- n/(n+PRIOR_OBSERVATIONS) of the way, so one observation barely moves
    // and four move more than half way. A category with none has nothing to say and takes the pool.
    const shrunk = median === null
      ? overallMultiple
      : (ratios.length * median + PRIOR_OBSERVATIONS * overallMultiple) / (ratios.length + PRIOR_OBSERVATIONS);
    categories.push({
      category: key,
      observations: ratios.length,
      median: median === null ? null : round4(median),
      multiple: learned ? round4(median!) : round4(shrunk),
      learned,
    });
    observations[key] = ratios;
  }
  const ages = protocols.map((p) => ageDays(asOf, p.listed_at)).filter((d): d is number => d !== null);
  const medianAge = medianOf(ages);
  return {
    min_observations: MIN_OBSERVATIONS,
    ratio_ceiling: RATIO_CEILING,
    overall_observations: pooled.length,
    overall_median: round4(overallMedian),
    overall_multiple: overallMultiple,
    median_age_days: medianAge === null ? 0 : Math.round(medianAge),
    categories,
    observations,
  };
}

/** The multiple a category is priced at, and where that multiple came from. */
export function multipleFor(table: LearnTable, category: string | null): { multiple: number; observations: number; source: 'category' | 'universe'; category: string } {
  const key = category ?? 'Other';
  const stat = table.categories.find((c) => c.category === key);
  if (stat !== undefined && stat.learned) {
    return { multiple: stat.multiple, observations: stat.observations, source: 'category', category: key };
  }
  return { multiple: table.overall_multiple, observations: stat === undefined ? 0 : stat.observations, source: 'universe', category: key };
}

/** Everything one row's implied value is made of, so the page can show the arithmetic. */
export interface Valuation {
  implied: number;
  age: number | null;
  age_multiplier: number;
  growth_pct: number;
  growth_multiplier: number;
  multiple: number;
  multiple_source: 'category' | 'universe';
  category_observations: number;
}

/**
 * Score one protocol. `impliedValueFor` is the only place an implied value is produced, and it takes
 * nothing but the protocol's own record, the learned table and the snapshot's date: the same inputs
 * give the same output for every row.
 */
export function impliedValueFor(p: SnapshotProtocol, table: LearnTable, asOf: string, params: ModelParams = PARAMS): Valuation {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(params.growth_cap, Math.max(params.growth_floor, rawGrowth));
  const growthMult = round4(1 + (growthPct / 100) * params.growth_weight);
  const ageForModel = age ?? table.median_age_days;
  const clamped = Math.min(Math.max(ageForModel, 0), params.age_span_days);
  const ageMult = round4(params.age_floor + (clamped / params.age_span_days) * params.age_range);
  const m = multipleFor(table, p.category);
  const implied = Math.max(1, Math.round(p.tvl_usd * m.multiple * growthMult * ageMult));
  return {
    implied,
    age,
    age_multiplier: ageMult,
    growth_pct: growthPct,
    growth_multiplier: growthMult,
    multiple: m.multiple,
    multiple_source: m.source,
    category_observations: m.observations,
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
  model: {
    category_multiple: number;
    multiple_source: 'category' | 'universe';
    category_observations: number;
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
  multiple_source: 'category' | 'universe';
  category_observations: number;
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
  learn: LearnTable;
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
export function buildBoard(snapshot: Snapshot, table: LearnTable, params: ModelParams = PARAMS): BoardRow[] {
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

  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValueFor(p, table, snapshot.as_of, params) }));
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
    model: {
      category_multiple: s.v.multiple,
      multiple_source: s.v.multiple_source,
      category_observations: s.v.category_observations,
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
 * `learnCategoryMultiples` prices every pre-token protocol from.
 */
export function liveRows(snapshot: Snapshot, table: LearnTable): LiveRow[] {
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
        counted: ratio !== null && ratio > 0 && ratio < table.ratio_ceiling,
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
    multiple: row.model.category_multiple,
    multiple_source: row.model.multiple_source,
    category_observations: row.model.category_observations,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const table = learnCategoryMultiples(snapshot.protocols, snapshot.as_of);
  const board = buildBoard(snapshot, table);
  const live = liveRows(snapshot, table);
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
    learn: table,
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
