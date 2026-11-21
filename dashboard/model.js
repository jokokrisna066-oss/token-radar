// dashboard/model.js — the value model, as the page runs it.
//
// Not a description of the model and not a table of answers: it derives everything from the
// observations data.js carries, in the browser. fitCurve is the least-squares fit, curveRatio the
// implied multiple, leaveOneOut the test the model is chosen by, oddsOf the token rate, variants the
// comparison the page prints. If any disagreed with lib/model.ts the detail page would say so.
//
//   ratio(tvl) = exp(a + b x log(tvl))   implied = tvl x ratio(tvl)   expected = implied x odds
//
// No protocol name is anywhere in this file: one function scores every row.
(function () {
  'use strict';

  /** The median of a list of numbers, or null when empty. Even counts take the middle mean. */
  function medianOf(values) {
    if (!values.length) return null;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var mid = s.length >> 1;
    return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function round4(n) { return Math.round(n * 1e4) / 1e4; }
  function round6(n) { return Math.round(n * 1e6) / 1e6; }

  /** Least squares of log(ratio) on log(tvl); r2 and sd in log units. `term` is an optional
   * multiplier divided out of the target first, which is how growth and age are tested. */
  function fitCurve(obs, term) {
    var n = obs.length;
    if (n < 3) return null;
    var t = function (o) { return term === null || term === undefined ? 0 : Math.log(term(o)); };
    var sx = 0, sy = 0, i;
    for (i = 0; i < n; i++) { sx += Math.log(obs[i].tvl); sy += Math.log(obs[i].ratio) - t(obs[i]); }
    var mx = sx / n, my = sy / n, sxy = 0, sxx = 0, syy = 0;
    for (i = 0; i < n; i++) {
      var dx = Math.log(obs[i].tvl) - mx, dy = Math.log(obs[i].ratio) - t(obs[i]) - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx === 0) return null;
    var b = sxy / sxx, a = my - b * mx, sse = 0;
    for (i = 0; i < n; i++) {
      var e = Math.log(obs[i].ratio) - t(obs[i]) - (a + b * Math.log(obs[i].tvl));
      sse += e * e;
    }
    return { a: a, b: b, r2: syy === 0 ? 0 : round4(1 - sse / syy), sd: round4(Math.sqrt(sse / (n - 2))), n: n };
  }

  /** The multiple the curve implies for a protocol of this TVL. */
  function curveRatio(fit, tvl) {
    return fit === null ? 0 : Math.exp(fit.a + fit.b * Math.log(tvl));
  }

  /** The implied value: TVL times the curve's multiple at that TVL. */
  function impliedOf(row, fit) {
    return Math.max(1, Math.round(row.tvl_usd * curveRatio(fit, row.tvl_usd)));
  }

  /** The test the model is chosen by: each observation held out, the curve refitted without it, and
   * its error taken in log units — against the curve, and against the median of the rest. */
  function leaveOneOut(obs) {
    var curve = [], konst = [], wins = 0;
    for (var i = 0; i < obs.length; i++) {
      var rest = obs.slice(0, i).concat(obs.slice(i + 1));
      var f = fitCurve(rest);
      var y = Math.log(obs[i].ratio);
      if (f === null) continue;
      var pc = f.a + f.b * Math.log(obs[i].tvl);
      var pk = medianOf(rest.map(function (o) { return Math.log(o.ratio); }));
      var ec = Math.abs(y - pc), ek = Math.abs(y - pk);
      curve.push(ec); konst.push(ek);
      if (ec < ek - 1e-12) wins++;
    }
    var mean = function (v) { return v.length ? v.reduce(function (x, y2) { return x + y2; }, 0) / v.length : 0; };
    return { n: curve.length, curve: round4(medianOf(curve)), constant: round4(medianOf(konst)), curveMean: round4(mean(curve)), constantMean: round4(mean(konst)), wins: wins };
  }

  /** The age bucket: how long the protocol has run with no token on record. */
  function ageBucket(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 90) return '<90d';
    if (days < 365) return '90-365d';
    if (days < 730) return '1-2y';
    if (days < 1095) return '2-3y';
    return '>3y';
  }

  function logit(x) { return Math.log(x / (1 - x)); }
  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  /** How likely this record is to carry a token: the base rate moved by two buckets, age and
   * category, each in log-odds and each weighted by its own evidence. */
  function oddsOf(row, odds) {
    var base = odds.base <= 0 || odds.base >= 1 ? 0.5 : odds.base;
    function lift(table, key) {
      for (var i = 0; i < table.length; i++) {
        if (table[i].bucket !== key) continue;
        var n = table[i].n;
        if (!n) return 0;
        var r = (table[i].hits + 0.5) / (n + 1);
        return (logit(r) - logit(base)) * (n / (n + odds.prior));
      }
      return 0;
    }
    return round4(sigmoid(logit(base) + lift(odds.by_age, ageBucket(row.age_days)) + lift(odds.by_category, row.category || 'Other')));
  }

  /** Everything a row's implied value is made of. */
  function valuationOf(row, fit, odds) {
    var multiple = round6(curveRatio(fit, row.tvl_usd));
    var implied = impliedOf(row, fit);
    var chance = oddsOf(row, odds);
    return { implied: implied, multiple: multiple, odds: chance, expected: Math.round(implied * chance) };
  }

  /** The comparison the page prints: the curve against one constant, and with growth and with age
   * added back in — each divided out of the target before the refit. */
  function variants(obs) {
    var base = leaveOneOut(obs);
    var terms = [
      { name: 'the size curve, nothing else', term: null },
      { name: 'the curve, with a growth term', term: function (o) { return 1 + (Math.min(120, Math.max(-60, o.change_7d === null ? 0 : o.change_7d)) / 100) * 0.5; } },
      { name: 'the curve, with an age term', term: function (o) { var d = Math.min(Math.max(o.age_days === null ? 730 : o.age_days, 0), 1460); return 0.75 + (d / 1460) * 0.25; } }
    ];
    var table = [{ name: 'one constant for every protocol', med: base.constant, wins: 0 }];
    terms.forEach(function (t) {
      var errs = [], wins = 0;
      for (var i = 0; i < obs.length; i++) {
        var rest = obs.slice(0, i).concat(obs.slice(i + 1));
        var f2 = fitCurve(rest, t.term);
        if (f2 === null) continue;
        var y = Math.log(obs[i].ratio) - (t.term === null ? 0 : Math.log(t.term(obs[i])));
        var pc = Math.abs(y - (f2.a + f2.b * Math.log(obs[i].tvl)));
        var pk = Math.abs(Math.log(obs[i].ratio) - medianOf(rest.map(function (o) { return Math.log(o.ratio); })));
        errs.push(pc);
        if (pc < pk - 1e-12) wins++;
      }
      table.push({ name: t.name, med: round4(medianOf(errs)), wins: wins, n: errs.length });
    });
    return { base: base, curve: fitCurve(obs), table: table, obs: obs.length };
  }

  window.RadarModel = {
    medianOf: medianOf,
    round4: round4,
    round6: round6,
    fitCurve: fitCurve,
    curveRatio: curveRatio,
    impliedOf: impliedOf,
    valuationOf: valuationOf,
    leaveOneOut: leaveOneOut,
    variants: variants,
    ageBucket: ageBucket,
    oddsOf: oddsOf
  };
})();
