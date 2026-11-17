/*
 * Steam calculator models (Spritz Consulting).
 * Shared by steam-launch-outlook-calculator.html, steam-sales-forecast-calculator.html
 * and scripts/validate-steam-models.mjs. Pure functions, no DOM access.
 *
 * Every constant carries its source in a comment. Anything marked UNSOURCED is an
 * assumption made by this tool, not a published figure, and is shown as such on the pages.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SteamModels = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Validation status. Updated by `node scripts/validate-steam-models.mjs --write-status`.
  // The pages show a "not yet validated" notice until blindRows >= required.
  var VALIDATION = { blindRows: 0, required: 15 }; // VALIDATION-STATUS-LINE

  // ---------------------------------------------------------------------------
  // Follower to wishlist multiplier profiles
  // ---------------------------------------------------------------------------
  var BUCKETS = {
    // GameDiscoverCo, 21 Jun 2023, survey of 125+ games, per-tag averages (tags with 5+ responses):
    // 4X 7.5x, turn-based strategy 9.0x, survival 9.5x. Six tags in total, small samples.
    deep:   { label: 'Deep / systemic',   low: 7.5, base: 8.5,  high: 9.5,
              source: 'GameDiscoverCo, Jun 2023: 4X 7.5x, turn-based strategy 9.0x, survival 9.5x (6 tags, small samples)' },
    // Same survey: story-rich 13.2x, relaxing 15.7x, puzzle 15.9x.
    casual: { label: 'Casual / narrative', low: 13,  base: 14.5, high: 16,
              source: 'GameDiscoverCo, Jun 2023: story-rich 13.2x, relaxing 15.7x, puzzle 15.9x (6 tags, small samples)' },
    // Same survey: median 12x, average 12.37x, vast majority 7x to 20x (125+ games, unreleased, all sizes).
    unsure: { label: 'Not sure (all-game median)', low: 7, base: 12, high: 20,
              source: 'GameDiscoverCo, Jun 2023: median 12x, 7x to 20x for the vast majority (125+ games, all sizes)' }
  };
  // GameDiscoverCo, 12 May 2026: median 16.1x for games released in the last 12 months with
  // more than 50,000 launch wishlists (biggest outliers removed).
  var BIG_TIER = { minWishlists: 50000, base: 16.1 };
  // GameDiscoverCo, 12 May 2026, 600+ games with more than 50k launch wishlists: the 100 highest-multiplier
  // games converted launch wishlist balance to Month 1 sales at a median 0.22x, the 100 lowest at 0.37x.
  var HIGH_MULT_WARN = 16.1;

  function multiplierProfile(bucket, targetWishlists, override, measuredRatio, spreadPct) {
    var b = BUCKETS[bucket] || BUCKETS.unsure;
    var key = BUCKETS[bucket] ? bucket : 'unsure';
    var low = b.low, base = b.base, high = b.high;
    var notes = [];
    var bigTier = targetWishlists > BIG_TIER.minWishlists;
    if (bigTier) {
      if (key === 'unsure') {
        base = BIG_TIER.base;
        notes.push('big-tier');
      } else {
        notes.push('big-tier-bucket');
      }
    }
    var overridden = false;
    var measured = false;
    // Measured ratio (actual wishlists / followers): replaces the survey bucket, with a symmetric spread.
    // A typed override still wins over it.
    if (measuredRatio && measuredRatio > 0 && !(override && override > 0)) {
      var sp = (spreadPct === undefined || spreadPct === null || !isFinite(spreadPct) ? 25 : spreadPct) / 100;
      measured = true;
      notes = ['measured'];
      base = measuredRatio;
      low = measuredRatio * (1 - Math.min(sp, 0.95));
      high = measuredRatio * (1 + sp);
    }
    if (override && override > 0) {
      overridden = true;
      base = override;
      low = Math.min(low, override);
      high = Math.max(high, override);
    }
    return {
      bucket: key, label: b.label, low: low, base: base, high: high,
      bigTier: bigTier && !measured, overridden: overridden, measured: measured, notes: notes, source: b.source,
      highMultWarning: base > HIGH_MULT_WARN
    };
  }

  // ---------------------------------------------------------------------------
  // Launch Outlook: follower trajectory
  // ---------------------------------------------------------------------------
  // UNSOURCED assumptions. No published source gives follower decay constants or the spread of
  // follower pace; these are visible, adjustable inputs on the page.
  var DEFAULT_ASSUMPTIONS = {
    halfLifeDays: 90,   // UNSOURCED: days for the decaying part of the follower pace to halve
    floorPct: 30,       // UNSOURCED: share of today's pace that persists (does not decay)
    paceLowPct: 50,     // UNSOURCED: low scenario = this share of today's pace
    paceHighPct: 150,   // UNSOURCED: high scenario = this share of today's pace
    burstLowPct: 50,    // UNSOURCED: low scenario realises this share of each planned burst
    burstCapPct: 100,   // UNSOURCED: one burst is capped at this % of followers today...
    burstCapFloor: 1000, // UNSOURCED: ...but never below this many followers
    measuredSpreadPct: 25 // UNSOURCED: floor/ceiling vary a measured wishlist-per-follower ratio by this %
  };
  var RAMP_DAYS = 5;               // each burst ramps in linearly over 5 days (existing behaviour)
  var BURST_TYPES = ['next-fest', 'demo', 'trailer', 'press', 'page-launch', 'custom'];

  function rampedBoost(events, day) {
    var sum = 0;
    for (var i = 0; i < events.length; i++) {
      sum += events[i].boost * Math.max(0, Math.min(1, (day - events[i].day) / RAMP_DAYS));
    }
    return sum;
  }

  function mergeAssumptions(a) {
    var out = {}, k;
    for (k in DEFAULT_ASSUMPTIONS) out[k] = DEFAULT_ASSUMPTIONS[k];
    if (a) for (k in a) if (typeof a[k] === 'number' && isFinite(a[k]) && a[k] >= 0) out[k] = a[k];
    if (out.halfLifeDays < 1) out.halfLifeDays = 1;
    if (out.floorPct > 100) out.floorPct = 100;
    return out;
  }

  /*
   * input: {
   *   current            followers today
   *   daysSinceOpen      days since the Steam page opened (0 if unknown)
   *   daysToLaunch       days from today to launch (negative = launch already passed)
   *   last30             followers gained in the last 30 days, or null/undefined when not entered (0 is a real value)
   *   spikes             [{day (days from today), boost, type}]  past ones have day <= 0
   *   bucket, target, multiplierOverride
   *   measuredWishlists  actual wishlists today (Steamworks); with current followers gives the measured ratio
   *   assumptions        overrides for DEFAULT_ASSUMPTIONS
   * }
   */
  function projectLaunch(input) {
    var A = mergeAssumptions(input.assumptions);
    var current = Math.max(0, input.current || 0);
    var daysSinceOpen = Math.max(0, input.daysSinceOpen || 0);
    var daysToLaunch = input.daysToLaunch || 0;
    var hasLast30 = input.last30 !== null && input.last30 !== undefined && input.last30 !== '' && isFinite(input.last30);
    var last30 = hasLast30 ? Math.max(0, +input.last30) : null;
    var spikes = (input.spikes || []).filter(function (s) { return s && s.boost > 0; });
    var warnings = [];
    var measuredRatio = (input.measuredWishlists > 0 && current > 0) ? input.measuredWishlists / current : 0;
    var profile = multiplierProfile(input.bucket, input.target || 0, input.multiplierOverride, measuredRatio, A.measuredSpreadPct);

    if (daysToLaunch < 0) {
      return { valid: false, reason: 'launch-in-past', profile: profile, warnings: warnings };
    }

    // Past bursts already sit inside `current`. Take them out of the pace so they are not extrapolated.
    var pastRebased = spikes.filter(function (s) { return s.day <= 0; })
      .map(function (s) { return { day: daysSinceOpen + s.day, boost: s.boost }; })
      .filter(function (e) { return e.day >= 0 && e.day <= daysSinceOpen; });
    var pastBoostAll = rampedBoost(pastRebased, daysSinceOpen);
    var pastBoostInWindow = Math.max(0, pastBoostAll - rampedBoost(pastRebased, Math.max(0, daysSinceOpen - 30)));

    var start = Math.max(0, input.startFollowers || 0); // followers on the day the page opened (usually ~0)
    var lifetimePace = daysSinceOpen > 0 ? Math.max(0, current - start - pastBoostAll) / daysSinceOpen : 0;
    var v0, paceSource;
    var burstsRemoved = 0;
    if (hasLast30) {
      paceSource = 'last30';
      burstsRemoved = Math.min(last30, pastBoostInWindow);
      v0 = (last30 - burstsRemoved) / 30;
      if (last30 > current && current > 0) warnings.push('last30-exceeds-current');
      if (last30 === 0) warnings.push('zero-last30');
      if (lifetimePace > 0 && last30 / 30 > 2 * lifetimePace) warnings.push('recent-pace-over-2x');
    } else if (daysSinceOpen > 0) {
      paceSource = 'lifetime';
      v0 = lifetimePace;
      if (daysSinceOpen < 30) warnings.push('young-page');
    } else {
      paceSource = 'none';
      v0 = 0;
      warnings.push('page-opened-today');
    }
    if (daysSinceOpen > 365) warnings.push('old-page');

    // Future bursts, capped.
    var cap = Math.max(A.burstCapFloor, (A.burstCapPct / 100) * current);
    var cappedAny = false, beyondLaunch = 0;
    var bursts = [];
    spikes.forEach(function (s) {
      if (s.day <= 0) return;
      if (s.day > daysToLaunch) { beyondLaunch++; return; }
      var b = s.boost;
      var capped = b > cap;
      if (capped) { b = cap; cappedAny = true; }
      bursts.push({ day: s.day, boost: b, requested: s.boost, capped: capped, type: s.type || 'custom' });
    });
    if (cappedAny) warnings.push('burst-capped');
    if (beyondLaunch) warnings.push('burst-after-launch');

    var tau = A.halfLifeDays / Math.LN2;
    var floor = A.floorPct / 100;
    // Cumulative organic followers over t days for a pace of v0 today:
    // pace(t) = v0 * (floor + (1 - floor) * exp(-t / tau))
    function cumBase(t, v) {
      if (t <= 0) return 0;
      return v * (floor * t + (1 - floor) * tau * (1 - Math.exp(-t / tau)));
    }
    var scen = {
      low:  { pace: A.paceLowPct / 100,  burst: A.burstLowPct / 100, mult: profile.low },
      base: { pace: 1,                   burst: 1,                   mult: profile.base },
      high: { pace: A.paceHighPct / 100, burst: 1,                   mult: profile.high }
    };
    function followersAt(day, which) {
      var s = scen[which || 'base'];
      return current + s.pace * cumBase(day, v0) + s.burst * rampedBoost(bursts, day);
    }
    // With a measured wishlist count, today's wishlists are a fact: the floor/ceiling ratio
    // spread applies only to followers gained from now on, never to the wishlists already earned.
    var measuredWl = profile.measured ? input.measuredWishlists : 0;
    function wishlistsFor(f, mult) {
      return measuredWl ? measuredWl + Math.max(0, f - current) * mult : f * mult;
    }
    var out = {};
    ['low', 'base', 'high'].forEach(function (k) {
      var f = followersAt(daysToLaunch, k);
      out[k] = { followers: f, multiplier: scen[k].mult, wishlists: wishlistsFor(f, scen[k].mult) };
    });
    var organicBase = cumBase(daysToLaunch, v0);
    var burstBase = rampedBoost(bursts, daysToLaunch);
    var growth = organicBase + burstBase;

    return {
      valid: true,
      profile: profile, assumptions: A,
      current: current, daysSinceOpen: daysSinceOpen, daysToLaunch: daysToLaunch,
      paceSource: paceSource, pace: v0, lifetimePace: lifetimePace, burstsRemovedFromPace: burstsRemoved,
      bursts: bursts, burstCap: cap, organicGrowth: organicBase, burstGrowth: burstBase,
      burstShare: growth > 0 ? burstBase / growth : 0,
      scenarios: out, followersAt: followersAt, warnings: warnings,
      measuredWishlists: measuredWl,
      wishlistsToday: measuredWl
        ? { low: measuredWl, base: measuredWl, high: measuredWl }
        : { low: current * profile.low, base: current * profile.base, high: current * profile.high }
    };
  }

  /*
   * Gap-to-target readout from a projectLaunch() result.
   */
  function gapToTarget(res, target) {
    if (!res.valid || !(target > 0)) return null;
    var sc = res.scenarios;
    var base = sc.base.wishlists;
    var position;
    if (target <= sc.low.wishlists) position = 'below-low';
    else if (target <= base) position = 'low-to-base';
    else if (target <= sc.high.wishlists) position = 'base-to-high';
    else position = 'above-high';

    // Followers needed to reach the target. With measured wishlists, only the part of the target
    // above today's count has to come from new followers.
    var mw = res.measuredWishlists || 0;
    var reqBase = mw ? res.current + Math.max(0, target - mw) / sc.base.multiplier : target / sc.base.multiplier;
    var reqLow = mw ? res.current + Math.max(0, target - mw) / sc.low.multiplier : target / sc.low.multiplier;
    var extraBase = Math.max(0, reqBase - sc.base.followers);
    var extraLow = Math.max(0, reqLow - sc.base.followers);
    var weeks = res.daysToLaunch / 7;
    var spread = sc.base.wishlists > 0 ? (sc.high.wishlists - sc.low.wishlists) / (2 * sc.base.wishlists) : 0;
    return {
      target: target,
      low: sc.low.wishlists, base: base, high: sc.high.wishlists,
      gap: base - target,
      position: position,
      requiredFollowersBase: reqBase, requiredFollowersLow: reqLow,
      extraFollowersBase: extraBase, extraFollowersLow: extraLow,
      extraPerWeekBase: weeks > 0 ? extraBase / weeks : (extraBase > 0 ? Infinity : 0),
      currentWeeklyPace: res.pace * 7,
      highToLowRatio: sc.low.wishlists > 0 ? sc.high.wishlists / sc.low.wishlists : Infinity,
      // Never shown below +/-50%: the multiplier range alone is that wide.
      uncertaintyPct: Math.max(50, Math.round(spread * 100))
    };
  }

  // ---------------------------------------------------------------------------
  // Sales Forecast
  // ---------------------------------------------------------------------------
  var SALES = {
    // Week 1 units per launch wishlist, by wishlist tier.
    tiers: [
      { key: 'lt10k',  max: 10000,    rate: 0.20, label: 'under 10,000 wishlists',
        source: 'All-games median 0.2x, GameDiscoverCo Apr 2024 (100+ games). No separate value exists for this tier.' },
      { key: '10to25k', max: 25000,   rate: 0.17, label: '10,000 to 25,000 wishlists',
        source: 'Median 0.17x for launches with >10k wishlists, GameDiscoverCo (2024 poll and Apr 2024 survey).' },
      { key: 'gt25k',  max: Infinity, rate: 0.15, label: '25,000+ wishlists',
        source: 'Median 0.15x for launches with >25k wishlists, GameDiscoverCo Oct 2025 (partly paywalled).' }
    ],
    // GameDiscoverCo Oct 2025: 0.10x median for games priced over $10 (>25k wishlists) against 0.15x overall.
    priceOver10Ratio: 0.10 / 0.15,
    priceRampFrom: 10,  // UNSOURCED shape: no source gives a sub-$10 value or a ramp. Factor is 1 up to $10,
    priceRampTo: 15,    // then falls linearly to the sourced ratio at $15 so there is no jump at $10.
    // GameDiscoverCo 2024 poll: range about 1/10 of the median up to 10x the median. Low case ~0.02 to 0.03x.
    lowRate: 0.025,
    // Gamalytic Apr 2024: Early Access Month 1 about 20% of wishlists vs about 30% for full release: factor ~0.67.
    eaFactor: 0.67,
    // Month 1 / Week 1: 1.23 (Gamalytic, filtered sample 27% / 22%), 1.47 (derived: Zukowski 0.22 / GDC 0.15),
    // base 1.33 (assumption inside that range). GDC's 1.39x is a REVENUE ratio (Month 1 / Week 1 gross revenue).
    monthLow: 1.23, monthBase: 1.33, monthHigh: 1.47, monthRevenueRef: 1.39,
    // Year 1 / Week 1 revenue: median 3.16x, range <2x to >6x (GameDiscoverCo Apr 2024). Revenue ratio applied to units.
    yearOverWeekMedian: 3.16, yearOverWeekLow: 2, yearOverWeekHigh: 6,
    // Zukowski Oct 2026 (160 reader-submitted games): about 0.70 copies per wishlist by end of year one, 2023-25 releases.
    yearPerWishlist: 0.70,
    yearDisagreeRatio: 2,
    // Steam Page Analyzer: Boxleiter reviews x 20 to 60 (genre defaults 30x to 55x, indie 35x), stated accuracy 30 to 50%.
    boxleiterLow: 20, boxleiterHigh: 60, boxleiterMinReviews: 50,
    // Follower check, same buckets as the Launch Outlook.
    big: BIG_TIER
  };

  function tierFor(wishlists) {
    for (var i = 0; i < SALES.tiers.length; i++) if (wishlists < SALES.tiers[i].max) return SALES.tiers[i];
    return SALES.tiers[SALES.tiers.length - 1];
  }
  function priceFactor(price) {
    if (!(price > SALES.priceRampFrom)) return 1;
    if (price >= SALES.priceRampTo) return SALES.priceOver10Ratio;
    var t = (price - SALES.priceRampFrom) / (SALES.priceRampTo - SALES.priceRampFrom);
    return 1 - t * (1 - SALES.priceOver10Ratio);
  }
  // Week 1 conversion (units per wishlist) for these inputs.
  function conversion(wishlists, price, launchType) {
    var tier = tierFor(wishlists);
    var pf = priceFactor(price);
    var ea = launchType === 'ea' ? SALES.eaFactor : 1;
    return { rate: tier.rate * pf * ea, low: SALES.lowRate * pf * ea, tier: tier, priceFactor: pf, eaFactor: ea };
  }

  function forecastSales(input) {
    var wl = Math.max(0, input.wishlists || 0);
    var price = Math.max(0, input.price || 0);
    var conv = conversion(wl, price, input.launchType);
    var week1 = wl * conv.rate;
    var lowCase = wl * conv.low;
    var month1 = { low: week1 * SALES.monthLow, base: week1 * SALES.monthBase, high: week1 * SALES.monthHigh };
    var yearA = week1 * SALES.yearOverWeekMedian;                       // GameDiscoverCo ratio method
    var yearB = wl * SALES.yearPerWishlist * conv.eaFactor;             // Zukowski per-wishlist method
    var lo = Math.min(yearA, yearB), hi = Math.max(yearA, yearB);
    var disagree = lo > 0 && hi / lo > SALES.yearDisagreeRatio;
    return {
      conv: conv, week1: week1, lowCase: lowCase, month1: month1,
      year1: { methodA: yearA, methodB: yearB, low: lo, high: hi, disagree: disagree,
               ratioRange: [week1 * SALES.yearOverWeekLow, week1 * SALES.yearOverWeekHigh] }
    };
  }

  function followerCheck(followers, wishlists, bucket) {
    var b = BUCKETS[bucket] || BUCKETS.unsure;
    var low = followers * b.low, high = followers * b.high;
    return { low: low, high: high, label: b.label, outOfRange: wishlists > 0 && (wishlists < low || wishlists > high) };
  }

  function boxleiter(reviews) {
    return {
      low: reviews * SALES.boxleiterLow, high: reviews * SALES.boxleiterHigh,
      unreliable: reviews < SALES.boxleiterMinReviews
    };
  }

  return {
    VALIDATION: VALIDATION,
    BUCKETS: BUCKETS, BIG_TIER: BIG_TIER, HIGH_MULT_WARN: HIGH_MULT_WARN,
    DEFAULT_ASSUMPTIONS: DEFAULT_ASSUMPTIONS, RAMP_DAYS: RAMP_DAYS, BURST_TYPES: BURST_TYPES,
    multiplierProfile: multiplierProfile, rampedBoost: rampedBoost,
    projectLaunch: projectLaunch, gapToTarget: gapToTarget,
    SALES: SALES, tierFor: tierFor, priceFactor: priceFactor, conversion: conversion,
    forecastSales: forecastSales, followerCheck: followerCheck, boxleiter: boxleiter
  };
});
