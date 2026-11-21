// Token Radar's dashboard: one static page over window.RADAR, which main.ts writes to data.js
// beside it. No network, no framework, no build step: every figure on screen is in that file, and
// the value model is recomputed here from the same observations the model learned it from, so a
// reader can check the arithmetic rather than trust the number.
//
// What the page does:
//   board      the ranked pre-token board: sortable on every column, filtered by category and chain,
//              searched by name or slug, paged. A row opens its protocol's detail.
//   detail     one protocol: every snapshot figure, the model's three multipliers with the category
//              multiple and where it came from, the recomputed implied value, and its farm plan.
//   live       the protocols whose token already trades, set aside with the market's own figures.
//              These are the observations the model is built from, which is why they are on the page.
//
// The state lives in the URL hash, so a filtered view is a link and the three screenshots are three
// URLs: index.html, index.html#p=<slug>, index.html#c=<category>.
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

  // ---------------------------------------------------------------- numbers

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
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + ' y';
    if (days >= 60) return Math.round(days / 30) + ' mo';
    return Math.round(days) + ' d';
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ---------------------------------------------------------------- the model, recomputed

  // The model lives in model.js, beside this file, and is loaded before it: medianOf,
  // learnFromObservations and impliedOf are lib/model.ts's medianOf, learnCategoryMultiples and
  // impliedValueFor. The page derives the whole table again from the observations data.js carries,
  // and recomputes each row it shows, so the arithmetic on screen is checkable rather than trusted.
  var MODEL = window.RadarModel;
  var LEARNED = MODEL.learnFromObservations(DATA.learn.observations, DATA.learn.min_observations);

  function impliedOf(row) {
    return MODEL.impliedOf(row, LEARNED, DATA.params, DATA.learn.median_age_days).implied;
  }
  function valuationOf(row) {
    return MODEL.impliedOf(row, LEARNED, DATA.params, DATA.learn.median_age_days);
  }

  // ---------------------------------------------------------------- DOM

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) { if (c) node.appendChild(c); });
      } else if (typeof child === 'string' || typeof child === 'number') {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  // ---------------------------------------------------------------- the URL hash

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var params = new URLSearchParams(raw);
    if (params.get('p')) { state.slug = params.get('p'); state.view = 'detail'; }
    if (params.get('view')) state.view = params.get('view');
    if (params.get('q')) state.q = params.get('q');
    if (params.get('c')) state.category = params.get('c');
    if (params.get('ch')) state.chain = params.get('ch');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('dir')) state.dir = params.get('dir') === '1' ? 1 : -1;
    if (params.get('page')) state.page = Math.max(1, parseInt(params.get('page'), 10) || 1);
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.view === 'detail' && state.slug) params.set('p', state.slug);
    else if (state.view !== 'board') params.set('view', state.view);
    if (state.q) params.set('q', state.q);
    if (state.category) params.set('c', state.category);
    if (state.chain) params.set('ch', state.chain);
    if (state.sort !== 'rank') params.set('sort', state.sort);
    if (state.dir !== 1) params.set('dir', '1');
    if (state.page > 1) params.set('page', String(state.page));
    var next = params.toString();
    var url = next ? '#' + next : window.location.pathname;
    if (window.history.replaceState) window.history.replaceState(null, '', url);
    else window.location.hash = next;
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
    if (key === 'rank') return row.rank;
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'growth') return row.change_7d === null ? -1e9 : row.change_7d;
    if (key === 'age') return row.age_days === null ? -1 : row.age_days;
    if (key === 'multiple') return row.multiple;
    if (key === 'category') return (row.category || 'Other').toLowerCase();
    return row.implied_value_usd;
  }

  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av = value(a, key), bv = value(b, key);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.rank - b.rank;
    });
  }

  function setSort(key) {
    if (state.sort === key) state.dir = -state.dir;
    else { state.sort = key; state.dir = key === 'name' || key === 'category' || key === 'rank' ? 1 : -1; }
    state.page = 1;
    writeHash();
    render();
  }

  function th(key, label, cls) {
    var on = state.sort === key;
    return el('th', {
      scope: 'col',
      class: cls || null,
      'aria-sort': on ? (state.dir === 1 ? 'ascending' : 'descending') : 'none'
    }, el('button', { type: 'button', onclick: function () { setSort(key); } },
      label,
      on ? el('span', { class: 'mark', 'aria-hidden': 'true', text: state.dir === 1 ? '\u25B2' : '\u25BC' }) : null
    ));
  }

  function openDetail(slug) {
    state.view = 'detail';
    state.slug = slug;
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
    state.q = '';
    state.category = '';
    state.chain = '';
    state.page = 1;
    writeHash();
    render();
  }

  function filterNote(list) {
    if (!state.q && !state.category && !state.chain) return null;
    var bits = [];
    if (state.category) {
      var t = LEARNED.table[state.category];
      bits.push(el('span', null, 'category ', el('b', { text: state.category }),
        t ? ' \u00B7 priced at ' + t.multiple.toFixed(2) + '\u00D7, ' + (t.learned ? 'the median of its ' + t.n + ' ratios' : 'the pooled fallback, from only ' + t.n + ' of its own') : ''));
    }
    if (state.chain) bits.push(el('span', null, 'chain ', el('b', { text: state.chain })));
    if (state.q) bits.push(el('span', null, 'search ', el('b', { text: '\u201C' + state.q + '\u201D' })));
    return el('div', { class: 'filternote' },
      el('span', { class: 'lead' }, el('b', { text: String(list.length) }), ' of ' + DATA.board_size + ' rows'),
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
        el('td', { class: 'num r c-mx ' + (r.multiple_source === 'category' ? 'cat' : ''), text: r.multiple.toFixed(2) + '\u00D7' }),
        el('td', { class: 'r' }, el('div', { class: 'iv' },
          el('div', { class: 'meter', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('b', { text: fmtUsd(r.implied_value_usd) })
        )),
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
            th('implied', 'Implied value', 'r'),
            el('th', { scope: 'col', class: 'c-tag', text: 'List' })
          )),
          body
        )
      ),
      el('div', { class: 'pager' },
        el('button', { class: 'button', type: 'button', text: '\u2190 Newer', disabled: state.page <= 1, onclick: function () { state.page--; writeHash(); render(); } }),
        el('span', { class: 'num', text: 'page ' + state.page + ' / ' + pages + ' \u00B7 ranks ' + ((state.page - 1) * PER_PAGE + 1) + '\u2013' + ((state.page - 1) * PER_PAGE + slice.length) + ' of ' + list.length }),
        el('button', { class: 'button', type: 'button', text: 'Older \u2192', disabled: state.page >= pages, onclick: function () { state.page++; writeHash(); render(); } })
      )
    );
  }

  // ---------------------------------------------------------------- the live set

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
        el('td', null, el('span', { class: 'tag ' + (r.counted ? 'early' : 'wl'), text: r.counted ? 'counted' : 'not counted' }))
      ));
    });
    return el('div', null,
      el('p', { class: 'lede', text: 'These protocols already trade, so their market cap is a fact rather than a model, and they are kept out of the ranking entirely. Their market cap over TVL is the observation this page learns its multiples from: ' + plural(DATA.learn.overall_observations, 'usable ratio', 'usable ratios') + ' across ' + plural(DATA.live_with_mcap, 'protocol', 'protocols') + ', the rest dropped as unusable or out of range.' }),
      el('div', { class: 'panel' }, el('div', { class: 'scroll' },
        el('table', { class: 'grid' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', class: 'r c-tvl', text: 'TVL' }),
            el('th', { scope: 'col', class: 'r', text: 'Market cap' }),
            el('th', { scope: 'col', class: 'r', text: 'Mcap / TVL' }),
            el('th', { scope: 'col', class: 'r c-7d', text: '7d' }),
            el('th', { scope: 'col', text: 'In the table' })
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

  // ---------------------------------------------------------------- the detail

  function stepParts(step) {
    var at = step.indexOf(' Cost: ');
    var action = at >= 0 ? step.slice(0, at) : step;
    var tail = at >= 0 ? step.slice(at + 6) : '';
    var ti = tail.indexOf('. Time: ');
    var cost = ti >= 0 ? tail.slice(0, ti) : tail;
    var time = ti >= 0 ? tail.slice(ti + 8).replace(/\.$/, '') : '';
    return { action: action, cost: cost, time: time };
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
    var recomputed = v.implied;
    var agrees = recomputed === row.implied_value_usd
      && v.growth_multiplier === row.growth_multiplier
      && v.age_multiplier === row.age_multiplier
      && v.multiple === row.multiple;
    var idx = DATA.rows.indexOf(row);
    var prev = idx > 0 ? DATA.rows[idx - 1] : null;
    var next = idx < DATA.rows.length - 1 ? DATA.rows[idx + 1] : null;
    var cat = LEARNED.table[row.category || 'Other'];
    var p = DATA.params;
    var g = row.change_7d;
    var growthPct = g === null || g === undefined ? 0 : Math.min(p.growth_cap, Math.max(p.growth_floor, g));
    var ageUsed = row.age_days === null || row.age_days === undefined ? DATA.learn.median_age_days : row.age_days;

    var chainText = (row.chains || []).length === 0
      ? 'chain unlisted'
      : row.chains.slice(0, 3).join(', ') + (row.chains.length > 3 ? ' +' + (row.chains.length - 3) + ' more' : '');

    var head = el('div', { class: 'dhead' },
      el('div', null,
        el('h1', { text: row.name }),
        el('p', { class: 'sub' },
          (row.category || 'Other'), ' \u00B7 ',
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
      el('div', { class: 'fig' }, el('span', { text: 'Category multiple' }), el('b', { text: row.multiple.toFixed(4) + '\u00D7' }), el('em', { text: row.multiple_source === 'category' ? 'median of ' + plural(row.category_observations, 'ratio', 'ratios') : 'pooled median of ' + DATA.learn.overall_observations })),
      el('div', { class: 'fig' }, el('span', { text: 'Multiple from' }), el('b', { text: row.multiple_source === 'category' ? 'its category' : 'the whole snapshot' }), el('em', { text: row.multiple_source === 'category' ? 'enough evidence to price itself' : 'its category has only ' + plural(row.category_observations, 'ratio', 'ratios') }))
    );

    // The arithmetic, spelled out so a reader can redo it on paper: the term, the expression, the
    // numbers substituted into it, and the result. The last row is their product.
    var ageClamped = Math.min(Math.max(ageUsed, 0), p.age_span_days);
    var mrow = function (label, formula, sub, value, total) {
      return el('div', { class: 'mrow' + (total ? ' total' : '') },
        el('div', { class: 'term' },
          el('b', { text: label }),
          el('code', { text: formula }),
          el('span', { text: sub })
        ),
        el('b', { class: 'val', text: value })
      );
    };
    var math = el('div', { class: 'math' },
      mrow('TVL', 'tvl_usd', fmtUsd(row.tvl_usd) + ' exactly', fmtUsd(row.tvl_usd)),
      mrow('Multiple',
        'median(mcap_usd / tvl_usd) over ' + (row.category || 'Other'),
        row.multiple_source === 'category'
          ? 'the median of the ' + plural(row.category_observations, 'protocol in that category that trades', 'protocols in that category that trade')
          : 'the pooled median of all ' + DATA.learn.overall_observations + ', because that category has only ' + plural(row.category_observations, 'protocol that trades', 'protocols that trade'),
        row.multiple.toFixed(4)),
      mrow('Growth',
        '1 + (clamp(change_7d, ' + p.growth_floor + ', ' + p.growth_cap + ') / 100 \u00D7 ' + p.growth_weight + ')',
        '1 + (' + growthPct.toFixed(2) + ' / 100 \u00D7 ' + p.growth_weight + ')',
        row.growth_multiplier.toFixed(4)),
      mrow('Age',
        p.age_floor + ' + (min(age_days, ' + p.age_span_days + ') / ' + p.age_span_days + ' \u00D7 ' + p.age_range + ')',
        p.age_floor + ' + (' + ageClamped + ' / ' + p.age_span_days + ' \u00D7 ' + p.age_range + ')' + (row.age_days === null ? ', on the snapshot median age' : ''),
        row.age_multiplier.toFixed(4)),
      mrow('Implied value', 'TVL \u00D7 multiple \u00D7 growth \u00D7 age', 'the product of the four rows above', fmtUsd(row.implied_value_usd), true)
    );

    var check = el('div', { class: 'check' + (agrees ? '' : ' bad') },
      agrees
        ? '\u2713 This page ran model.js over the snapshot fields and got the same four numbers and the same ' + fmtUsd(recomputed) + ' that board.json carries.'
        : '\u2717 This page ran model.js over the snapshot fields and got ' + fmtUsd(recomputed) + ', which differs from board.json: the data is stale.'
    );

    // Every field the snapshot carries for this protocol, so the page states the record rather than
    // a summary of it. The ten fields are the whole of what the model saw.
    var record = el('div', { class: 'record' },
      el('h3', { text: 'The snapshot record: all ten fields' }),
      el('div', { class: 'recgrid' },
        rec('slug', row.slug),
        rec('name', row.name),
        rec('category', row.category || 'null'),
        rec('tvl_usd', '$' + row.tvl_usd.toLocaleString('en-US')),
        rec('change_7d', row.change_7d === null ? 'null (unreported, counted as 0)' : row.change_7d + ' %'),
        rec('listed_at', row.listed_at === null ? 'null \u2014 no date, so age falls back to the snapshot median of ' + DATA.learn.median_age_days + ' days' : row.listed_at + ' \u2192 ' + row.age_days + ' days'),
        rec('mcap_usd', 'null \u2014 records no token'),
        rec('gecko_id', 'null'),
        rec('symbol', 'null'),
        rec('age_days', row.age_days === null ? 'null' : String(row.age_days), 'wide'),
        rec('chains', row.chains.length + ' \u2014 ' + row.chains.join(', '), 'wide')
      )
    );

    // The evidence, as a distribution rather than a wall of numbers: every ratio the multiple is the
    // median of, bucketed, with the bucket holding the median marked. The range is capped at the 90th
    // percentile so one outlier cannot flatten the shape, and everything above the cap falls into the
    // last bucket, labelled as such. A reader can see why the model takes the median: the mass sits
    // far below the mean.
    var catKey = row.category || 'Other';
    var own = DATA.learn.observations[catKey] || [];
    var pooledAll = [];
    Object.keys(DATA.learn.observations).forEach(function (k) { pooledAll = pooledAll.concat(DATA.learn.observations[k]); });
    var fromOwn = row.multiple_source === 'category';
    var evidenceList = (fromOwn ? own : pooledAll).slice().sort(function (a, b) { return a - b; });
    var BUCKETS = 24;
    var p90 = evidenceList.length ? evidenceList[Math.min(evidenceList.length - 1, Math.floor(evidenceList.length * 0.9))] : 1;
    var cap = Math.max(p90, row.multiple * 1.5, 0.01);
    var counts = [];
    for (var b = 0; b < BUCKETS; b++) counts.push(0);
    var overflow = 0;
    evidenceList.forEach(function (r) {
      if (r > cap) { overflow++; counts[BUCKETS - 1]++; return; }
      counts[Math.min(BUCKETS - 1, Math.floor((r / cap) * BUCKETS))]++;
    });
    var peak = Math.max.apply(null, counts.concat([1]));
    var medianBucket = Math.min(BUCKETS - 1, Math.floor((row.multiple / cap) * BUCKETS));
    var bars = counts.map(function (c, i) {
      var h = c === 0 ? 1 : Math.max(4, Math.round((c / peak) * 62));
      return el('div', {
        class: 'bar' + (i === medianBucket ? ' med' : '') + (c === 0 ? ' zero' : ''),
        style: 'height:' + h + 'px',
        title: (i === BUCKETS - 1 && overflow > 0
          ? cap.toFixed(2) + '\u00D7 and above: ' + plural(c, 'protocol', 'protocols')
          : (cap / BUCKETS * i).toFixed(2) + '\u2013' + (cap / BUCKETS * (i + 1)).toFixed(2) + '\u00D7: ' + plural(c, 'protocol', 'protocols'))
      });
    });
    var mean = evidenceList.length ? evidenceList.reduce(function (a, b) { return a + b; }, 0) / evidenceList.length : 0;
    var binWidth = (cap / BUCKETS).toFixed(2);
    var peakBucket = counts.indexOf(peak);

    var evidence = el('div', { class: 'sect' },
      el('h2', { text: 'Where the multiple comes from' }),
      el('p', { class: 'lede', text: (fromOwn
        ? 'The ' + plural(own.length, 'protocol', 'protocols') + ' filed under ' + catKey + ' that record both a market cap and a TVL: each is one market-cap-to-TVL ratio, bucketed below, with the bucket holding the median in oxide.'
        : 'Only ' + plural(own.length, 'protocol', 'protocols') + ' in ' + catKey + ' records both a market cap and a TVL, under the minimum of ' + DATA.learn.min_observations + ' a category needs to price itself, so this row uses the pooled median of all ' + pooledAll.length + ' ratios in the snapshot. The bucket holding that median is in oxide.')
        + ' The mean of these ' + plural(evidenceList.length, 'ratio', 'ratios') + ' is ' + mean.toFixed(2) + ' and the median is ' + row.multiple.toFixed(2) + ': the mass sits far below the mean, which is why the model takes the median rather than the mean.' }),
      el('div', { class: 'hist' },
        el('div', { class: 'histbar' },
          el('span', { text: plural(evidenceList.length, 'ratio', 'ratios') + ' in ' + BUCKETS + ' buckets of ' + binWidth + '\u00D7, capped at the 90th percentile' }),
          el('span', { class: 'mid', text: 'tallest bucket: ' + plural(peak, 'protocol', 'protocols') + (peakBucket === BUCKETS - 1 && overflow > 0 ? ' at the cap' : ' at ' + (cap / BUCKETS * peakBucket).toFixed(2) + '\u00D7') })
        ),
        el('div', { class: 'bars' }, bars),
        el('div', { class: 'axis' },
          el('span', { text: '0\u00D7' }),
          el('span', { class: 'mid', text: '\u25B2 median ' + row.multiple.toFixed(2) + '\u00D7' }),
          el('span', { text: cap.toFixed(1) + '\u00D7+' })
        )
      ),
      el('p', { class: 'lede', text: 'lib/model.ts computed every ratio in observedRatios and took the median in learnCategoryMultiples, dropping ratios at or below 0 and at or above ' + DATA.learn.ratio_ceiling + '.' })
    );

    // Every field the snapshot carries for this protocol, so the page states the record rather than
    // a summary of it. The ten fields are the whole of what the model saw.
    var record = el('div', { class: 'record' },
      el('h3', { text: 'The snapshot record' }),
      el('div', { class: 'recgrid' },
        rec('slug', row.slug),
        rec('category', row.category || 'none recorded'),
        rec('tvl_usd', '$' + row.tvl_usd.toLocaleString('en-US')),
        rec('change_7d', row.change_7d === null ? 'null (unreported)' : row.change_7d.toFixed(4) + '%'),
        rec('mcap_usd', 'null: records no token'),
        rec('listed_at', row.listed_at || 'null'),
        rec('gecko_id', 'null'),
        rec('symbol', 'null'),
        rec('chains', row.chains.length + ': ' + row.chains.join(', ')),
        rec('age_days', row.age_days === null ? 'null: no listing date, so the snapshot\u2019s median age of ' + DATA.learn.median_age_days + ' days is used' : String(row.age_days))
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
            el('p', { class: 'lede', text: 'Every figure below is the snapshot\u2019s own, and the multiple is the median of what the market already pays for a dollar of TVL in this protocol\u2019s category. No protocol name is special-cased: the same function scored every row on the board.' }),
            math,
            check
          ),
          evidence
        ),
        el('div', null,
          record,
          el('div', { class: 'sect' },
            el('h2', { text: 'Farm plan, ' + row.farm_steps.length + ' steps' }),
            el('p', { class: 'lede', text: 'Built from this protocol\u2019s category, its chains, its TVL and its age. Every cost and time below is an estimate for the chain named, not a quote, and there is no yield figure here because the snapshot carries none.' }),
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

  /** One line of the snapshot record: the field's name in mono, then its value. */
  function rec(field, value, cls) {
    return el('div', { class: 'rec' + (cls ? ' ' + cls : '') }, el('code', { text: field }), el('span', { text: String(value) }));
  }

  // ---------------------------------------------------------------- the shell

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
          'The multiple each row is priced at is not a guess: it is the median market-cap-to-TVL ratio of that row\u2019s own category, learned at run time from the ',
          el('b', { text: plural(DATA.learn.overall_observations, 'protocol that already trades', 'protocols that already trade') }),
          ' in this snapshot. Every watchlist slug is on the board, and so are ',
          el('b', { text: String(DATA.early_size) }),
          ' more pre-token protocols below the house\u2019s $' + Math.round(DATA.floor_usd / 1e6) + 'M floor.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', null, DATA.watchlist_on_board + '/' + DATA.watchlist_size)),
        el('div', { class: 'fact' }, el('span', { text: 'Ranked rows' }), el('b', null, String(DATA.board_size))),
        el('div', { class: 'fact' }, el('span', { text: 'Already trading' }), el('b', null, String(DATA.live_size), el('small', { text: ' set aside' }))),
        el('div', { class: 'fact' }, el('span', { text: 'Ratios learned' }), el('b', null, String(DATA.learn.overall_observations)))
      )
    );
  }

  // The strip shows the categories the board actually ranks, each with the multiple the table learned
  // for it and the number of ratios behind it: a chip is also the filter, so every chip leads somewhere.
  function calibration() {
    var cats = categories().slice(0, 10);
    var mismatch = LEARNED.overall !== DATA.learn.overall_multiple;
    DATA.learn.categories.forEach(function (c) {
      var mine = LEARNED.table[c.category];
      if (!mine || mine.multiple !== c.multiple) mismatch = true;
    });
    var chips = cats.map(function (c) {
      var t = LEARNED.table[c] || { n: 0, multiple: LEARNED.overall, learned: false };
      var on = state.category === c;
      return el('button', {
        class: 'chip' + (t.learned ? '' : ' fallback'),
        type: 'button',
        'aria-pressed': on ? 'true' : 'false',
        title: (t.learned ? 'median of ' + t.n + ' ratios' : 'pooled fallback: only ' + t.n + ' of its own') + ', click to filter the board',
        onclick: function () {
          state.category = on ? '' : c;
          state.view = 'board';
          state.page = 1;
          writeHash();
          render();
        }
      },
        el('b', { text: c }),
        el('span', { class: 'm', text: t.multiple.toFixed(2) + '\u00D7' }),
        el('span', { class: 'n', text: 'n=' + t.n })
      );
    });
    return el('div', { class: 'calib' }, el('div', { class: 'wrap' },
      el('div', null,
        el('h2', { text: 'The multiple is learned, not assumed' }),
        el('p', { class: 'note', text: mismatch
          ? 'Recomputed here and it disagrees with data.js: the two are out of step.'
          : 'Recomputed in this page from ' + DATA.learn.overall_observations + ' ratios; agrees with data.js. Dashed chips fall back to the pooled ' + LEARNED.overall.toFixed(2) + '\u00D7.' })
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
    var p = DATA.params;
    return el('div', { class: 'foot' },
      el('div', null,
        el('h3', { text: 'The model, in one line' }),
        el('div', { class: 'formula', text:
          'implied = round( tvl_usd \u00D7 median_mcap_over_tvl(category) \u00D7 (1 + clamp(change_7d, ' + p.growth_floor + ', ' + p.growth_cap + ')/100 \u00D7 ' + p.growth_weight + ') \u00D7 (' + p.age_floor + ' + min(age_days, ' + p.age_span_days + ')/' + p.age_span_days + ' \u00D7 ' + p.age_range + ') )' }),
        el('p', { class: 'lede', text: 'The median is taken over every protocol in the snapshot that records both a market cap and a TVL, grouped by category, with ratios at or below 0 and at or above ' + DATA.learn.ratio_ceiling + ' dropped. A category with at least ' + DATA.learn.min_observations + ' such ratios prices itself; one with fewer falls back to the pooled median of ' + DATA.learn.overall_median + ', so the fallback is a stated figure rather than a hidden constant.' })
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

  // ---------------------------------------------------------------- render

  function render() {
    var wrap = el('div', { class: 'wrap' });
    if (state.view === 'detail') {
      wrap.appendChild(detailView());
    } else {
      wrap.appendChild(hero());
      wrap.appendChild(controls());
      wrap.appendChild(state.view === 'live' ? liveView() : boardView());
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
