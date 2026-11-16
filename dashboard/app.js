// Token Radar dashboard: renders window.RADAR (written by main.ts beside this page as ../data.js).
// No network, no framework: the board, its filters, the detail view and the live set are all here.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) return;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var commas = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  var money = function (n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + commas(n);
  };
  var pct = function (n) {
    if (n == null) return '<span class="num">—</span>';
    var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
    return '<span class="num ' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  };
  var ageText = function (days) {
    if (days == null) return 'unknown';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30.4) + ' mo';
    return (days / 365).toFixed(1) + ' yrs';
  };

  /* ---- header stats ---- */
  var totalImplied = R.rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  $('stats').innerHTML =
    stat(R.scanned_size, 'protocols scanned') + stat(R.board_size, 'rows on the board') +
    stat(R.watchlist_size + ' / ' + R.watchlist_size, 'watchlist covered') + stat(money(totalImplied), 'implied value, total') +
    stat(R.as_of, 'snapshot date');

  function stat(v, label) { return '<div class="stat"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>'; }

  /* ---- the method strip: the model stated in the open, with its multiples table ---- */
  var multRows = R.multiples.map(function (m) {
    return '<tr><td>' + esc(m.category) + '</td><td>' + m.multiple.toFixed(2) + 'x</td><td>' + m.samples + '</td></tr>';
  }).join('');
  $('method').innerHTML =
    '<div class="formula"><h2>How a value is implied — model ' + esc(R.model_version) + '</h2>' +
    '<p>Each category is priced by the market itself: <b>multiple = median(market cap / TVL)</b> of the snapshot\'s already-launched ' +
    'protocols in that category (all-market median <b>' + R.market_multiple.toFixed(2) + 'x</b> where a category has under three). Then ' +
    '<b>implied = TVL x multiple x growth x maturity x reach</b> — growth from the week\'s TVL change, maturity from how long the ' +
    'protocol has run with no token recorded, reach from its chain count. No name is special-cased; open any row to see its working.</p></div>' +
    '<table class="mults"><tr><th>Category</th><th>Multiple</th><th>Launched samples</th></tr>' + multRows + '</table>';

  /* ---- controls ---- */
  var cats = {}, chains = {};
  R.rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  Object.keys(cats).sort().forEach(function (c) { $('cat').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>'); });
  Object.keys(chains).sort().forEach(function (c) { $('chain').insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>'); });

  var state = { q: '', cat: '', chain: '', tier: '', sort: 'implied' };
  var bySlug = {};
  R.rows.forEach(function (r) { bySlug[r.slug] = r; });

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = R.rows.filter(function (r) {
      if (state.tier && r.tier !== state.tier) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = {
      implied: function (r) { return r.implied_value_usd; },
      tvl: function (r) { return r.tvl_usd; },
      growth: function (r) { return r.change_7d == null ? -1e9 : r.change_7d; },
      age: function (r) { return r.age_days == null ? -1 : r.age_days; },
      multiple: function (r) { return r.model.category_multiple; },
    }[state.sort];
    out.sort(function (a, b) { return key(b) - key(a) || a.rank - b.rank; });
    return out;
  }

  function render() {
    var live = state.tier === 'live';
    $('board').style.display = live ? 'none' : '';
    $('live').hidden = !live;
    if (live) { renderLive(); $('count').textContent = R.live.length + ' launched protocols shown for scale — the board never ranks them.'; return; }
    var rows = filtered();
    $('count').textContent = 'Showing ' + rows.length + ' of ' + R.rows.length + ' ranked protocols' +
      (state.tier === 'watchlist' ? ' — the watchlist: every pre-token protocol at or above the $' + commas(R.floor_usd) + ' floor' : '') +
      (state.tier === 'early' ? ' — early finds: pre-token protocols below the floor, ranked by the same model' : '') + '. Click a row for its farm plan.';
    $('rows').innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td class="rank">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><span class="badge ' + (r.tier === 'watchlist' ? 'watch' : 'early') + '">' +
        (r.tier === 'watchlist' ? 'WATCHLIST' : 'EARLY') + '</span><br><span class="cat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="chains">' + esc(r.chains.join(', ') || '—') + '</td>' +
        '<td class="r num">' + money(r.tvl_usd) + '</td><td class="r">' + pct(r.change_7d) + '</td>' +
        '<td class="r num">' + ageText(r.age_days) + '</td>' +
        '<td class="r num">' + r.model.category_multiple.toFixed(2) + 'x</td>' +
        '<td class="r"><span class="implied">' + money(r.implied_value_usd) + '</span></td>' +
        '<td class="open-hint">›</td></tr>';
    }).join('');
  }

  function renderLive() {
    $('live-rows').innerHTML = R.live.map(function (r) {
      return '<tr><td><span class="name">' + esc(r.name) + '</span><br><span class="cat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="sym">' + esc(r.symbol || '—') + '</td><td class="chains">' + esc(r.chains.join(', ')) + '</td>' +
        '<td class="r num">' + money(r.tvl_usd) + '</td><td class="r">' + pct(r.change_7d) + '</td>' +
        '<td class="r num">' + money(r.mcap_usd) + '</td></tr>';
    }).join('');
  }

  /* ---- detail view ---- */
  function openDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    var m = r.model;
    var base = r.tvl_usd * m.category_multiple;
    var line = function (label, v) { return '<div class="line"><span>' + label + '</span><b>' + v + '</b></div>'; };
    $('detail').innerHTML =
      '<button class="close" id="close-detail">Close x</button>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">Rank #' + r.rank + ' of ' + R.board_size + ' · ' + esc(r.category || 'Uncategorised') + ' · ' +
      (r.tier === 'watchlist' ? 'Watchlist (at or above the floor)' : 'Early find (below the floor)') + '</p>' +
      '<div class="big-label">Implied token value, model ' + esc(R.model_version) + '</div><div class="big">' + money(r.implied_value_usd) + '</div>' +
      '<div class="kv">' +
      '<div><span>TVL</span><b>' + money(r.tvl_usd) + '</b></div>' +
      '<div><span>7d TVL change</span><b>' + (r.change_7d == null ? '—' : r.change_7d.toFixed(1) + '%') + '</b></div>' +
      '<div><span>Tokenless for</span><b>' + ageText(r.age_days) + '</b></div>' +
      '<div><span>Chains</span><b>' + r.chains.length + '</b></div></div>' +
      '<div class="model-box"><h3>The working</h3>' +
      line('TVL x category multiple ' + m.category_multiple.toFixed(2) + 'x', money(base)) +
      line('x growth ' + m.growth_multiplier.toFixed(2) + ' (7d ' + (r.change_7d == null ? 'n/a' : r.change_7d.toFixed(1) + '%') + ')', money(base * m.growth_multiplier)) +
      line('x maturity ' + m.maturity_multiplier.toFixed(2) + ' (' + ageText(r.age_days) + ' tokenless)', money(base * m.growth_multiplier * m.maturity_multiplier)) +
      line('x reach ' + m.reach_multiplier.toFixed(2) + ' (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')', money(r.implied_value_usd)) +
      '<div class="line total"><span>Implied value</span><b>' + money(r.implied_value_usd) + '</b></div></div>' +
      '<p class="sub">The snapshot records no token for ' + esc(r.name) + ' — no market cap, no CoinGecko id, no symbol. ' +
      'Chains: ' + esc(r.chains.join(', ') || 'none named') + '. First tracked ' + esc(r.listed_at || 'on an unrecorded day') + '.</p>' +
      '<h3>How to farm it</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    $('detail').hidden = false;
    $('scrim').hidden = false;
    $('close-detail').addEventListener('click', closeDetail);
    if (location.hash.indexOf('p=' + slug) < 0) history.replaceState(null, '', '#p=' + slug);
  }
  function closeDetail() {
    $('detail').hidden = true;
    $('scrim').hidden = true;
    if (location.hash.indexOf('#p=') === 0) history.replaceState(null, '', '#');
  }
  $('scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });

  /* ---- wiring ---- */
  $('q').addEventListener('input', function () { state.q = this.value; render(); });
  $('cat').addEventListener('change', function () { state.cat = this.value; render(); });
  $('chain').addEventListener('change', function () { state.chain = this.value; render(); });
  $('sort').addEventListener('change', function () { state.sort = this.value; render(); });
  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (chip) {
    chip.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) { c.classList.remove('on'); });
      chip.classList.add('on');
      state.tier = chip.getAttribute('data-tier');
      render();
    });
  });

  $('foot').textContent = 'Data: ' + R.source + '. Board built by the ' + R.model_version +
    ' model from that snapshot alone; the page runs offline and calls nothing.';

  /* ---- deep links (also how the entry's screenshots are framed) ---- */
  var hash = location.hash.replace(/^#/, '');
  var params = {};
  hash.split('&').forEach(function (kv) { var p = kv.split('='); if (p.length === 2) params[p[0]] = decodeURIComponent(p[1]); });
  if (params.watch === '1') {
    state.tier = 'watchlist';
    Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
      c.classList.toggle('on', c.getAttribute('data-tier') === 'watchlist');
    });
  }
  if (params.cat) { state.cat = params.cat; $('cat').value = params.cat; }
  if (params.q) { state.q = params.q; $('q').value = params.q; }
  render();
  if (params.p && bySlug[params.p]) openDetail(params.p);
})();
