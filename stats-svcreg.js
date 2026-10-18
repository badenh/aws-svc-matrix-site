(async () => {
  const stored = parseInt(localStorage.getItem('arsm.matrixWidth') || '', 10);
  const pageW = Number.isFinite(stored) && stored > 400 ? stored : 820;
  for (const sel of ['header', '.controls', 'main', 'footer']) {
    const el = document.querySelector(sel);
    if (el) el.style.maxWidth = pageW + 'px';
  }

  const res = await fetch('data.json');
  if (!res.ok) { document.body.innerHTML = '<p>data.json missing.</p>'; return; }
  const data = await res.json();

  // Partition regions by class so coverage can be computed against a chosen basis.
  const regionClass = {}; // code -> 'default' | 'optin'
  for (const r of data.regions) regionClass[r.code] = r.opt_in ? 'optin' : 'default';
  const totalByScope = {
    all: data.regions.length,
    default: data.regions.filter(r => !r.opt_in).length,
    optin: data.regions.filter(r => r.opt_in).length,
  };

  // Pre-compute per-service region count for each scope.
  const rows = data.services.map(s => {
    const regs = data.matrix[s.slug] || [];
    let cAll = 0, cDef = 0, cOpt = 0;
    for (const code of regs) {
      const cls = regionClass[code];
      if (!cls) continue;
      cAll++;
      if (cls === 'optin') cOpt++; else cDef++;
    }
    return { slug: s.slug, name: s.name, category: s.category, counts: { all: cAll, default: cDef, optin: cOpt } };
  });

  document.getElementById('meta').textContent =
    `generated ${data.generated}  ·  ${data.services.length} services  ·  ${data.regions.length} regions`;

  // Populate category select.
  const cats = [...new Set(data.services.map(s => s.category))].sort();
  const catSel = document.getElementById('category');
  for (const c of cats) {
    const o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o);
  }

  const qEl = document.getElementById('q');
  const minEl = document.getElementById('pct-min');
  const maxEl = document.getElementById('pct-max');

  let sortKey = 'pct';
  let sortDir = -1;
  const sortDirEl = document.getElementById('sort-dir');
  const chartDir = () => sortDirEl.value === 'asc' ? 1 : -1;

  const scopeOf = () => document.querySelector('input[name=scope]:checked').value;

  const augment = (r, scope) => {
    const total = totalByScope[scope] || 1;
    const count = r.counts[scope];
    return { ...r, count, total, pct: count / total };
  };

  const filtered = () => {
    const scope = scopeOf();
    const cat = catSel.value;
    const q = qEl.value.trim().toLowerCase();
    let lo = parseInt(minEl.value, 10) / 100;
    let hi = parseInt(maxEl.value, 10) / 100;
    if (lo > hi) [lo, hi] = [hi, lo];
    return rows
      .filter(r => !cat || r.category === cat)
      .filter(r => !q || r.slug.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      .map(r => augment(r, scope))
      .filter(r => r.pct >= lo && r.pct <= hi);
  };

  const renderTable = (list) => {
    const sorted = [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });
    const parts = ['<thead><tr>',
      `<th data-k="name">Service</th>`,
      `<th data-k="category">Category</th>`,
      `<th class="num" data-k="count">Regions</th>`,
      `<th class="num" data-k="pct">Coverage</th>`,
      `<th>Coverage bar</th>`,
      '</tr></thead><tbody>'];
    for (const r of sorted) {
      const pctStr = (r.pct * 100).toFixed(1) + '%';
      const barW = Math.round(r.pct * 160);
      parts.push(
        `<tr class="svcreg">`,
        `<td class="name"><div class="svc-cell"><span class="svc-title">${r.name}</span><code class="svc-slug">${r.slug}</code></div></td>`,
        `<td><span class="cat-tag">${r.category}</span></td>`,
        `<td class="num">${r.count} / ${r.total}</td>`,
        `<td class="num">${pctStr}</td>`,
        `<td class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${barW}px"></div></div></td>`,
        '</tr>');
    }
    parts.push('</tbody>');
    const table = document.getElementById('stats-table');
    table.innerHTML = parts.join('');
    for (const th of table.querySelectorAll('thead th[data-k]')) {
      th.addEventListener('click', () => {
        const k = th.dataset.k;
        if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = (k === 'name' || k === 'category') ? 1 : -1; }
        renderTable(filtered());
      });
    }
  };

  const renderChart = (list) => {
    const dir = chartDir();
    const sorted = [...list].sort((a, b) => (b.pct - a.pct) * -dir);
    // Flag services whose display name collides inside the current list, so
    // the chart label can disambiguate by slug.
    const nameCounts = {};
    for (const r of sorted) nameCounts[r.name] = (nameCounts[r.name] || 0) + 1;
    const svg = document.getElementById('chart');
    const n = sorted.length;
    const barH = 10;
    const rowH = 14;
    const marginLeft = 220;
    const marginRight = 56;
    const marginTop = 20;
    const marginBottom = 28;
    const chartWidth = 820;
    const innerWidth = chartWidth - marginLeft - marginRight;
    const plotHeight = n * rowH;
    const height = marginTop + marginBottom + plotHeight;

    svg.setAttribute('viewBox', `0 0 ${chartWidth} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

    const parts = [];

    sorted.forEach((_, i) => {
      if (i % 2 === 1) {
        parts.push(`<rect class="row-stripe" x="${marginLeft}" y="${marginTop + i * rowH}" width="${innerWidth}" height="${rowH}"/>`);
      }
    });

    for (let i = 0; i <= 10; i++) {
      const x = marginLeft + (innerWidth * i / 10);
      const major = i % 2.5 === 0;
      parts.push(`<line class="${major ? 'grid-major' : 'grid'}" x1="${x}" y1="${marginTop}" x2="${x}" y2="${marginTop + plotHeight}"/>`);
      if (i % 2.5 === 0) {
        parts.push(`<text class="tick-label" x="${x}" y="${marginTop + plotHeight + 14}" text-anchor="middle">${i * 10}%</text>`);
      }
    }
    parts.push(`<line class="axis" x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${marginTop + plotHeight}"/>`);
    parts.push(`<line class="axis" x1="${marginLeft}" y1="${marginTop + plotHeight}" x2="${chartWidth - marginRight}" y2="${marginTop + plotHeight}"/>`);
    const scope = scopeOf();
    const basis = scope === 'default' ? 'default regions' : scope === 'optin' ? 'opt-in regions' : 'all regions';
    parts.push(`<text class="axis-title" x="${marginLeft + innerWidth / 2}" y="${height - 6}" text-anchor="middle">Coverage (regions available ÷ ${basis})</text>`);

    sorted.forEach((r, i) => {
      const rowTop = marginTop + i * rowH;
      const y = rowTop + (rowH - barH) / 2;
      const w = r.count === 0 ? 0 : Math.max(2, Math.round(r.pct * innerWidth));
      const textY = y + barH - 3;
      const pct = (r.pct * 100).toFixed(1) + '%';
      // Truncate long service names to fit the left margin label area.
      let displayName = r.name;
      if (nameCounts[r.name] > 1) displayName = `${r.name} (${r.slug})`;
      const labelText = displayName.length > 32 ? displayName.slice(0, 31) + '…' : displayName;
      parts.push(`<text class="region-label" x="${marginLeft - 8}" y="${textY}" text-anchor="end">${labelText}</text>`);
      parts.push(`<rect class="bar-svc" x="${marginLeft}" y="${y}" width="${w}" height="${barH}" rx="2" ry="2"><title>${r.name} (${r.slug}): ${r.count}/${r.total} (${pct})</title></rect>`);
      if (w > 42) {
        parts.push(`<text class="value-label inside" x="${marginLeft + w - 4}" y="${textY}" text-anchor="end">${pct}</text>`);
      } else {
        parts.push(`<text class="value-label" x="${marginLeft + w + 4}" y="${textY}">${pct}</text>`);
      }
    });

    svg.innerHTML = parts.join('');
  };

  const render = () => {
    const list = filtered();
    if (!list.length) {
      document.getElementById('chart').innerHTML = '';
      document.getElementById('stats-table').innerHTML = '<tbody><tr><td>No services match.</td></tr></tbody>';
      return;
    }
    renderChart(list);
    renderTable(list);
  };

  for (const el of document.querySelectorAll('input[name=scope]')) el.addEventListener('change', render);
  catSel.addEventListener('change', render);
  qEl.addEventListener('input', render);
  minEl.addEventListener('change', render);
  maxEl.addEventListener('change', render);
  sortDirEl.addEventListener('change', () => {
    sortKey = 'pct';
    sortDir = chartDir();
    render();
  });
  render();
})();
