// dashboard/model.js — the value model, as the page runs it.
//
// This file is the model the reader sees. It is not a description of the model and not a copy of a
// table: it takes the observations data.js carries and derives every multiple from them, in the
// browser, on the same numbers lib/model.ts used to write board.json. `learnFromObservations` is the
// page's `learnCategoryMultiples`, `medianOf` is the page's `medianOf`, and `impliedOf` is the page's
// `impliedValueFor`. If any of them disagreed with lib/model.ts the detail page would say so, because
// it recomputes each row and compares the result with the number board.json carries.
//
//   multiple   = median(mcap_usd / tvl_usd) over the category's usable observations,
//                or the pooled median when the category has fewer than min_observations of them
//   growth     = clamp(change_7d, growth_floor, growth_cap) per cent; a null change_7d counts as 0
//   growthMult = 1 + (growth / 100) x growth_weight
//   ageMult    = age_floor + min(age_days, age_span_days) / age_span_days x age_range
//   implied    = max(1, round(tvl_usd x multiple x growthMult x ageMult))
//
// There is no protocol name anywhere in this file: one function scores every row, and the only
// inputs are the ten fields the snapshot records.
(function () {
  'use strict';

  /** The median of a list of numbers, or null when it is empty. Even counts take the middle mean. */
  function medianOf(values) {
    if (!values.length) return null;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var mid = s.length >> 1;
    return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /** Round to four decimals: the precision every multiplier is applied at. */
  function round4(n) { return Math.round(n * 1e4) / 1e4; }

  /**
   * Learn the table from the observations: every category's median ratio, and the pooled median that
   * a thin category falls back to. `obs` is { category: [ratio, ...] }, the ratios data.js carries.
   */
  function learnFromObservations(obs, minObs) {
    var keys = Object.keys(obs).sort();
    var pooled = [];
    keys.forEach(function (k) { pooled = pooled.concat(obs[k]); });
    var overall = medianOf(pooled);
    var overallMultiple = round4(overall === null ? 0 : overall);
    var table = {};
    keys.forEach(function (k) {
      var m = medianOf(obs[k]);
      var learned = obs[k].length >= minObs && m !== null;
      table[k] = {
        n: obs[k].length,
        median: m === null ? null : round4(m),
        multiple: learned ? round4(m) : overallMultiple,
        learned: learned
      };
    });
    return { overall: overallMultiple, n: pooled.length, table: table };
  }

  /** The multiple a row is priced at, and where it came from. */
  function multipleFor(learned, category) {
    var key = category || 'Other';
    var stat = learned.table[key];
    if (stat && stat.learned) return { multiple: stat.multiple, source: 'category', observations: stat.n };
    return { multiple: learned.overall, source: 'universe', observations: stat ? stat.n : 0 };
  }

  /**
   * Score one row from its snapshot figures. `params` is DATA.params and `learned` is the table
   * above; nothing else is read, and no name is consulted.
   */
  function impliedOf(row, learned, params, medianAge) {
    var p = params;
    var growth = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    growth = Math.min(p.growth_cap, Math.max(p.growth_floor, growth));
    var growthMult = round4(1 + (growth / 100) * p.growth_weight);
    var age = row.age_days === null || row.age_days === undefined ? medianAge : row.age_days;
    age = Math.min(Math.max(age, 0), p.age_span_days);
    var ageMult = round4(p.age_floor + (age / p.age_span_days) * p.age_range);
    var m = multipleFor(learned, row.category);
    return {
      implied: Math.max(1, Math.round(row.tvl_usd * m.multiple * growthMult * ageMult)),
      multiple: m.multiple,
      multiple_source: m.source,
      category_observations: m.observations,
      growth_pct: growth,
      growth_multiplier: growthMult,
      age_days_used: age,
      age_multiplier: ageMult
    };
  }

  /** Bucket a list of ratios for the distribution the detail page draws. */
  function bucket(values, buckets) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var max = sorted.length ? sorted[sorted.length - 1] : 1;
    var counts = [];
    for (var i = 0; i < buckets; i++) counts.push(0);
    sorted.forEach(function (r) {
      var idx = Math.min(buckets - 1, Math.floor((r / max) * buckets));
      counts[idx]++;
    });
    return { counts: counts, max: max, sorted: sorted };
  }

  window.RadarModel = {
    medianOf: medianOf,
    round4: round4,
    learnFromObservations: learnFromObservations,
    multipleFor: multipleFor,
    impliedOf: impliedOf,
    bucket: bucket
  };
})();
