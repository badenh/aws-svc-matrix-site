(async () => {
  const mode = window.__LAUNCH_MODE__ === 'region' ? 'region' : 'service';

  // Pin page width to the index matrix width if we know it, for consistency.
  const stored = parseInt(localStorage.getItem('arsm.matrixWidth') || '', 10);
  const pageW = Number.isFinite(stored) && stored > 400 ? stored : 820;
  for (const sel of ['header', '.controls', 'main', 'footer']) {
    const el = document.querySelector(sel);
    if (el) el.style.maxWidth = pageW + 'px';
  }

  const [dataRes, tlRes] = await Promise.all([fetch('data.json'), fetch('timeline.json')]);
  if (!dataRes.ok) { document.body.innerHTML = '<p>data.json missing.</p>'; return; }
  if (!tlRes.ok) { document.body.innerHTML = '<p>timeline.json missing — run collector/merge.py.</p>'; return; }
  const data = await dataRes.json();
  const timeline = await tlRes.json();

  // Lookup tables for service/region metadata.
  const svcBySlug = Object.fromEntries(data.services.map(s => [s.slug, s]));
  const regByCode = Object.fromEntries(data.regions.map(r => [r.code, r]));

  const meta = document.getElementById('meta');
  const addCount = timeline.events.filter(e => e.action === 'add').length;
  const remCount = timeline.events.filter(e => e.action === 'remove').length;
  meta.textContent =
    `baseline ${timeline.baseline_date}  ·  latest ${timeline.latest_date}  ·  ${timeline.events.length} events (+${addCount} / -${remCount})`;

  const qEl = document.getElementById('q');
  const actEl = document.getElementById('action');
  const catEl = document.getElementById('category'); // service page only
  if (catEl) {
    const cats = [...new Set(data.services.map(s => s.category))].sort();
    for (const c of cats) {
      const o = document.createElement('option'); o.value = c; o.textContent = c; catEl.appendChild(o);
    }
  }
  const fromEl = document.getElementById('from');
  const toEl = document.getElementById('to');
  const resetBtn = document.getElementById('reset-dates');
  const scopeRadios = document.querySelectorAll('input[name=region-filter]');

  fromEl.min = timeline.baseline_date;
  fromEl.max = timeline.latest_date;
  toEl.min = timeline.baseline_date;
  toEl.max = timeline.latest_date;

  resetBtn.addEventListener('click', () => { fromEl.value = ''; toEl.value = ''; render(); });

  const scopeOf = () => {
    for (const r of scopeRadios) if (r.checked) return r.value;
    return 'all';
  };

  const render = () => {
    const q = qEl.value.trim().toLowerCase();
    const act = actEl.value;
    const from = fromEl.value || timeline.baseline_date;
    const to = toEl.value || timeline.latest_date;
    const scope = scopeOf();

    // Filter events by action and date window first.
    const events = timeline.events.filter(e => {
      if (act !== 'any' && e.action !== act) return false;
      if (e.date < from || e.date > to) return false;
      return true;
    });

    // Group by primary axis (service slug or region code).
    const groups = new Map();
    for (const e of events) {
      const key = mode === 'service' ? e.service : e.region;
      // Scope filter only applies in region mode.
      if (mode === 'region') {
        const reg = regByCode[key];
        if (!reg) continue;
        if (scope !== 'all' && (scope === 'optin' ? !reg.opt_in : reg.opt_in)) continue;
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }

    // Category filter (service mode only).
    const cat = catEl ? catEl.value : '';

    // Text search filter applies on group key + display name.
    let groupKeys = [...groups.keys()];
    if (mode === 'service' && cat) {
      groupKeys = groupKeys.filter(k => (svcBySlug[k]?.category || '') === cat);
    }
    if (q) {
      groupKeys = groupKeys.filter(k => {
        if (mode === 'service') {
          const s = svcBySlug[k];
          const name = (s?.name || '').toLowerCase();
          return k.toLowerCase().includes(q) || name.includes(q);
        }
        const r = regByCode[k];
        const name = (r?.name || '').toLowerCase();
        return k.toLowerCase().includes(q) || name.includes(q);
      });
    }

    // Sort groups by most recent event date desc, then by group key.
    groupKeys.sort((a, b) => {
      const la = groups.get(a).reduce((d, e) => e.date > d ? e.date : d, '');
      const lb = groups.get(b).reduce((d, e) => e.date > d ? e.date : d, '');
      if (la !== lb) return la < lb ? 1 : -1;
      return a < b ? -1 : 1;
    });

    const feed = document.getElementById('feed');
    if (!groupKeys.length) {
      feed.innerHTML = '<p class="feed-empty">No events match the current filters.</p>';
      return;
    }

    const totalEvt = groupKeys.reduce((n, k) => n + groups.get(k).length, 0);
    const parts = [`<p class="feed-stats">${groupKeys.length} ${mode === 'service' ? 'service' : 'region'}${groupKeys.length === 1 ? '' : 's'} · ${totalEvt} event${totalEvt === 1 ? '' : 's'} shown</p>`];

    for (const key of groupKeys) {
      const evts = groups.get(key).slice().sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
      const adds = evts.filter(e => e.action === 'add').length;
      const rems = evts.filter(e => e.action === 'remove').length;
      let title, slugLine, optin = false;
      if (mode === 'service') {
        const s = svcBySlug[key];
        title = s?.name || key;
        slugLine = `<span class="grp-slug">${key}</span>`;
      } else {
        const r = regByCode[key];
        title = r?.name || key;
        optin = !!r?.opt_in;
        slugLine = `<span class="grp-code">${key}${optin ? ' (opt-in)' : ''}</span>`;
      }
      parts.push(
        `<details class="feed-group${optin ? ' optin' : ''}" open>`,
        `<summary><span class="grp-title">${title}</span>${slugLine}<span class="grp-meta">+${adds} / -${rems}  ·  ${evts.length} event${evts.length === 1 ? '' : 's'}  ·  latest ${evts[0].date}</span></summary>`,
        `<ul class="feed-events">`
      );
      for (const e of evts) {
        const subKey = mode === 'service' ? e.region : e.service;
        let subLabel;
        if (mode === 'service') {
          const r = regByCode[subKey];
          const nm = r?.name || subKey;
          const cls = r?.opt_in ? ' optin-swatch' : '';
          subLabel = `<span class="evt-sub"><span class="${cls.trim()}">${subKey}</span> — ${nm}</span>`;
        } else {
          const s = svcBySlug[subKey];
          const nm = s?.name || subKey;
          subLabel = `<span class="evt-sub">${nm}<code>${subKey}</code></span>`;
        }
        parts.push(`<li><span class="evt-date">${e.date}</span><span class="evt-tag ${e.action}">${e.action}</span>${subLabel}</li>`);
      }
      parts.push(`</ul></details>`);
    }

    feed.innerHTML = parts.join('');
  };

  qEl.addEventListener('input', render);
  actEl.addEventListener('change', render);
  if (catEl) catEl.addEventListener('change', render);
  fromEl.addEventListener('change', render);
  toEl.addEventListener('change', render);
  for (const r of scopeRadios) r.addEventListener('change', render);
  render();
})();
