// Token Radar model (radar-2, "market-anchored"): one sealed snapshot in, one ranked board out.
//
// The starter's house model multiplies TVL by one flat constant for every protocol. This model instead
// asks the snapshot's own market what a token is worth per dollar of TVL, category by category:
//
//   multiple(category) = median(mcap_usd / tvl_usd) over the snapshot's tokenised protocols in that
//                        category (at least 3 samples, else the all-market median), clamped [0.08, 2.5]
//   base               = tvl_usd x multiple(category)
//   growthMult         = the week's TVL change, clamped to [-50, +100] percent, damped both ways
//   maturityMult       = how long the protocol has run with no token recorded: 0.78 at listing day,
//                        rising to 1.20 at three years (an unknown listing day scores a neutral 0.95)
//   reachMult          = +3% per extra chain beyond the first, capped at seven: a wider surface is
//                        more places a launch can reward
//   implied_value_usd  = round(base x growthMult x maturityMult x reachMult), at least $1
//
// No protocol name is ever special-cased: the same function scores every row, and every figure in it
// comes from the snapshot itself. The board ranks pre-token protocols only; protocols whose token
// already trades are carried apart as the live set, at the market's own values, and never ranked.

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

/** The model's version label: the dashboard names it and the board's rows carry its figures. */
export const MODEL_VERSION = 'radar-2';

/** The board's size cap: the watchlist plus the strongest early rows the model finds below it. */
export const BOARD_ROWS = 300;

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The multiple's clamps: below 0.08 the market is pricing a shell, above 2.5 a bridge premium. */
const MULTIPLE_MIN = 0.08;
const MULTIPLE_MAX = 2.5;

/** One row of board.json: the ranked board's row, with the model's working shown. */
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
  tier: 'watchlist' | 'early';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: the row plus its farm plan, verbatim. */
export interface RadarRow extends BoardRow {}

/** A live-token protocol: it already trades, so the dashboard shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
}

/** Everything the dashboard needs: the board, the live set, the multiples table and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  scanned_size: number;
  multiples: { category: string; multiple: number; samples: number }[];
  market_multiple: number;
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

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from the listing day to the snapshot's day; null when either date is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that marks a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Names that open with an exchange's name are that exchange's own product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Categories that are products of a token that already trades, in the watchlist rule's own words:
 * a bridge carries another chain's assets across, a liquid staking product wraps a staked coin, and
 * neither is a protocol still waiting on a launch of its own — WBTC and USDT0 record no token in the
 * snapshot yet sit in Bridge, and ranking them would price Bitcoin's and Tether's launches, not theirs.
 */
const DERIVATIVE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether a pre-token protocol is one the board may rank: not an exchange product, not a versioned
 * pool of another protocol, not a wrapped or staked wrapper, and not in a derivative category.
 * (The watchlist's own rows are always ranked: the gate requires their coverage, rule or no rule.)
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !DERIVATIVE_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const clampMultiple = (n: number): number => Math.min(MULTIPLE_MAX, Math.max(MULTIPLE_MIN, n));

/**
 * The market's own multiples, read off the snapshot: for each category, the median market cap per
 * dollar of TVL among the protocols in it whose token already trades. A category with fewer than
 * three traded samples borrows the all-market median, and so does a protocol with no category.
 */
export function categoryMultiples(snapshot: Snapshot): { table: Map<string, number>; market: number; rows: { category: string; multiple: number; samples: number }[] } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? '(uncategorised)';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const market = clampMultiple(all.length > 0 ? median(all) : 0.25);
  const table = new Map<string, number>();
  const rows: { category: string; multiple: number; samples: number }[] = [];
  for (const [category, samples] of byCategory) {
    const multiple = samples.length >= 3 ? clampMultiple(median(samples)) : market;
    table.set(category, multiple);
    rows.push({ category, multiple: round4(multiple), samples: samples.length });
  }
  rows.sort((a, b) => b.samples - a.samples || (a.category < b.category ? -1 : 1));
  return { table, market, rows };
}

/** One protocol's implied value and the multipliers that produced it, under the market multiples. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  multiples: Map<string, number>,
  marketMultiple: number,
): { implied: number; multiple: number; growthMult: number; maturityMult: number; reachMult: number; age: number | null } {
  const multiple = multiples.get(p.category ?? '(uncategorised)') ?? marketMultiple;
  const age = ageDays(asOf, p.listed_at);
  const growth = Math.min(100, Math.max(-50, p.change_7d ?? 0));
  const growthMult = growth >= 0 ? 1 + 0.55 * (growth / 100) : 1 + 0.75 * (growth / 100);
  const maturityMult = age === null ? 0.95 : 0.78 + 0.42 * (Math.min(age, 1095) / 1095);
  const reachMult = 1 + 0.03 * Math.min(Math.max(p.chains.length - 1, 0), 7);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult * reachMult));
  return { implied, multiple, growthMult, maturityMult, reachMult, age };
}

/** How much capital one farm position needs, from the protocol's own TVL tier. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 300;
  if (tvl >= 250_000_000) return 200;
  if (tvl >= 50_000_000) return 100;
  if (tvl >= 10_000_000) return 50;
  return 25;
}

/** The gas a first transaction costs on a chain, in the words a farmer budgets by. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'mainnet gas of $6 to $15, less on a weekend morning';
  if (chain === 'Solana') return 'fees under $0.05';
  if (['Base', 'Arbitrum', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mantle', 'Mode'].includes(chain)) return 'gas of $0.10 to $0.50';
  return 'gas of about $1';
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's core farming action and its weekly verb, in the words a farmer can follow. */
function playbook(p: SnapshotProtocol, capital: number, chain: string): { core: string; weekly: string; second: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      core: `Supply $${capital} of USDC to ${name} on ${chain}, then borrow about 30% against it once and re-supply the borrow, so both sides of the market see the wallet.`,
      weekly: 'adjust the position once: repay a slice of the borrow or top the supply up by a few dollars',
      second: `Open the second market ${name} lists on ${chain} with a $25 position, so the wallet touches more than one of its pools.`,
    };
  }
  if (c.includes('dex') || c.includes('aggregator')) {
    return {
      core: `Route $${capital} of swaps through ${name} on ${chain} across at least three pairs, then provide $${Math.round(capital / 2)} of liquidity to its deepest stable pool.`,
      weekly: 'make two swaps of $10 or more, in different pairs than last week',
      second: `Claim any fee or points balance ${name} shows for the wallet and restake it in the same pool instead of withdrawing.`,
    };
  }
  if (c.includes('perp') || c.includes('derivative') || c.includes('option')) {
    return {
      core: `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position (long and short the same asset in equal size), so the volume is real and the price risk is near zero.`,
      weekly: 'roll the hedge once: close both legs and reopen them at the current price',
      second: `Post $25 into ${name}'s vault or insurance fund if it offers one, and leave it there.`,
    };
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return {
      core: `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in one app on the far side instead of bridging straight back.`,
      weekly: 'bridge $10 in the other direction, to a chain you have not used this month',
      second: `Repeat the crossing with a second asset (ETH if the first was USDC) at $25, so the wallet is not a one-asset bridge user.`,
    };
  }
  if (c.includes('staking') || c.includes('restak')) {
    return {
      core: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the liquid receipt token in the same wallet, unstaked and unspent.`,
      weekly: 'claim the staking rewards once and restake them, however small they are',
      second: `Use the receipt token once in a money market ${name} names as a partner: supply $25 of it as collateral and borrow nothing.`,
    };
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('vault') || c.includes('allocator') || c.includes('curator')) {
    return {
      core: `Deposit $${capital} into ${name}'s main vault on ${chain} and keep the vault shares in the wallet; do not sell or wrap them elsewhere.`,
      weekly: 'add $10 to the vault, so the position grows instead of sitting still',
      second: `Open a second ${name} vault with $25, in a different asset than the first, if it lists one.`,
    };
  }
  if (c.includes('rwa') || c.includes('stable')) {
    return {
      core: `Mint or deposit $${capital} of ${name}'s yield-bearing asset on ${chain} through its own app and hold the asset in the farming wallet.`,
      weekly: 'mint or deposit another $10, keeping the balance on an upward path',
      second: `Redeem a token $5 slice once and mint it back, so the wallet shows both directions of the flow.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      core: `Fund $${capital} on ${name} and take positions in at least three markets, sized $5 to $15 each, holding each to settlement.`,
      weekly: 'settle one finished market and open one new position',
      second: `Provide $25 of liquidity to one market's book if ${name} allows it, and leave it for a week.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      core: `Buy $${capital} of cover from ${name} on ${chain} for a protocol you actually use, and keep the policy to its expiry.`,
      weekly: 'renew or extend one cover line before it lapses',
      second: `Stake $25 into ${name}'s capital pool if it takes outside capital, and keep the stake locked.`,
    };
  }
  if (c.includes('gaming') || c.includes('nft') || c.includes('social')) {
    return {
      core: `Play or post on ${name} with the farming wallet connected: complete its onboarding, then make the $${capital} of in-app purchases or mints its economy is built around.`,
      weekly: 'finish one session or quest, whatever the app counts as an active day',
      second: `Bring the same wallet to ${name}'s second surface (its marketplace, its mobile app or its second game mode) and act there once.`,
    };
  }
  return {
    core: `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open; if it lists pools, use the deepest one.`,
    weekly: 'make one qualifying action: a deposit, a swap, a vote or a claim, whichever the app counts',
    second: `Open a second, smaller position of $25 in another of ${name}'s pools or markets on ${chain}.`,
  };
}

/** A step kept inside the gate's 20..600 characters whatever a protocol's name does to its length. */
function step(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and log it.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with what it costs and how long it takes, derived
 * from the protocol's own record (category, chains, TVL, age) — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const chain2 = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const book = playbook(p, capital, chain);
  const second =
    chain2 !== null
      ? step(
          `Repeat a smaller position on ${chain2}, the protocol's second chain, from the same wallet, so the farm is not a single-chain footprint.`,
          `$${Math.round(capital / 2)} of capital and ${gasFor(chain2)}`,
          '15 minutes',
        )
      : step(book.second, `about $25 of capital and ${gasFor(chain)}`, '15 minutes');
  return [
    step(
      `Set up a fresh wallet that holds only the funds you plan to farm with, fund it on ${chain}, and keep its seed phrase offline and never in a screenshot.`,
      gasFor(chain),
      '10 minutes',
    ),
    step(book.core, `$${capital} of capital and ${gasFor(chain)}`, '20 minutes to set up'),
    second,
    step(`Every week, ${book.weekly}, so the wallet reads as a returning user and not a one-day airdrop hunter.`, 'about $2 of gas a week', '10 minutes a week'),
    step(
      `Hold every position for at least ${hold} days, so the activity stands in more than one weekly snapshot of the protocol's books.`,
      `the capital stays in the positions`,
      `${hold} days`,
    ),
    step(
      `Watch the exit: claim points or rewards only from links the protocol's own app publishes, keep a farm log of wallet, dates and transactions, and unwind if its TVL falls more than 40% in a week.`,
      'nothing to check, and never pay anyone to claim',
      '10 minutes',
    ),
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n and the model's working shown. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const { table, market } = categoryMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = snapshot.protocols.find((q) => q.slug === slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const byImplied = (a: { v: { implied: number }; p: SnapshotProtocol }, b: { v: { implied: number }; p: SnapshotProtocol }): number =>
    b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0);
  // The watchlist is guaranteed its rows first; the early radar fills the rest of the board by value,
  // so the board's size cap can never cut a watchlist row the gate requires.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .map((p) => ({ p, v: impliedValue(p, snapshot.as_of, table, market) }))
    .sort(byImplied)
    .slice(0, Math.max(0, BOARD_ROWS - chosen.size));
  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, table, market) }));
  scored.push(...early);
  scored.sort(byImplied);
  return scored.map((s, i) => ({
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
    token_status: 'pre-token',
    tier: watch.has(s.p.slug) ? 'watchlist' : 'early',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      category_multiple: round4(s.v.multiple),
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      reach_multiplier: round4(s.v.reachMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live view: the market's own values. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const { rows: multipleRows, market } = categoryMultiples(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => r.tier === 'early').length,
    live_size: live.length,
    scanned_size: snapshot.protocols.length,
    multiples: multipleRows.slice(0, 12),
    market_multiple: round4(market),
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape this model scores. */
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, farm steps, values. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice on the board';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `rank ${i + 1} is ${board[i]!.rank}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
