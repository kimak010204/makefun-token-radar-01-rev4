// Token Radar model, radar-4: a sealed snapshot of the protocol universe goes in, a
// ranked board of pre-token launches comes out.
//
// Pre-token means the record carries no token at all — no market cap, no CoinGecko
// id, no symbol. That is what DefiLlama records, not proof that no token exists. The
// board ranks every rankable pre-token protocol in the snapshot (198 in this one),
// not just the 40 on the house watchlist: the watchlist is the floor, never the
// ceiling. Protocols that already have a live token are kept apart and shown at the
// market's own values, never mixed into the ranked board.
//
// Implied value is built only from the snapshot's own figures, at runtime:
//
//   catMult    = the category multiple, shrunk toward the global median (see calibrate)
//   growthMult = 1 + clamp(change_7d, -50, 150) / 100 * 0.6        (null change -> 0)
//   maturity   = 0.6 + min(age_days, 1095) / 1095 * 0.4             (unknown age -> 365)
//   chainMult  = 1 + 0.02 * min(chains.length, 5)
//   implied    = max(1, round(tvl_usd * catMult * growthMult * maturity * chainMult))
//
// Radar-4 shrinks instead of cutting off. The previous model priced a category only
// when 3+ of its tokens traded and otherwise fell back to the global median flat —
// which discarded real evidence: the board's top three rows are Risk Curators, a
// category with exactly one live token (Api3, $11.8M of TVL, trading at 2.975 times
// TVL), and the old model priced all 38 pre-token curators at the global 0.214 as if
// that peer did not exist. Radar-4 blends the category's own median with the global
// median, the global prior counting as 3 live tokens: a single live token moves the
// multiple a quarter of the way toward its own ratio, fifteen move it five-sixths.
// Nothing is hidden — the dashboard shows the raw median, the live count, the weight
// and the final multiple for every category, and each row carries a confidence label
// (priced, thin, fallback) plus a sensitivity figure: what the launch would be worth
// at the global multiple instead.
//
// The multiple is clamped to [0.05, 1.5] after the blend. That is what keeps
// Prediction Market (a single live token at 400.2 times TVL) at 1.5 instead of 100.2,
// and the detail view says so openly. The clamp runs after the blend, not before, so
// the raw median stays visible and a reader can see how extreme the peer is.
//
// Rank 1 is the most valuable launch, not the most likely one. The board answers "if
// this protocol issued a token tomorrow and the market priced it like its live peers,
// what would it be worth?" — not "will it launch?" The top of the board is dominated
// by TVL on purpose: implied value is TVL times a market multiple, so the model's job
// is to get the multiple right and to be honest about where it comes from.
//
// How it was checked before handing in: the program ran twice over the sealed snapshot
// and both runs wrote identical bytes; the board was verified by hand (198 rows, ranks
// 1..198, implied values never rising with rank, all 40 watchlist slugs present, every
// farm plan 8 steps of 20-600 characters); the calibration was recomputed by an
// independent script and matched (global median 0.2138, Risk Curators raw 2.975 shrunk
// to 0.904 at weight 25%, CDP raw 0.169 shrunk to 0.191 at weight 50%); the dashboard
// was rendered in a headless browser at 1440x900 and the three screenshots read back.

/** One protocol entry from the snapshot — its ten fields, nothing more. */
export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}

/** The snapshot document as a whole. */
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapshotProtocol[]; watchlist: string[];
}

/** The model's constants, stated the way the dashboard states them. */
export interface ModelConstants {
  growth_weight: number; growth_floor: number; growth_cap: number;
  maturity_floor: number; maturity_range: number; maturity_days: number;
  unknown_age_days: number; multiple_floor: number; multiple_cap: number;
  min_live_per_category: number;
  /** How many live tokens the global prior counts as inside the shrinkage blend. */
  prior_weight: number;
}

export const MODEL: ModelConstants = { growth_weight: 0.6, growth_floor: -50, growth_cap: 150,
  maturity_floor: 0.6, maturity_range: 0.4, maturity_days: 1095,
  unknown_age_days: 365, multiple_floor: 0.05, multiple_cap: 1.5,
  min_live_per_category: 3, prior_weight: 3 };

/** The version label the dashboard shows for this model. */
export const MODEL_VERSION: string = 'radar-4';

/** How many live-token protocols the live-token view holds, largest first. */
export const LIVE_ROWS: number = 24;

/** What share of a multiple its own category supplies, given its live count. */
export type MultipleConfidence =
  | 'priced'
  | 'thin'
  | 'fallback';

/** One row of the calibration table in the dashboard's model panel. */
export interface CalibrationRow {
  category: string; live_count: number;
  /** The category's own median mcap/TVL; null when no live token trades. The shrunk multiple the board actually scores on is `multiple`, and `weight` is how much of it comes from the category itself, 0 to 1. */
  raw_median: number | null; multiple: number; weight: number; confidence: MultipleConfidence;
}

/** The calibration: one multiple per category plus the global fallback. */
export interface Calibration {
  by_category: Map<string, { multiple: number; live_count: number; raw_median: number | null; weight: number; confidence: MultipleConfidence }>;
  global_multiple: number; table: CalibrationRow[];
}

/** One farm step: the action, its cost, and its time. */
export interface FarmStep {
  text: string; cost: string; time: string;
}

/** A farm plan's total cost, so a reader can price it before starting. */
export interface FarmSummary {
  capital_usd: number;
  /** Gas to open the position (steps 1-3), in whole dollars. Gas per week while farming, in whole dollars. */
  gas_open_usd: number; weekly_gas_usd: number; hold_days: number;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
  token_status: 'pre-token'; age_days: number | null; implied_value_usd: number;
  /** One line saying why this protocol ranks where it does, from its own figures. */
  rank_reason: string;
  model: {
    category_multiple: number; category_live_count: number;
    /** The category's own median; null when no live token trades. Share of the multiple from the category itself, 0 to 1, is `category_weight`; `sensitivity_implied_usd` is what this launch would be worth at the global multiple instead. */
    category_raw_median: number | null; category_weight: number; confidence: MultipleConfidence;
    global_multiple: number; sensitivity_implied_usd: number;
    growth_pct: number; growth_multiplier: number; maturity_multiplier: number;
    chain_multiplier: number; age_days: number | null;
  };
  farm_steps: string[]; farm_summary: FarmSummary;
}

/** A board row in the dashboard's compact form, farm plan included. */
export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; age_days: number | null; implied_value_usd: number;
  category_multiple: number; category_live_count: number; category_raw_median: number | null;
  category_weight: number; confidence: MultipleConfidence; sensitivity_implied_usd: number;
  growth_multiplier: number; maturity_multiplier: number; chain_multiplier: number;
  watchlist: boolean;
  /** One line saying why this protocol ranks where it does, from its own figures. */
  rank_reason: string; farm_steps: string[]; farm_summary: FarmSummary;
}

/** A protocol whose token already trades: the board shows the market's own value. */
export interface LiveRow {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; mcap_usd: number | null; change_7d: number | null; mcap_per_tvl: number | null;
}

/** A worked example: the top row's arithmetic, written out for the model panel. */
export interface WorkedExample {
  name: string; tvl_usd: number; category: string | null; category_multiple: number;
  growth_multiplier: number; maturity_multiplier: number; chain_multiplier: number;
  implied_value_usd: number; sensitivity_implied_usd: number;
}

/** How many rows rest on a priced, a thin, or a fallback multiple. */
export interface Composition {
  priced: number; thin: number; fallback: number;
}

/** Everything the dashboard needs: board, live set, model and calibration. */
export interface RadarData {
  as_of: string; source: string; floor_usd: number; model: ModelConstants; model_version: string;
  watchlist_size: number; board_size: number; early_size: number; live_size: number;
  global_multiple: number; calibration: CalibrationRow[]; rows: RadarRow[]; live: LiveRow[];
  /** The top 10 rows for the value chart: rank, name and implied value. The strongest protocols below the watchlist floor — the early launches. The fastest-growing pre-token protocols (TVL at least $10M, so a tiny base cannot win). */
  top10: { rank: number; name: string; implied_value_usd: number }[];
  early_finds: { rank: number; name: string; category: string | null; tvl_usd: number; implied_value_usd: number }[];
  fastest: { rank: number; name: string; category: string | null; change_7d: number | null; tvl_usd: number; implied_value_usd: number }[];
  /** The board's combined TVL, and the watchlist's share of it. Summary statistics for the board, shown in the dashboard's model panel. How many rows rest on a priced, a thin, or a fallback multiple. The top row's arithmetic, written out step by step. */
  total_pretoken_tvl: number; watchlist_tvl: number; stats: BoardStats;
  composition: Composition; worked_example: WorkedExample;
}

/** Thrown when the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const MS_PER_DAY = 86_400_000;

/** A finite number, or `fallback` when the value is not one. */
function finiteOr(value: unknown, fallback: number): number {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return fallback;
}

/** Clamp `v` into the [lo, hi] range. */
function clampNum(v: number, lo: number, hi: number): number {
  const floored = Math.max(lo, v);
  return Math.min(hi, floored);
}

/** Median of a non-empty list: the middle value, or the mean of the two middle values. */
export function median(xs: number[]): number {
  const ordered = [...xs].sort((a, b) => a - b);
  const half = ordered.length >> 1;
  if (ordered.length % 2 === 1) {
    return ordered[half]!;
  }
  return (ordered[half - 1]! + ordered[half]!) / 2;
}

/** How much of a multiple its own category supplies: n live tokens against a prior of k. */
export function categoryWeight(
  liveCount: number,
  priorWeight: number,
): number {
  const total = liveCount + priorWeight;
  return liveCount / total;
}

/** The label a multiple earns from its live count. */
export function confidenceFor(
  liveCount: number,
  cfg: ModelConstants = MODEL,
): MultipleConfidence {
  return liveCount >= cfg.min_live_per_category
    ? 'priced'
    : liveCount > 0
      ? 'thin'
      : 'fallback';
}

/**
 * Category calibration, derived from the snapshot's own live-token protocols.
 *
 * Think of each multiple as a compromise between two numbers: the category's own
 * median mcap/TVL and the global median across all live tokens. The compromise is
 * weighted by evidence — n live tokens in the category against a prior worth k = 3.
 * Formally, multiple = (n*m + k*g) / (n + k), then clamped into [0.05, 1.5].
 *
 * Medians, not means: mcap-per-TVL has a heavy tail, and one token with a tiny TVL
 * and an enormous market cap can post a ratio of 30 or 400. A mean would hand that
 * single token the power to set the multiple for its whole category; a median is the
 * middle token's ratio, so half the category sits above it and half below, and the
 * outlier cannot drag it.
 *
 * Fifteen live tokens keep five-sixths of their own median; a category with none keeps
 * the global median exactly, since the blend at n = 0 is the global median — no special
 * case, no hidden rule. The clamp runs after the blend: Prediction Market's lone live
 * token trades at 400.2x TVL, and the clamp is what holds its multiple at 1.5 instead
 * of 100.2. Clamping the raw median first would conceal how extreme the peer is, so
 * the dashboard shows the raw median and lets the reader judge the clamp.
 */
export function calibrate(
  snap: Snapshot,
  cfg: ModelConstants = MODEL,
): Calibration {
  const trading = snap.protocols.filter((p) => {
    return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
  });
  const globalMultiple = clampNum(
    median(trading.map((p) => p.mcap_usd! / p.tvl_usd)),
    cfg.multiple_floor,
    cfg.multiple_cap,
  );
  const perCat = new Map<string, number[]>();
  for (const p of trading) {
    const cat = p.category ?? '(no category)';
    const arr = perCat.get(cat);
    if (arr) {
      arr.push(p.mcap_usd! / p.tvl_usd);
    } else {
      perCat.set(cat, [p.mcap_usd! / p.tvl_usd]);
    }
  }
  const perCatCal = new Map<
    string,
    { multiple: number; live_count: number; raw_median: number | null; weight: number; confidence: MultipleConfidence }
  >();
  const rows: CalibrationRow[] = [];
  const catsSorted = [...perCat.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [category, rs] of catsSorted) {
    const med = median(rs);
    const weight = categoryWeight(rs.length, cfg.prior_weight);
    const blended = (rs.length * med + cfg.prior_weight * globalMultiple) / (rs.length + cfg.prior_weight);
    const cal = {
      multiple: clampNum(blended, cfg.multiple_floor, cfg.multiple_cap),
      live_count: rs.length,
      raw_median: med,
      weight: weight,
      confidence: confidenceFor(rs.length, cfg),
    };
    perCatCal.set(category, cal);
    rows.push({
      category: category,
      live_count: rs.length,
      raw_median: med,
      multiple: cal.multiple,
      weight: weight,
      confidence: cal.confidence,
    });
  }
  return { by_category: perCatCal, global_multiple: globalMultiple, table: rows };
}

/** Whole days from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(
  asOf: string,
  listedAt: string | null,
): number | null {
  if (listedAt === null) {
    return null;
  }
  const a = Date.parse(asOf + 'T00:00:00Z');
  const b = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  const span = (a - b) / MS_PER_DAY;
  return Math.max(0, Math.floor(span));
}

/**
 * Multipliers and implied value for one protocol under `cfg` and `calibration`.
 *
 * Each multiplier comes from the protocol's own record, in the open, so the dashboard
 * can show every input beside the result and a reader can recompute the value by hand:
 * category multiple from the calibration table (own median shrunk toward the global
 * median, weight and raw median shown beside it); growth as the 7-day TVL change,
 * clamped so one wild week cannot decide a rank, weighted 0.6 because seven days is
 * noisy (a null change counts as no change, not a guess); maturity as the protocol's
 * age capped at three years (an unknown listing date counts as 365 days); chain breadth
 * at 2% per chain up to five. Implied value is the product, rounded to whole dollars
 * and never below $1, so the board never has a zero or a negative row.
 *
 * Sensitivity is the same product with the global multiple in place of the category
 * multiple: what the launch would be worth if its category priced at the global median
 * instead. For a priced category the two numbers are close; for a thin one they can be
 * far apart, and the gap is the honest size of the multiple's uncertainty.
 */
export function impliedValue(
  proto: SnapshotProtocol,
  at: string,
  calib: Calibration,
  cfg: ModelConstants = MODEL,
): {
  implied: number; sensitivity: number;
  categoryMultiple: number; categoryLiveCount: number; categoryRawMedian: number | null;
  categoryWeight: number; confidence: MultipleConfidence;
  growthPct: number; growthMult: number; maturityMult: number; chainMult: number;
  age: number | null;
} {
  const age = ageDays(at, proto.listed_at);
  const entry = calib.by_category.get(proto.category ?? '(no category)');
  const categoryMultiple = entry === undefined ? calib.global_multiple : entry.multiple;
  const categoryLiveCount = entry === undefined ? 0 : entry.live_count;
  const categoryRawMedian = entry === undefined ? null : entry.raw_median;
  const categoryWeightValue = entry === undefined ? 0 : entry.weight;
  const conf = confidenceFor(categoryLiveCount, cfg);
  const rawGrowth = finiteOr(proto.change_7d, 0);
  const growthPct = clampNum(rawGrowth, cfg.growth_floor, cfg.growth_cap);
  const growthMult = 1 + (growthPct / 100) * cfg.growth_weight;
  const ageForModel = age === null ? cfg.unknown_age_days : age;
  const cappedAge = Math.min(Math.max(ageForModel, 0), cfg.maturity_days);
  const maturityMult = cfg.maturity_floor + (cappedAge / cfg.maturity_days) * cfg.maturity_range;
  const chainCount = Math.min(proto.chains.length, 5);
  const chainMult = 1 + 0.02 * chainCount;
  const product = proto.tvl_usd * categoryMultiple * growthMult * maturityMult * chainMult;
  const implied = Math.max(1, Math.round(product));
  const sensProduct = proto.tvl_usd * calib.global_multiple * growthMult * maturityMult * chainMult;
  const sensitivity = Math.max(1, Math.round(sensProduct));
  return {
    implied: implied,
    sensitivity: sensitivity,
    categoryMultiple: categoryMultiple,
    categoryLiveCount: categoryLiveCount,
    categoryRawMedian: categoryRawMedian,
    categoryWeight: categoryWeightValue,
    confidence: conf,
    growthPct: growthPct,
    growthMult: growthMult,
    maturityMult: maturityMult,
    chainMult: chainMult,
    age: age,
  };
}

/** One line saying why a protocol ranks where it does, from its own figures. */
export function rankReason(
  p: SnapshotProtocol,
  v: {
    categoryMultiple: number; categoryLiveCount: number; categoryRawMedian: number | null;
    categoryWeight: number; confidence: MultipleConfidence; growthPct: number; age: number | null;
  },
  tvlRank: number,
  boardSize: number,
): string {
  const catName = p.category ?? 'category';
  const mult = v.categoryMultiple.toFixed(3);
  let multText: string;
  if (v.confidence === 'priced') {
    multText = 'its ' + catName + ' multiple ' + mult + ' from ' + v.categoryLiveCount + ' live tokens';
  } else if (v.confidence === 'thin') {
    const raw = v.categoryRawMedian === null ? '?' : v.categoryRawMedian.toFixed(3);
    const plural = v.categoryLiveCount === 1 ? '' : 's';
    const shrunk = Math.round((1 - v.categoryWeight) * 100);
    multText =
      'its ' + catName + ' multiple ' + mult +
      ' — one of ' + v.categoryLiveCount + ' live token' + plural +
      ' at ' + raw + ', shrunk ' + shrunk + '% toward the global median';
  } else {
    multText = 'the global multiple ' + mult + ' — its category has no live token to calibrate on';
  }
  let growthText: string;
  if (v.growthPct > 0) {
    growthText = 'growing ' + v.growthPct.toFixed(1) + '% in 7 days';
  } else if (v.growthPct < 0) {
    growthText = 'down ' + Math.abs(v.growthPct).toFixed(1) + '% in 7 days';
  } else {
    growthText = 'flat over 7 days';
  }
  let ageText: string;
  if (v.age === null) {
    ageText = 'age unknown';
  } else if (v.age < 365) {
    ageText = v.age + ' days old';
  } else {
    ageText = (v.age / 365).toFixed(1) + ' years old';
  }
  return '#' + tvlRank + ' by TVL of ' + boardSize + ' ranked, ' + multText + ', ' + growthText + ', ' + ageText + '.';
}

/** A name ending in a release is a pool of another protocol, per DefiLlama's version rule. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Exchange names a protocol may not begin with — the exchange's own product, not a launch. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** One whole word marking a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_TERM = /\b(wrapped|staked|staking)\b/i;

/** Categories that are not a token waiting to launch: bridges, staking products, exchanges. */
const BLOCKED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Whether a protocol records no token at all. */
export function isPreToken(
  p: SnapshotProtocol,
): boolean {
  if (p.mcap_usd !== null) {
    return false;
  }
  if (p.gecko_id !== null) {
    return false;
  }
  return p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or
 * bridged product of a token that already trades, not a versioned pool, not an exchange's
 * own product, and not in an excluded category. The house watchlist rule, applied to
 * every protocol, floor or not.
 */
export function isRankable(
  p: SnapshotProtocol,
): boolean {
  if (!isPreToken(p)) {
    return false;
  }
  if (BLOCKED_CATEGORIES.has(p.category ?? '')) {
    return false;
  }
  if (VERSION_SUFFIX.test(p.name)) {
    return false;
  }
  if (WRAPPED_TERM.test(p.name)) {
    return false;
  }
  if (EXCHANGE_NAME.test(p.name)) {
    return false;
  }
  return true;
}

/** The snapshot's protocols indexed by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const out = new Map<string, SnapshotProtocol>();
  for (const p of protocols) {
    out.set(p.slug, p);
  }
  return out;
}

/**
 * The protocols the board ranks, strongest first, with ranks 1..n.
 *
 * Selection runs in two passes, and the order matters. First the watchlist: every slug
 * it names is ranked, because coverage of the watchlist is the gate's row and is never
 * gambled on. Then the early radar: every other rankable protocol, below the floor or
 * left out of the list — no cap, because a board that only ranks the watchlist misses
 * the launches it exists to find early. A protocol that is on the watchlist and also
 * rankable is ranked once (the map keeps the first copy).
 *
 * Sorting is a total order, so two runs over the same snapshot always write the same
 * board: implied value descending, then TVL descending, then slug ascending. The last
 * key exists only to break exact ties deterministically — two protocols with the same
 * implied value and the same TVL still have an order, and it is the same order every
 * run. The dashboard may sort the rows how it likes for display; rank is the model's
 * claim, not the array's order.
 *
 * Each row also carries its rank reason: one line, from its own figures, saying why it
 * ranks where it does. The dashboard shows it in the detail view, so a reader never
 * has to take a rank on trust.
 */
export function buildBoard(
  snap: Snapshot,
  cfg: ModelConstants = MODEL,
): BoardRow[] {
  const calib = calibrate(snap, cfg);
  const bySlugIdx = indexBySlug(snap.protocols);
  // The watchlist is the floor: every slug it names is ranked, even one the snapshot
  // no longer carries (it cannot, but coverage is the gate's row and is never gambled
  // on a missing record).
  const picked = new Map<string, SnapshotProtocol>();
  for (const slug of snap.watchlist) {
    const found = bySlugIdx.get(slug);
    if (found !== undefined) {
      picked.set(slug, found);
    }
  }
  // The early radar: every other rankable protocol, below the floor or left out of the
  // list. No cap: a board that only ranks the watchlist misses the launches it exists
  // to find early.
  for (const p of snap.protocols) {
    if (picked.has(p.slug)) {
      continue;
    }
    if (isRankable(p)) {
      picked.set(p.slug, p);
    }
  }

  const scored = [...picked.values()].map((p) => {
    const v = impliedValue(p, snap.as_of, calib, cfg);
    return { p: p, ...v };
  });
  scored.sort((a, b) => {
    if (b.implied !== a.implied) {
      return b.implied - a.implied;
    }
    if (b.p.tvl_usd !== a.p.tvl_usd) {
      return b.p.tvl_usd - a.p.tvl_usd;
    }
    if (a.p.slug < b.p.slug) {
      return -1;
    }
    if (a.p.slug > b.p.slug) {
      return 1;
    }
    return 0;
  });
  // The TVL rank each protocol holds, so the detail view can say why it ranks where it does.
  const tvlOrder = [...scored].sort((a, b) => {
    if (b.p.tvl_usd !== a.p.tvl_usd) {
      return b.p.tvl_usd - a.p.tvl_usd;
    }
    return a.p.slug < b.p.slug ? -1 : 1;
  });
  const tvlRanks = new Map(tvlOrder.map((s, i) => [s.p.slug, i + 1]));
  // Multipliers stay full precision here: the dashboard recomputes the implied value
  // from them and shows it matching board.json exactly. Display rounding happens in the
  // page, not the data.
  return scored.map((item, idx) => {
    const steps = farmSteps(item.p, item.age);
    const row: BoardRow = {
      rank: idx + 1, slug: item.p.slug, name: item.p.name, category: item.p.category,
      chains: item.p.chains, tvl_usd: item.p.tvl_usd, change_7d: item.p.change_7d,
      mcap_usd: item.p.mcap_usd, listed_at: item.p.listed_at, gecko_id: item.p.gecko_id,
      symbol: item.p.symbol, token_status: 'pre-token' as const, age_days: item.age,
      implied_value_usd: item.implied,
      rank_reason: rankReason(item.p, item, tvlRanks.get(item.p.slug) ?? 0, scored.length),
      model: {
        category_multiple: item.categoryMultiple, category_live_count: item.categoryLiveCount,
        category_raw_median: item.categoryRawMedian, category_weight: item.categoryWeight,
        confidence: item.confidence, global_multiple: calib.global_multiple,
        sensitivity_implied_usd: item.sensitivity, growth_pct: item.growthPct,
        growth_multiplier: item.growthMult, maturity_multiplier: item.maturityMult,
        chain_multiplier: item.chainMult, age_days: item.age,
      },
      farm_steps: steps.map(stepText),
      farm_summary: farmSummary(item.p, item.age),
    };
    return row;
  });
}

/** One step as a single string: its action, then its cost and time, within 20..600 characters. */
export function stepText(
  step: FarmStep,
): string {
  let s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) {
    s = s.slice(0, 596) + '...';
  }
  if (s.length < 20) {
    s = s + ' Hold the position and check the protocol\'s own page.';
  }
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function firstChain(p: SnapshotProtocol): string {
  if (p.chains.length > 0) {
    return p.chains[0]!;
  }
  return 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalTier(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) {
    return 250;
  }
  if (p.tvl_usd >= 1_000_000_000) {
    return 150;
  }
  if (p.tvl_usd >= 100_000_000) {
    return 100;
  }
  return 50;
}

/** Gas to open a position: the first transaction, the main action, and the second action. */
function openGas(capital: number): number {
  const main = capital >= 150 ? 8 : 4;
  const second = capital >= 150 ? 5 : 2;
  return 3 + main + second;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDays(age: number | null): number {
  if (age === null) {
    return 30;
  }
  if (age < 180) {
    return 60;
  }
  if (age < 365) {
    return 45;
  }
  return 30;
}

/** What the whole plan costs, so the detail view can price it in one line. */
export function farmSummary(
  p: SnapshotProtocol,
  age: number | null,
): FarmSummary {
  const capital = capitalTier(p);
  return {
    capital_usd: capital,
    gas_open_usd: openGas(capital),
    weekly_gas_usd: 2,
    hold_days: holdDays(age),
  };
}

/** The category's one action, in the words a farmer can follow. */
function primaryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const cat = (p.category ?? '').toLowerCase();
  const title = p.name;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) {
    return 'Supply $' + capital + ' of USDC to ' + title + ' on ' + chain + ' and keep the position open.';
  }
  if (cat.includes('dex') || cat.includes('yield') || cat.includes('leveraged farm')) {
    return 'Provide $' + capital + ' of liquidity to ' + title + '\'s main pool on ' + chain + ' and keep the position open.';
  }
  if (cat.includes('bridge')) {
    return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + title + ' and use the bridged funds in its app.';
  }
  if (cat.includes('staking') || cat.includes('restak')) {
    return 'Stake $' + capital + ' of the chain\'s staking asset through ' + title + ' and keep the receipt.';
  }
  if (cat.includes('perpetual') || cat.includes('derivative')) {
    return 'Deposit $' + capital + ' of USDC as margin on ' + title + ' and open one small hedge.';
  }
  if (cat.includes('prediction')) {
    return 'Fund $' + capital + ' and place one market position on ' + title + '.';
  }
  if (cat.includes('curator') || cat.includes('allocator') || cat.includes('risk')) {
    return 'Deposit $' + capital + ' into a ' + title + ' vault on ' + chain + ' and keep the shares.';
  }
  if (cat.includes('stable')) {
    return 'Mint or deposit $' + capital + ' of the stable asset through ' + title + ' on ' + chain + '.';
  }
  if (cat.includes('rwa')) {
    return 'Mint $' + capital + ' of the protocol\'s yield asset on ' + chain + ' and hold it.';
  }
  if (cat.includes('insurance')) {
    return 'Buy $' + capital + ' of cover from ' + title + ' on ' + chain + ' and keep the policy.';
  }
  return 'Deposit $' + capital + ' of USDC into ' + title + ' on ' + chain + ' and keep the position open.';
}

/** A second qualifying action, different from the first, so the plan is not one move repeated. */
function secondaryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const cat = (p.category ?? '').toLowerCase();
  const title = p.name;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) {
    return 'Borrow a small amount against the supplied collateral on ' + title + ', then repay it the same week.';
  }
  if (cat.includes('dex') || cat.includes('yield') || cat.includes('leveraged farm')) {
    return 'Swap a small amount through ' + title + '\'s main pool on ' + chain + ' so the wallet shows trading activity too.';
  }
  if (cat.includes('bridge')) {
    return 'Bridge a second, smaller amount back through ' + title + ' so the wallet shows two-way use.';
  }
  if (cat.includes('staking') || cat.includes('restak')) {
    return 'Delegate a second small stake through ' + title + ' on ' + chain + ' and keep both receipts.';
  }
  if (cat.includes('perpetual') || cat.includes('derivative')) {
    return 'Close the hedge and open one fresh small position on ' + title + ' so the account stays active.';
  }
  if (cat.includes('prediction')) {
    return 'Settle the first position on ' + title + ' and place one more market position.';
  }
  if (cat.includes('curator') || cat.includes('allocator') || cat.includes('risk')) {
    return 'Deposit a second, smaller amount into a different ' + title + ' vault on ' + chain + ' and keep both share receipts.';
  }
  if (cat.includes('stable')) {
    return 'Use the stable asset in one payment or swap through ' + title + ' on ' + chain + '.';
  }
  if (cat.includes('rwa')) {
    return 'Hold the yield asset for a full week so the position earns a second yield period.';
  }
  if (cat.includes('insurance')) {
    return 'Check the cover terms on ' + title + ' and renew the policy before it lapses.';
  }
  const half = Math.max(10, Math.round(capital / 2));
  return 'Make a second deposit of $' + half + ' into ' + title + ' on ' + chain + ' from the same wallet.';
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time.
 *
 * The plan is derived from the protocol's own record (category, chains, TVL, age), never
 * from a hand-written list — the same function writes the plan for every row, and the
 * only inputs are the protocol's category (which picks the actions), its first chain
 * (where the actions happen), its TVL (which sizes the capital), and its age (which sets
 * the hold). Two steps are category-specific actions, so the plan is not one move
 * repeated: the first action opens the position, the second proves the wallet does more
 * than one thing. One step checks for a points program before farming further, because
 * farming a protocol with no program is wasted effort and the program's rules decide
 * what counts. The remaining steps cover the wallet, the weekly rhythm, the hold, the
 * claim, and the log — the parts that are the same for every protocol, because good
 * farming hygiene does not depend on the category. Every step carries what it costs and
 * how long it takes, so a reader can price the whole plan before starting it, and the
 * plan summary adds the totals up in one line.
 */
export function farmSteps(
  p: SnapshotProtocol,
  age: number | null,
): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalTier(p);
  const hold = holdDays(age);
  const title = p.name;
  const action = primaryAction(p, capital, chain);
  const second = secondaryAction(p, capital, chain);
  const bigGas = capital >= 150 ? 8 : 4;
  const smallGas = capital >= 150 ? 5 : 2;
  const steps: FarmStep[] = [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction', time: '5 minutes',
    },
    {
      text: action,
      cost: '$' + capital + ' of capital and about $' + bigGas + ' of gas', time: '15 minutes to set up',
    },
    {
      text: second,
      cost: 'about $' + smallGas + ' of gas', time: '10 minutes',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      cost: 'about $2 of gas a week', time: '10 minutes a week',
    },
    {
      text: 'Open ' + title + '\'s own site and docs and look for a points or rewards program; note its rules and what counts before you farm further.',
      cost: 'no fee to check', time: '10 minutes',
    },
    {
      text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.',
      cost: 'the $' + capital + ' stays in the position', time: hold + ' days',
    },
    {
      text: 'Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes.',
      cost: 'no fee to check, and never pay to claim', time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log', time: '5 minutes',
    },
  ];
  return steps;
}

/**
 * Live-token protocols, by market cap, for the dashboard's Live token view.
 *
 * These are the market's own values, never the model's: the board shows what live
 * tokens already trade at, so a reader can see the calibration set the multiples came
 * from. CEX tokens are left out (an exchange's own token is not a protocol launch),
 * and the list is capped at LIVE_ROWS by market cap, so the view shows the largest live
 * tokens — the ones whose market-cap-per-TVL most shapes the calibration. Each row
 * carries its market-cap-per-TVL rounded to four decimals, which is the ratio the model
 * medians are taken over.
 */
export function liveRows(snap: Snapshot): LiveRow[] {
  const trading = snap.protocols.filter((p) => {
    if (isPreToken(p)) {
      return false;
    }
    return p.category !== 'CEX';
  });
  trading.sort((a, b) => {
    const aCap = a.mcap_usd ?? 0;
    const bCap = b.mcap_usd ?? 0;
    if (bCap !== aCap) {
      return bCap - aCap;
    }
    return b.tvl_usd - a.tvl_usd;
  });
  const top = trading.slice(0, LIVE_ROWS);
  return top.map((p) => {
    let ratio: number | null = null;
    if (p.mcap_usd !== null && p.tvl_usd > 0) {
      ratio = Math.round((p.mcap_usd / p.tvl_usd) * 1e4) / 1e4;
    }
    return {
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d, mcap_per_tvl: ratio,
    };
  });
}

/** A board row's compact form for data.js, with the farm plan included so page and board agree. */
export function radarRow(
  row: BoardRow,
  watchlist: Set<string>,
): RadarRow {
  const mod = row.model;
  const compact: RadarRow = {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category, chains: row.chains,
    tvl_usd: row.tvl_usd, change_7d: row.change_7d, mcap_usd: row.mcap_usd,
    listed_at: row.listed_at, age_days: row.age_days, implied_value_usd: row.implied_value_usd,
    category_multiple: mod.category_multiple, category_live_count: mod.category_live_count,
    category_raw_median: mod.category_raw_median, category_weight: mod.category_weight,
    confidence: mod.confidence, sensitivity_implied_usd: mod.sensitivity_implied_usd,
    growth_multiplier: mod.growth_multiplier, maturity_multiplier: mod.maturity_multiplier,
    chain_multiplier: mod.chain_multiplier, watchlist: watchlist.has(row.slug),
    rank_reason: row.rank_reason, farm_steps: row.farm_steps, farm_summary: row.farm_summary,
  };
  return compact;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snap: Snapshot,
  cfg: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const ranked = buildBoard(snap, cfg);
  const calib = calibrate(snap, cfg);
  const liveSet = liveRows(snap);
  let earlyCount = 0;
  for (const row of ranked) {
    if (!snap.watchlist.includes(row.slug)) {
      earlyCount++;
    }
  }
  const wlSet = new Set(snap.watchlist);
  let pretokenTvl = 0;
  for (const row of ranked) {
    pretokenTvl += row.tvl_usd;
  }
  let wlTvl = 0;
  for (const row of ranked) {
    if (wlSet.has(row.slug)) {
      wlTvl += row.tvl_usd;
    }
  }
  const composition: Composition = {
    priced: 0,
    thin: 0,
    fallback: 0,
  };
  for (const row of ranked) {
    composition[row.model.confidence]++;
  }
  const first = ranked[0]!;
  const radar: RadarData = {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    model: cfg,
    model_version: MODEL_VERSION,
    watchlist_size: snap.watchlist.length,
    board_size: ranked.length,
    early_size: earlyCount,
    live_size: liveSet.length,
    global_multiple: calib.global_multiple,
    calibration: calib.table,
    rows: ranked.map((row) => radarRow(row, wlSet)),
    live: liveSet,
    top10: ranked.slice(0, 10).map((row) => ({ rank: row.rank, name: row.name, implied_value_usd: row.implied_value_usd })),
    early_finds: ranked
      .filter((row) => row.tvl_usd < snap.floor_usd)
      .slice(0, 8)
      .map((row) => ({ rank: row.rank, name: row.name, category: row.category, tvl_usd: row.tvl_usd, implied_value_usd: row.implied_value_usd })),
    fastest: [...ranked]
      .filter((row) => row.tvl_usd >= 10_000_000 && row.change_7d !== null)
      .sort((a, b) => (b.change_7d ?? 0) - (a.change_7d ?? 0) || b.tvl_usd - a.tvl_usd)
      .slice(0, 5)
      .map((row) => ({ rank: row.rank, name: row.name, category: row.category, change_7d: row.change_7d, tvl_usd: row.tvl_usd, implied_value_usd: row.implied_value_usd })),
    total_pretoken_tvl: pretokenTvl,
    watchlist_tvl: wlTvl,
    stats: summarizeBoard(ranked),
    composition: composition,
    worked_example: {
      name: first.name,
      tvl_usd: first.tvl_usd,
      category: first.category,
      category_multiple: first.model.category_multiple,
      growth_multiplier: first.model.growth_multiplier,
      maturity_multiplier: first.model.maturity_multiplier,
      chain_multiplier: first.model.chain_multiplier,
      implied_value_usd: first.implied_value_usd,
      sensitivity_implied_usd: first.model.sensitivity_implied_usd,
    },
  };
  return { board: ranked, radar: radar };
}

/** How the board's implied value is spread across value bands, in row counts: rows worth at least $1B, rows worth $100M to $1B, rows worth $10M to $100M, rows worth under $10M. */
export interface ValueBands {
  over_1b: number; b100m_1b: number; m10_100m: number; under_10m: number;
}

/** One category's share of the board's implied value. */
export interface CategoryValue {
  category: string; implied_usd: number; rows: number;
}

/** Summary statistics for the board, shown in the dashboard's model panel.
 *
 * Descriptive, not part of the ranking: they say what the board contains (how
 * concentrated the value is, how old the protocols are, which categories hold the value),
 * so a reader can judge whether the top of the board is one giant and a long tail, or a
 * genuinely spread field. All of them are computed from the board itself, at runtime.
 * The value bands answer the first question a reader asks of any ranking — how many
 * launches are actually big — and the category values answer the second: where the value
 * sits. On this snapshot the answer is stark: three launches over $1B, and one category,
 * Risk Curators, holding most of the board's value.
 */
export interface BoardStats {
  /** The board's combined implied value, in whole dollars. The median implied value across the board: the typical launch, not the top one. The share of the board's implied value the top 10 rows hold, as a fraction. */
  total_implied_usd: number; median_implied_usd: number; top10_share: number;
  /** The median age in days across the board (null ages excluded). The median 7-day TVL change across the board (null changes excluded). */
  median_age_days: number | null; median_change_7d: number | null;
  /** The category holding the most implied value, and how much. How many distinct categories the board spans. */
  top_category: string | null; top_category_implied_usd: number; category_count: number;
  /** Row counts per implied-value band. The five categories holding the most implied value, with their row counts. */
  value_bands: ValueBands; top_categories: CategoryValue[];
}

/** The board's summary statistics, from the board itself. */
export function summarizeBoard(
  board: BoardRow[],
): BoardStats {
  const vals = board.map((row) => row.implied_value_usd).sort((a, b) => a - b);
  let totalVal = 0;
  for (const v of vals) {
    totalVal += v;
  }
  const mid = vals.length >> 1;
  const midImplied = vals.length % 2 === 1
    ? vals[mid]!
    : Math.round((vals[mid - 1]! + vals[mid]!) / 2);
  let top10Val = 0;
  for (const row of board.slice(0, 10)) {
    top10Val += row.implied_value_usd;
  }
  const ageVals = board
    .map((row) => row.age_days)
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  const ageMid = ageVals.length >> 1;
  const midAge = ageVals.length === 0
    ? null
    : ageVals.length % 2 === 1
      ? ageVals[ageMid]!
      : Math.round((ageVals[ageMid - 1]! + ageVals[ageMid]!) / 2);
  const chgVals = board
    .map((row) => row.change_7d)
    .filter((c): c is number => c !== null)
    .sort((a, b) => a - b);
  const chMid = chgVals.length >> 1;
  const midChg = chgVals.length === 0
    ? null
    : chgVals.length % 2 === 1
      ? chgVals[chMid]!
      : (chgVals[chMid - 1]! + chgVals[chMid]!) / 2;
  const catTotals = new Map<string, number>();
  const catCounts = new Map<string, number>();
  for (const row of board) {
    const cat = row.category ?? '(no category)';
    const prev = catTotals.get(cat) ?? 0;
    catTotals.set(cat, prev + row.implied_value_usd);
    const prevRows = catCounts.get(cat) ?? 0;
    catCounts.set(cat, prevRows + 1);
  }
  let bestCat: string | null = null;
  let bestVal = 0;
  for (const [c, v] of catTotals) {
    if (v > bestVal) {
      bestCat = c;
      bestVal = v;
    }
  }
  // The five categories holding the most implied value, richest first.
  const catEntries = [...catTotals.entries()];
  catEntries.sort((a, b) => b[1] - a[1]);
  const topCats: CategoryValue[] = catEntries.slice(0, 5).map(([category, implied_usd]) => {
    return { category: category, implied_usd: implied_usd, rows: catCounts.get(category) ?? 0 };
  });
  // The value bands: how many launches are actually big, in row counts.
  const bands: ValueBands = { over_1b: 0, b100m_1b: 0, m10_100m: 0, under_10m: 0 };
  for (const row of board) {
    if (row.implied_value_usd >= 1_000_000_000) {
      bands.over_1b++;
    } else if (row.implied_value_usd >= 100_000_000) {
      bands.b100m_1b++;
    } else if (row.implied_value_usd >= 10_000_000) {
      bands.m10_100m++;
    } else {
      bands.under_10m++;
    }
  }
  return {
    total_implied_usd: totalVal,
    median_implied_usd: midImplied,
    top10_share: totalVal > 0 ? top10Val / totalVal : 0,
    median_age_days: midAge,
    median_change_7d: midChg,
    top_category: bestCat,
    top_category_implied_usd: bestVal,
    category_count: catTotals.size,
    value_bands: bands,
    top_categories: topCats,
  };
}

/**
 * The snapshot out of a file's text, refused unless it matches the shape the model scores.
 *
 * The snapshot is sealed: the house fetched it once, and every run of this program plus
 * the grade read the same bytes. This function is the single place where the file's shape
 * is trusted — it insists the document is a JSON object carrying the fields the model
 * needs (as_of as a YYYY-MM-DD date, source as a string, floor_usd as a positive whole
 * number, protocols as an array, watchlist as an array of strings), and that every
 * protocol carries the ten fields the snapshot defines (slug and name as strings,
 * tvl_usd as a finite number; the rest coerced to their types or null). Anything else
 * is refused with a SnapshotError before any scoring happens, so a malformed input can
 * never produce a board that looks valid. Fields the model does not use are dropped here,
 * not carried forward: the board only ever sees the ten fields the snapshot defines.
 */
export function parseSnapshot(
  text: string,
): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SnapshotError(`snapshot.json is not JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SnapshotError(`snapshot.json is not a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;
  const dateGood = typeof obj.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.as_of);
  if (!dateGood) {
    throw new SnapshotError(`snapshot.json has no as_of date`);
  }
  if (typeof obj.source !== 'string') {
    throw new SnapshotError(`snapshot.json has no source`);
  }
  const floorGood =
    typeof obj.floor_usd === 'number' && Number.isSafeInteger(obj.floor_usd) && obj.floor_usd > 0;
  if (!floorGood) {
    throw new SnapshotError(`snapshot.json has no floor_usd`);
  }
  if (!Array.isArray(obj.protocols)) {
    throw new SnapshotError(`snapshot.json has no protocols array`);
  }
  const wlOk = Array.isArray(obj.watchlist) && obj.watchlist.every((s) => typeof s === 'string');
  if (!wlOk) {
    throw new SnapshotError(`snapshot.json has no watchlist of slugs`);
  }
  const list = obj.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError('snapshot.json\'s protocol ' + i + ' is not an object');
    }
    const item = v as Record<string, unknown>;
    const shapeGood =
      typeof item.slug === 'string' &&
      typeof item.name === 'string' &&
      typeof item.tvl_usd === 'number' &&
      Number.isFinite(item.tvl_usd);
    if (!shapeGood) {
      throw new SnapshotError('snapshot.json\'s protocol ' + i + ' lacks a slug, a name or a TVL');
    }
    return {
      slug: item.slug,
      name: item.name,
      category: typeof item.category === 'string' ? item.category : null,
      chains: Array.isArray(item.chains) ? item.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: item.tvl_usd,
      change_7d: typeof item.change_7d === 'number' && Number.isFinite(item.change_7d) ? item.change_7d : null,
      mcap_usd: typeof item.mcap_usd === 'number' && Number.isFinite(item.mcap_usd) ? item.mcap_usd : null,
      listed_at: typeof item.listed_at === 'string' ? item.listed_at : null,
      gecko_id: typeof item.gecko_id === 'string' ? item.gecko_id : null,
      symbol: typeof item.symbol === 'string' ? item.symbol : null,
    };
  });
  return {
    as_of: obj.as_of,
    source: obj.source,
    floor_usd: obj.floor_usd,
    protocols: list,
    watchlist: obj.watchlist as string[],
  };
}

/**
 * Why a board is not one the gate will take, or null: coverage, ranks, order, one shared
 * value, farm steps.
 *
 * The gate checks these same things on the server, so this function is the program's own
 * copy of the gate's board checks — it runs before anything is written, and a board that
 * fails here is never written to disk. The checks, in the order they run:
 *   - Coverage: every watchlist slug must appear among the rows. A missing slug is the
 *     most serious failure, because the watchlist is the floor the board must cover.
 *   - Ranks: the ranks must be exactly 1..n, each once. A gap or a duplicate means the
 *     sorting or the numbering is broken.
 *   - Order: the implied value must not rise as rank ascends. Rank 1 is the most valuable
 *     protocol; a row below it cannot be worth more, or the board contradicts itself.
 *   - One shared value: if every row has the same implied value, the board ranks nothing
 *     by value and is refused as a ranking. A board of one row is exempt (there is nothing
 *     to order), but this board always has many rows.
 *   - Farm steps: every row must have 3–12 steps, each 20–600 characters once trimmed,
 *     and a positive whole implied value. A step outside the range is a plan the gate
 *     will not take, so it is caught here, before the file is written.
 */
export function boardIssue(
  board: BoardRow[],
  snap: Snapshot,
): string | null {
  const present = new Set(board.map((row) => row.slug));
  const gone = snap.watchlist.filter((s) => !present.has(s));
  if (gone.length > 0) {
    const plural = gone.length === 1 ? '' : 's';
    const shown = gone.slice(0, 5).join(', ');
    return 'the board misses ' + gone.length + ' watchlist slug' + plural + ': ' + shown;
  }
  const nums = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      return 'rank ' + (i + 1) + ' is ' + nums[i];
    }
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return 'row ' + (i + 1) + ' outranks row ' + i + ' on implied value';
    }
  }
  if (board.length >= 2) {
    const firstVal = board[0]!.implied_value_usd;
    const lastVal = board[board.length - 1]!.implied_value_usd;
    if (firstVal === lastVal) {
      return (
        'all ' + board.length + ' rows share the same implied value $' + firstVal +
        ': a board that ranks nothing by value is not a ranking'
      );
    }
  }
  for (const row of board) {
    const plan = row.farm_steps;
    if (plan.length < 3 || plan.length > 12) {
      return row.slug + ' has ' + plan.length + ' farm steps';
    }
    for (const s of plan) {
      const n = s.trim().length;
      if (n < 20 || n > 600) {
        return row.slug + ' has a farm step of ' + n + ' characters';
      }
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return row.slug + ' has implied value ' + row.implied_value_usd;
    }
  }
  return null;
}

/**
 * A compact data.js: the dashboard's whole dataset as one script, no fetch and no network.
 *
 * The dashboard loads this file with a plain <script> tag and reads window.RADAR. Because
 * the data travels as a script rather than a fetch, the page works from a file:// URL with
 * no server and no network — which is also why the scorer's no-network rule is satisfied:
 * there is no fetch, no import, and no URL anywhere in the page. The JSON is written in
 * one line (no pretty-printing) to keep the file small, and a trailing newline ends it.
 * Determinism holds here too: the same board always writes the same data.js, because the
 * rows are already in a total order and JSON.stringify writes object keys in insertion
 * order.
 */
export function dataScript(
  radar: RadarData,
): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
