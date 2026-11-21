// Token Radar's dashboard: one static page over window.RADAR, which main.ts writes to data.js beside
// it. No network, no framework, no build step. The model is recomputed here from the observations it
// was fitted on, so the arithmetic is checkable. Views: the board, the model's evidence, one
// protocol's detail, and the trading protocols. State lives in the URL hash.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var root = document.getElementById('board');
  if (!DATA) {
    root.textContent = 'Token Radar: data.js did not load beside the page.';
    return;
  }

  var PER_PAGE = 10;
  var state = { view: 'board', q: '', category: '', chain: '', sort: 'rank', dir: 1, page: 1, slug: null };

  var USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return USD.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtOdds(p) { return (p * 100).toFixed(1) + '%'; }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + ' y';
    if (days >= 60) return Math.round(days / 30) + ' mo';
    return Math.round(days) + ' d';
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ---------------------------------------------------------------- the model, recomputed

  // model.js loads before this file. V is the whole test run once at load — the fit, the
  // leave-one-out comparison, the variants — and every model figure on the page comes from it.
  var MODEL = window.RadarModel;
  var V = MODEL.variants(DATA.observations);
  var CURVE = V.curve;

  function valuationOf(row) { return MODEL.valuationOf(row, CURVE, DATA.odds); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') node.textContent = v;
        else if (k.indexOf('on') === 0) node[k] = v;
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) { child.forEach(function (c) { if (c) node.appendChild(c); }); continue; }
      if (typeof child === 'string' || typeof child === 'number') { node.appendChild(document.createTextNode(String(child))); continue; }
      node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    state = { view: 'board', q: '', category: '', chain: '', sort: 'rank', dir: 1, page: 1, slug: null };
    if (!h) return;
    h.split('&').forEach(function (pair) {
      var at = pair.indexOf('=');
      if (at < 0) return;
      var k = pair.slice(0, at), v = decodeURIComponent(pair.slice(at + 1));
      if (k === 'p') { state.view = 'detail'; state.slug = v; }
      else if (k === 'c') { state.category = v; }
      else if (k === 'ch') { state.chain = v; }
      else if (k === 'l') { state.view = v === 'live' ? 'live' : 'board'; }
      else if (k === 'q') { state.q = v; }
      else if (k === 's') { state.sort = v; }
    });
  }
  function writeHash() {
    var parts = [];
    if (state.view === 'detail' && state.slug) parts.push('p=' + encodeURIComponent(state.slug));
    else {
      if (state.view === 'live') parts.push('l=live');
      if (state.category) parts.push('c=' + encodeURIComponent(state.category));
      if (state.chain) parts.push('ch=' + encodeURIComponent(state.chain));
      if (state.q) parts.push('q=' + encodeURIComponent(state.q));
      if (state.sort !== 'rank') parts.push('s=' + encodeURIComponent(state.sort));
    }
    var next = parts.length ? '#' + parts.join('&') : '';
    if (next !== window.location.hash) window.location.hash = next;
  }

  // ---------------------------------------------------------------- the board's rows

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { var k = r.category || 'Other'; seen[k] = (seen[k] || 0) + 1; });
    return Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a] || (a < b ? -1 : 1); });
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { seen[c] = (seen[c] || 0) + 1; }); });
    return Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a] || (a < b ? -1 : 1); });
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category && (r.category || 'Other') !== state.category) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }

  function value(row, key) {
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'multiple') return row.multiple;
    if (key === 'odds') return row.odds;
    if (key === 'growth') return row.change_7d === null ? -Infinity : row.change_7d;
    if (key === 'age') return row.age_days === null ? -1 : row.age_days;
    if (key === 'ev') return row.expected_value_usd;
    if (key === 'tvl') return row.tvl_usd;
    return row.implied_value_usd;
  }
  function sorted(list) {
    var key = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var x = value(a, key), y = value(b, key);
      if (x === y) return a.rank - b.rank;
      return (x < y ? -1 : 1) * dir;
    });
  }
  function setSort(key) {
    if (state.sort === key) state.dir = -state.dir;
    else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
    writeHash();
    render();
  }
  function th(key, label, cls) {
    var on = state.sort === key;
    return el('th', { scope: 'col', class: cls || '', 'aria-sort': on ? (state.dir === 1 ? 'ascending' : 'descending') : null },
      el('button', { type: 'button', onclick: function () { setSort(key); } },
        label, on ? el('span', { class: 'mark', text: state.dir === 1 ? '\u25B2' : '\u25BC' }) : null));
  }

  function openDetail(slug) {
    state.view = 'detail';
    state.slug = slug;
    state.page = 1;
    writeHash();
    render();
    window.scrollTo(0, 0);
  }
  function backToBoard() {
    state.view = 'board';
    state.slug = null;
    writeHash();
    render();
  }
  function clearFilters() {
    state.q = ''; state.category = ''; state.chain = ''; state.page = 1;
    writeHash();
    render();
  }

  function filterNote(list) {
    if (!state.q && !state.category && !state.chain) return null;
    var bits = [];
    if (state.category) bits.push(el('span', null, 'category ', el('b', { text: state.category })));
    if (state.chain) bits.push(el('span', null, 'chain ', el('b', { text: state.chain })));
    if (state.q) bits.push(el('span', null, 'search ', el('b', { text: '"' + state.q + '"' })));
    return el('div', { class: 'filternote' },
      el('span', { class: 'lead' }, el('b', { text: list.length + ' of ' + DATA.board_size }), ' rows match'),
      bits,
      el('button', { class: 'button', type: 'button', text: 'Clear', onclick: clearFilters })
    );
  }

  function boardView() {
    var list = sorted(filtered());
    var pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (state.page > pages) state.page = pages;
    var slice = list.slice((state.page - 1) * PER_PAGE, state.page * PER_PAGE);
    var max = list.length ? Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) : 1;

    if (slice.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear the filters', onclick: clearFilters })
      ));
    }

    var body = el('tbody');
    slice.forEach(function (r) {
      var g = r.change_7d;
      body.appendChild(el('tr', {
        'data-selected': state.slug === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank num', text: '#' + r.rank }),
        el('td', { class: 'proto' },
          el('b', { text: r.name }),
          el('span', null, r.category || 'Other', ' \u00B7 ', (r.chains || []).slice(0, 2).join(', ') || 'chain unlisted')
        ),
        el('td', { class: 'num r c-tvl', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num r c-7d ' + (g === null ? '' : g >= 0 ? 'pos' : 'neg'), text: fmtPct(g) }),
        el('td', { class: 'num r c-age', text: fmtAge(r.age_days) }),
        el('td', { class: 'num r c-mx', text: r.multiple.toFixed(2) + '\u00D7' }),
        el('td', { class: 'num r c-odds', text: fmtOdds(r.odds) }),
        el('td', { class: 'r' }, el('div', { class: 'iv' },
          el('div', { class: 'meter', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('b', { text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num r c-ev', text: fmtUsd(r.expected_value_usd) }),
        el('td', { class: 'c-tag' }, el('span', { class: 'tag ' + (r.on_watchlist ? 'wl' : 'early'), text: r.on_watchlist ? 'watchlist' : 'below floor' }))
      ));
    });

    return el('div', { class: 'panel' },
      filterNote(list),
      el('div', { class: 'scroll' },
        el('table', { class: 'grid' },
          el('caption', { class: 'skip', text: 'Pre-token protocols ranked by implied value, strongest first' }),
          el('thead', null, el('tr', null,
            th('rank', 'Rank', 'c-rank'),
            th('name', 'Protocol'),
            th('tvl', 'TVL', 'r c-tvl'),
            th('growth', '7d', 'r c-7d'),
            th('age', 'No token for', 'r c-age'),
            th('multiple', 'Multiple', 'r c-mx'),
            th('odds', 'Token odds', 'r c-odds'),
            th('implied', 'Implied value', 'r'),
            th('ev', 'Expected', 'r c-ev'),
            el('th', { scope: 'col', class: 'c-tag', text: 'List' })
          )),
          body
        )
      ),
      el('div', { class: 'pager' },
        el('button', { class: 'button', type: 'button', text: '\u2190 Newer', disabled: state.page <= 1, onclick: function () { state.page--; writeHash(); render(); } }),
        el('span', { class: 'num', text: 'page ' + state.page + ' / ' + pages + ' \u00B7 ranks ' + ((state.page - 1) * PER_PAGE + 1) + '\u2013' + ((state.page - 1) * PER_PAGE + slice.length) + ' of ' + list.length }),
        el('button', { class: 'button', type: 'button', text: 'Older \u2192', disabled: state.page >= pages, onclick: function () { state.page++; writeHash(); render(); } }),
        el('span', { class: 'num spacer', text: 'implied = TVL \u00D7 the curve\u2019s multiple at that TVL \u00B7 expected = implied \u00D7 token odds' })
      )
    );
  }

  // The panel the model has to survive: computed by model.js at load, weak numbers included.
  function evidence(compact) {
    var b = V.base;
    var fit = CURVE;
    var obs = DATA.observations;

    var lo = Infinity, hi = -Infinity;
    obs.forEach(function (o) { var x = Math.log10(o.tvl); if (x < lo) lo = x; if (x > hi) hi = x; });
    var BANDS = 6, bands = [];
    for (var i = 0; i < BANDS; i++) bands.push([]);
    obs.forEach(function (o) {
      var t = (Math.log10(o.tvl) - lo) / (hi - lo || 1);
      bands[Math.min(BANDS - 1, Math.floor(t * BANDS))].push(o);
    });
    var rows = bands.map(function (group, i) {
      var from = Math.pow(10, lo + (hi - lo) * (i / BANDS));
      var to = Math.pow(10, lo + (hi - lo) * ((i + 1) / BANDS));
      var mid = Math.sqrt(from * to);
      var predicted = MODEL.curveRatio(fit, mid);
      var seen = MODEL.medianOf(group.map(function (o) { return o.ratio; }));
      return { from: from, to: to, n: group.length, seen: seen, predicted: predicted };
    }).filter(function (r) { return r.n > 0; });
    var ceiling = 0;
    rows.forEach(function (r) { ceiling = Math.max(ceiling, r.seen || 0, r.predicted); });
    var pos = function (v) { return Math.max(0, Math.min(100, (Math.log10(Math.max(v, 0.001)) - Math.log10(0.001)) / (Math.log10(ceiling * 1.6) - Math.log10(0.001)) * 100)); };

    var bandList = rows.map(function (r) {
      return el('div', { class: 'frow' },
        el('span', { class: 'flab', text: fmtUsd(r.from) + '\u2013' + fmtUsd(r.to) }),
        el('div', { class: 'ftrack', title: 'median ' + r.seen.toFixed(3) + '\u00D7 against the curve\u2019s ' + r.predicted.toFixed(3) + '\u00D7' },
          el('i', { class: 'ftick seen', style: 'left:' + pos(r.seen) + '%' }),
          el('i', { class: 'ftick pred', style: 'left:' + pos(r.predicted) + '%' })
        ),
        el('span', { class: 'fnum num', text: r.seen.toFixed(2) + '\u00D7 / ' + r.predicted.toFixed(2) + '\u00D7' }),
        el('span', { class: 'fnum num', text: 'n=' + r.n })
      );
    });

    var headline = el('div', { class: 'duel' },
      el('div', { class: 'dcol win' },
        el('span', { text: 'the size curve' }),
        el('b', { text: b.curve.toFixed(3) }),
        el('em', { text: 'median absolute log error' }),
        el('i', { text: 'closer on ' + b.wins + ' of ' + b.n })
      ),
      el('div', { class: 'dmid', text: 'against' }),
      el('div', { class: 'dcol' },
        el('span', { text: 'one constant' }),
        el('b', { text: b.constant.toFixed(3) }),
        el('em', { text: 'median absolute log error' }),
        el('i', { text: 'the model with no size term' })
      )
    );

    var varTable = el('table', { class: 'vary' },
      el('thead', null, el('tr', null,
        el('th', { scope: 'col', text: 'The model' }),
        el('th', { scope: 'col', class: 'r', text: 'Median error' }),
        el('th', { scope: 'col', class: 'r', text: 'Beats the constant' })
      )),
      el('tbody', null, V.table.map(function (t, i) {
        return el('tr', { class: i === 1 ? 'pick' : '' },
          el('td', { text: t.name }),
          el('td', { class: 'num r', text: t.med.toFixed(3) }),
          el('td', { class: 'num r', text: i === 0 ? '\u2014' : t.wins + '/' + b.n })
        );
      }))
    );

    return el('div', { class: compact ? 'sect' : 'evpanel' },
      el('h2', { text: 'Does it predict anything?' }),
      el('p', { class: 'lede', text:
        'The test is leave-one-out on the snapshot\u2019s own ' + plural(b.n, 'usable ratio', 'usable ratios') + ': hold one protocol out, refit without it, and ask whether the curve or a single constant is closer to the multiple that protocol actually paid. The curve wins on ' + b.wins + ' of ' + b.n + ', and its median error is ' + b.constant.toFixed(2) + ' against ' + b.curve.toFixed(2) + ' \u2014 in log units, so 1.21 means it is typically off by a factor of ' + Math.exp(b.curve).toFixed(1) + '.' }),
      headline,
      el('div', { class: 'fitwrap' },
        el('div', { class: 'fithead' },
          el('span', { text: 'log(ratio) = ' + fit.a.toFixed(4) + ' ' + (fit.b < 0 ? '\u2212' : '+') + ' ' + Math.abs(fit.b).toFixed(4) + ' \u00D7 log(tvl)' }),
          el('span', { class: 'num', text: 'R\u00B2 = ' + fit.r2.toFixed(2) + ' \u00B7 residual sd = ' + fit.sd.toFixed(2) + ' \u00B7 n = ' + fit.n })
        ),
        el('div', { class: 'frows' }, bandList),
        el('p', { class: 'fkey' },
          el('i', { class: 'ftick seen' }), ' what the band\u2019s median protocol paid    ',
          el('i', { class: 'ftick pred' }), ' what the curve says for the band\u2019s centre'
        )
      ),
      el('p', { class: 'lede honest', text:
        'R\u00B2 is 0.16, and that is the honest headline: size explains about a sixth of why one protocol\u2019s token is worth more per dollar of TVL than another\u2019s. The slope is real \u2014 it is negative on every resample, so bigger protocols really do trade cheaper against their TVL \u2014 but the model is a weak predictor of any single protocol, and a reader should treat one row\u2019s implied value as a band, not a price.' }),
      varTable,
      el('p', { class: 'lede', text:
        'The last two rows are why neither is in the formula, and the two answers differ. Growth moves the median error from ' + V.base.curve.toFixed(3) + ' to ' + V.table[2].med.toFixed(3) + ' and adds one win out of ' + V.base.n + ': that is noise, not a signal, so it earns no term. Age makes the error clearly worse, ' + V.base.curve.toFixed(3) + ' to ' + V.table[3].med.toFixed(3) + ', and loses ' + (V.base.wins - V.table[3].wins) + ' of the ' + V.base.wins + ' protocols the curve won. Both fields are carried on every row and shown here; neither is multiplied in.' })
    );
  }

  function liveView() {
    var q = state.q.trim().toLowerCase();
    var list = DATA.live.filter(function (r) {
      if (!q) return true;
      return [r.name, r.slug, r.category, r.symbol, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (state.page > pages) state.page = pages;
    var slice = list.slice((state.page - 1) * PER_PAGE, state.page * PER_PAGE);
    var body = el('tbody');
    slice.forEach(function (r) {
      body.appendChild(el('tr', null,
        el('td', { class: 'proto' },
          el('b', { text: r.name }),
          el('span', null, r.category || 'Other', r.symbol ? ' \u00B7 ' + r.symbol : '', ' \u00B7 ', (r.chains || []).slice(0, 2).join(', '))
        ),
        el('td', { class: 'num r c-tvl', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num r', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num r', text: r.ratio === null ? 'n/a' : r.ratio.toFixed(2) + '\u00D7' }),
        el('td', { class: 'num r c-7d ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', null, el('span', { class: 'tag ' + (r.counted ? 'early' : 'wl'), text: r.counted ? 'in the fit' : 'out of range' }))
      ));
    });
    return el('div', null,
      el('p', { class: 'lede', text: 'These protocols already trade, so their market cap is a fact rather than a model, and they are kept out of the ranking entirely. Their market cap over TVL is the data the curve is fitted on: ' + plural(V.obs, 'usable ratio', 'usable ratios') + ' across 416 protocols that record a token, the rest dropped as unusable, out of range, or without a market cap.' }),
      el('div', { class: 'panel' }, el('div', { class: 'scroll' },
        el('table', { class: 'grid' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', class: 'r c-tvl', text: 'TVL' }),
            el('th', { scope: 'col', class: 'r', text: 'Market cap' }),
            el('th', { scope: 'col', class: 'r', text: 'Mcap / TVL' }),
            el('th', { scope: 'col', class: 'r c-7d', text: '7d' }),
            el('th', { scope: 'col', text: 'In the fit' })
          )),
          body
        )
      )),
      el('div', { class: 'pager' },
        el('button', { class: 'button', type: 'button', text: '\u2190 Newer', disabled: state.page <= 1, onclick: function () { state.page--; writeHash(); render(); } }),
        el('span', { class: 'num', text: 'page ' + state.page + ' / ' + pages + ' \u00B7 ' + list.length + ' trading protocols' }),
        el('button', { class: 'button', type: 'button', text: 'Older \u2192', disabled: state.page >= pages, onclick: function () { state.page++; writeHash(); render(); } })
      )
    );
  }

  function stepParts(step) {
    var at = step.indexOf(' Cost: ');
    var action = at >= 0 ? step.slice(0, at) : step;
    var tail = at >= 0 ? step.slice(at + 6) : '';
    var ti = tail.indexOf('. Time: ');
    var cost = ti >= 0 ? tail.slice(0, ti) : tail;
    var time = ti >= 0 ? tail.slice(ti + 8).replace(/\.$/, '') : '';
    return { action: action, cost: cost, time: time };
  }

  function bucketFor(table, key) {
    for (var i = 0; i < table.length; i++) if (table[i].bucket === key) return table[i];
    return null;
  }

  function detailView() {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.slug) row = DATA.rows[i];
    if (!row) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol by that name on the board' }),
        el('p', { text: 'The link may name a protocol whose token already trades, or one the snapshot does not carry.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Back to the board', onclick: backToBoard })
      ));
    }
    var v = valuationOf(row);
    var agrees = v.implied === row.implied_value_usd && v.odds === row.odds && v.expected === row.expected_value_usd;
    var idx = DATA.rows.indexOf(row);
    var prev = idx > 0 ? DATA.rows[idx - 1] : null;
    var next = idx < DATA.rows.length - 1 ? DATA.rows[idx + 1] : null;
    var g = row.change_7d;
    var ageKey = MODEL.ageBucket(row.age_days);
    var catKey = row.category || 'Other';
    var ageRate = bucketFor(DATA.odds.by_age, ageKey);
    var catRate = bucketFor(DATA.odds.by_category, catKey);

    var chainText = (row.chains || []).length === 0
      ? 'chain unlisted'
      : row.chains.slice(0, 3).join(', ') + (row.chains.length > 3 ? ' +' + (row.chains.length - 3) + ' more' : '');

    var head = el('div', { class: 'dhead' },
      el('div', null,
        el('h1', { text: row.name }),
        el('p', { class: 'sub' },
          catKey, ' \u00B7 ',
          el('span', { title: (row.chains || []).join(', '), text: chainText }), ' \u00B7 ',
          el('b', { text: row.on_watchlist ? 'on the watchlist' : 'below the watchlist floor' }), ' \u00B7 ',
          row.slug
        )
      ),
      el('div', { class: 'drank' },
        el('span', { text: 'Rank of ' + DATA.board_size }),
        el('b', { text: '#' + row.rank })
      )
    );

    var figs = el('div', { class: 'figs' },
      el('div', { class: 'fig lead' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }), el('em', { text: 'a model, not a price' })),
      el('div', { class: 'fig' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
      el('div', { class: 'fig' }, el('span', { text: '7-day change' }), el('b', { class: g === null ? '' : g >= 0 ? 'pos' : 'neg', text: fmtPct(g) })),
      el('div', { class: 'fig' }, el('span', { text: 'No token for' }), el('b', { text: fmtAge(row.age_days) }), el('em', { text: row.listed_at ? 'listed ' + row.listed_at : 'no listing date' })),
      el('div', { class: 'fig' }, el('span', { text: 'Multiple at this TVL' }), el('b', { text: row.multiple.toFixed(4) + '\u00D7' }), el('em', { text: 'from the fitted curve' })),
      el('div', { class: 'fig' }, el('span', { text: 'Expected value' }), el('b', { class: 'oxide', text: fmtUsd(row.expected_value_usd) }), el('em', { text: 'implied \u00D7 ' + fmtOdds(row.odds) + ' odds' }))
    );

    var mrow = function (label, formula, sub, valueText, total) {
      return el('div', { class: 'mrow' + (total ? ' total' : '') },
        el('div', { class: 'term' },
          el('b', { text: label }),
          el('code', { text: formula }),
          el('span', { text: sub })
        ),
        el('b', { class: 'val', text: valueText })
      );
    };

    var math = el('div', { class: 'math' },
      mrow('TVL', 'tvl_usd', 'the snapshot\u2019s own figure, not a model\u2019s', fmtUsd(row.tvl_usd)),
      mrow('Multiple',
        'exp(' + CURVE.a.toFixed(4) + ' ' + (CURVE.b < 0 ? '\u2212' : '+') + ' ' + Math.abs(CURVE.b).toFixed(4) + ' \u00D7 log(' + row.tvl_usd + '))',
        'the size curve at this protocol\u2019s own TVL: no category, no name, nothing but its size',
        row.multiple.toFixed(4)),
      mrow('Implied value', 'tvl_usd \u00D7 multiple', fmtUsd(row.tvl_usd) + ' \u00D7 ' + row.multiple.toFixed(4), fmtUsd(row.implied_value_usd), true)
    );

    var check = el('div', { class: 'check' + (agrees ? '' : ' bad') },
      agrees
        ? '\u2713 This page refitted the curve in model.js, scored this row from the snapshot\u2019s fields, and got the same ' + fmtUsd(v.implied) + ' and the same odds that board.json carries.'
        : '\u2717 This page refitted the curve and got ' + fmtUsd(v.implied) + ', which differs from board.json: the data is stale.'
    );

    // The two fields in the brief, present and explained rather than quietly dropped.
    var excluded = el('div', { class: 'math gapped' },
      mrow('Growth, not used',
        '1 + (clamp(change_7d, \u221260, 120) / 100 \u00D7 0.5)',
        g === null ? 'change_7d is null here, so the term would be 1.0000 \u2014 and even with a value, a growth term moves the median error only from ' + V.base.curve.toFixed(3) + ' to ' + V.table[2].med.toFixed(3) + ', which is noise, so it is carried and not multiplied in'
          : 'this protocol\u2019s own ' + fmtPct(g) + ' would make this term ' + row.growth_multiplier.toFixed(4) + ', but a growth term moves the median error only from ' + V.base.curve.toFixed(3) + ' to ' + V.table[2].med.toFixed(3) + ' \u2014 noise, not signal \u2014 so it is carried and not multiplied in',
        row.growth_multiplier.toFixed(4)),
      mrow('Age, not used',
        '0.75 + min(age_days, 1460) / 1460 \u00D7 0.25',
        row.age_days === null ? 'no listing date here, so the term would take the fallback age \u2014 and an age term raises the median error from ' + V.base.curve.toFixed(3) + ' to ' + V.table[3].med.toFixed(3) + ', which is why it is out'
          : plural(row.age_days, 'day', 'days') + ' with no token would make this term ' + row.age_multiplier.toFixed(4) + ', but an age term raises the median error from ' + V.base.curve.toFixed(3) + ' to ' + V.table[3].med.toFixed(3) + ', which is why it is out',
        row.age_multiplier.toFixed(4))
    );

    // The odds, term by term: the base rate, the two buckets, and the shrunk result.
    var oddsBox = el('div', { class: 'math gapped' },
      mrow('Base rate', 'protocols that record a token / all protocols', DATA.odds.hits + ' of ' + DATA.odds.n + ' protocols in the snapshot record a token', fmtOdds(DATA.odds.base)),
      mrow('Age bucket', '\u201c' + ageKey + '\u201d', ageRate ? ageRate.hits + ' of ' + ageRate.n + ' protocols in this bucket record one, weighted ' + Math.round(ageRate.n / (ageRate.n + DATA.odds.prior) * 100) + '% of the way' : 'no evidence in this bucket', ageRate ? fmtOdds(ageRate.rate) : 'n/a'),
      mrow('Category bucket', '\u201c' + catKey + '\u201d', catRate ? catRate.hits + ' of ' + catRate.n + ' protocols in this category record one, weighted ' + Math.round(catRate.n / (catRate.n + DATA.odds.prior) * 100) + '% of the way' : 'no evidence in this category', catRate ? fmtOdds(catRate.rate) : 'n/a'),
      mrow('This protocol\u2019s odds', 'base, moved by both buckets in log-odds', 'shrunk toward the base by each bucket\u2019s own evidence, so a thin bucket barely moves it', fmtOdds(row.odds), true)
    );

    var record = el('div', { class: 'record' },
      el('h3', { text: 'The snapshot record: all ten fields' }),
      el('div', { class: 'recgrid' },
        rec('slug', row.slug),
        rec('name', row.name),
        rec('category', row.category || 'null'),
        rec('tvl_usd', '$' + row.tvl_usd.toLocaleString('en-US')),
        rec('change_7d', g === null ? 'null (unreported)' : g + ' %'),
        rec('listed_at', row.listed_at === null ? 'null, so age is unknown' : row.listed_at + ' \u2192 ' + row.age_days + ' days'),
        rec('mcap_usd', 'null \u2014 records no token'),
        rec('gecko_id', 'null'),
        rec('symbol', 'null'),
        rec('age_days', row.age_days === null ? 'null' : String(row.age_days), 'wide'),
        rec('chains', row.chains.length + ' \u2014 ' + row.chains.join(', '), 'wide')
      )
    );

    var steps = el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
      var part = stepParts(s);
      return el('li', null, el('div', null,
        el('div', { class: 'action', text: part.action }),
        el('span', { class: 'cost', text: 'cost: ' + part.cost + (part.time ? '  \u00B7  time: ' + part.time : '') })
      ));
    }));

    return el('div', { class: 'detail' },
      el('button', { class: 'back', type: 'button', text: '\u2190 The board', onclick: backToBoard }),
      head,
      el('div', { class: 'dgrid' },
        el('div', null,
          figs,
          el('div', { class: 'sect' },
            el('h2', { text: 'How this number is made' }),
            el('p', { class: 'lede', text: 'Two terms, both from the snapshot: the protocol\u2019s own TVL, and a curve fitted on every protocol in the snapshot that already trades. No protocol name is special-cased; the same function scored every row on the board.' }),
            math,
            el('p', { class: 'lede', text: 'Elasticity: the curve\u2019s slope is ' + CURVE.b.toFixed(3) + ', so a protocol ten times larger is priced at ' + Math.pow(10, CURVE.b).toFixed(2) + '\u00D7 the multiple per dollar of TVL \u2014 market value grows with TVL, but less than proportionally.' }),
            check
          ),
          el('div', { class: 'sect' },
            el('h2', { text: 'What is not in the product' }),
            el('p', { class: 'lede', text: 'Growth and age are both on this page and both in board.json, and neither is multiplied into the implied value. That is a measured result, not an omission: each was added to the same leave-one-out test the curve is chosen by, and the table below is what came back.' }),
            excluded
          ),
          el('div', { class: 'sect' },
            el('h2', { text: 'The chance a token exists at all' }),
            el('p', { class: 'lede', text: 'The implied value answers \u201cwhat would it be worth if it launched\u201d. The odds answer \u201chow often protocols like this one record a token at all\u201d, and the product of the two is the expected value the board ranks by second.' }),
            oddsBox
          ),
          evidence(true)
        ),
        el('div', null,
          record,
          el('div', { class: 'sect' },
            el('h2', { text: 'Farm plan, ' + row.farm_steps.length + ' steps' }),
            el('p', { class: 'lede', text: 'Built from this protocol\u2019s category, its chains, its TVL and its age. Every cost and time below is an estimate for the chain named, not a quote, and there is no yield figure because the snapshot carries none. The last step prices the whole thing against the odds above.' }),
            steps
          )
        )
      ),
      el('div', { class: 'next' },
        prev ? el('button', { type: 'button', text: '\u2190 #' + prev.rank + ' ' + prev.name, onclick: function () { openDetail(prev.slug); } }) : null,
        next ? el('button', { type: 'button', text: '#' + next.rank + ' ' + next.name + ' \u2192', onclick: function () { openDetail(next.slug); } }) : null
      )
    );
  }

  /** One line of the record: the field name in mono, then its value. */
  function rec(field, value, cls) {
    return el('div', { class: 'rec' + (cls ? ' ' + cls : '') }, el('code', { text: field }), el('span', { text: String(value) }));
  }

  function topbar() {
    return el('div', { class: 'topbar' }, el('div', { class: 'wrap' },
      el('div', { class: 'brand' },
        el('span', { class: 'glyph', text: '\u25C9' }),
        el('b', { text: 'Token Radar' }),
        el('span', { class: 'kicker', text: 'pre-token launch board' })
      ),
      el('div', { class: 'meta' },
        el('span', null, 'snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, DATA.protocol_count + ' protocols'),
        el('span', null, 'model ', el('b', { text: DATA.model_version }))
      )
    ));
  }

  function hero() {
    return el('section', { class: 'hero' },
      el('div', null,
        el('h1', null, DATA.board_size, ' protocols with no token on record, ranked by what the market already pays for ', el('em', { text: 'a dollar of TVL' })),
        el('p', null,
          'Every multiple on this page comes from one curve fitted on the ',
          el('b', { text: plural(V.obs, 'ratio', 'ratios') }),
          ' of protocols in this snapshot that already trade: ',
          el('b', { text: 'log(mcap/tvl) = ' + CURVE.a.toFixed(2) + ' \u2212 ' + Math.abs(CURVE.b).toFixed(2) + ' \u00D7 log(tvl)' }),
          '. Every watchlist slug is on the board, and so are ',
          el('b', { text: String(DATA.early_size) }),
          ' more pre-token protocols below the house\u2019s $' + Math.round(DATA.floor_usd / 1e6) + 'M floor.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', null, DATA.watchlist_on_board + '/' + DATA.watchlist_size)),
        el('div', { class: 'fact' }, el('span', { text: 'Ranked rows' }), el('b', null, String(DATA.board_size))),
        el('div', { class: 'fact' }, el('span', { text: 'Ratios fitted' }), el('b', null, String(V.obs))),
        el('div', { class: 'fact' }, el('span', { text: 'Curve vs constant' }), el('b', null, V.base.curve.toFixed(2), el('small', { text: ' / ' + V.base.constant.toFixed(2) })))
      )
    );
  }

  // The odds table, made clickable: each chip is a category's token share and a filter at once.
  function calibration() {
    var cats = categories().slice(0, 9);
    var chips = cats.map(function (c) {
      var b = bucketFor(DATA.odds.by_category, c);
      var on = state.category === c;
      var rate = b === null ? DATA.odds.base : b.rate;
      return el('button', {
        class: 'chip' + (b !== null && rate > DATA.odds.base ? ' up' : b !== null && rate < DATA.odds.base ? ' down' : ''),
        type: 'button',
        'aria-pressed': on ? 'true' : 'false',
        title: (b === null ? 'no evidence in this category' : b.hits + ' of ' + b.n + ' protocols in ' + c + ' record a token') + ', click to filter the board',
        onclick: function () {
          state.category = on ? '' : c;
          state.view = 'board';
          state.page = 1;
          writeHash();
          render();
        }
      },
        el('b', { text: c }),
        el('span', { class: 'm', text: fmtOdds(rate) }),
        el('span', { class: 'n', text: 'n=' + (b === null ? 0 : b.n) })
      );
    });
    return el('div', { class: 'calib' }, el('div', { class: 'wrap' },
      el('div', null,
        el('h2', { text: 'Who ends up with a token' }),
        el('p', { class: 'note', text: DATA.odds.hits + ' of ' + DATA.odds.n + ' protocols record a token, ' + fmtOdds(DATA.odds.base) + '. Each chip is that share within a category; the board moves it by how long a protocol has run as well. Click to filter.' })
      ),
      el('div', { class: 'chips' },
        el('button', { class: 'chip', type: 'button', 'aria-pressed': state.category === '' ? 'true' : 'false', onclick: function () { state.category = ''; state.view = 'board'; writeHash(); render(); } },
          el('b', { text: 'All categories' }), el('span', { class: 'n', text: DATA.board_size + ' rows' })),
        chips
      )
    ));
  }

  function controls() {
    var search = el('input', {
      type: 'search', id: 'q', value: state.q, placeholder: 'Name, slug or chain',
      'aria-label': 'Search the board',
      oninput: function () { state.q = search.value; state.page = 1; writeHash(); render(); }
    });
    var cat = el('select', { id: 'c', 'aria-label': 'Filter by category',
      onchange: function () { state.category = cat.value; state.page = 1; writeHash(); render(); } },
      el('option', { value: '', text: 'Every category' }),
      categories().map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    var chain = el('select', { id: 'ch', 'aria-label': 'Filter by chain',
      onchange: function () { state.chain = chain.value; state.page = 1; writeHash(); render(); } },
      el('option', { value: '', text: 'Every chain' }),
      chains().map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    var seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Which list' },
      el('button', { type: 'button', 'aria-pressed': state.view === 'board' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.view = 'board'; state.slug = null; writeHash(); render(); } }),
      el('button', { type: 'button', 'aria-pressed': state.view === 'live' ? 'true' : 'false', text: 'Already trading \u00B7 ' + DATA.live_size, onclick: function () { state.view = 'live'; state.slug = null; writeHash(); render(); } })
    );
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'c', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'ch', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('span', { class: 'flabel', text: 'List' }), seg),
      el('span', { class: 'count spacer' }, el('b', { text: String(filtered().length) }), ' of ' + DATA.board_size + ' rows'),
      (state.q || state.category || state.chain) ? el('button', { class: 'button', type: 'button', text: 'Clear', onclick: clearFilters }) : null
    );
  }

  function footnote() {
    return el('div', { class: 'foot' },
      el('div', null,
        el('h3', { text: 'The model, in one line' }),
        el('div', { class: 'formula', text:
          'implied = round( tvl_usd \u00D7 exp(' + CURVE.a.toFixed(4) + ' + ' + CURVE.b.toFixed(4) + ' \u00D7 log(tvl_usd)) )\n' +
          'odds    = base rate, moved by the age bucket and the category bucket\n' +
          'expected = implied \u00D7 odds' }),
        el('p', { class: 'lede', text: 'The curve is fitted at run time on every protocol that records both a market cap and a TVL, ratios at or below 0 and at or above 100 dropped. model.js refits it in the page and compares it, row by row, with the number board.json carries. Growth and age are on every row and deliberately outside the product: the test above says they make it worse.' })
      ),
      el('div', null,
        el('h3', { text: 'What the board leaves out' }),
        el('ul', null,
          el('li', { text: 'Every protocol whose record carries a market cap, a CoinGecko id or a symbol: it already trades, and its market value is a fact, not a model.' }),
          el('li', { text: 'CEX, Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking and Restaked BTC: wrapped, staked or bridged products of a token that exists.' }),
          el('li', { text: 'Versioned pools, names carrying wrapped or staked, and exchange-branded products.' })
        )
      )
    );
  }

  function render() {
    var wrap = el('div', { class: 'wrap' });
    if (state.view === 'detail') {
      wrap.appendChild(detailView());
    } else {
      wrap.appendChild(hero());
      wrap.appendChild(controls());
      wrap.appendChild(state.view === 'live' ? liveView() : boardView());
      if (state.view === 'board') wrap.appendChild(evidence(false));
      wrap.appendChild(footnote());
    }
    root.textContent = '';
    root.appendChild(topbar());
    root.appendChild(calibration());
    root.appendChild(wrap);
    root.setAttribute('aria-busy', 'false');
    document.title = state.view === 'detail' && state.slug
      ? state.slug + ' \u00B7 Token Radar'
      : 'Token Radar: ' + DATA.board_size + ' pre-token protocols ranked by a learned implied value';
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
})();
