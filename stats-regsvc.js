(async () => {
  // Pin page width to the index page's rendered matrix width so both pages
  // share a horizontal boundary. Falls back to a sane default if the user
  // has not visited the matrix in this browser yet.
  const stored = parseInt(localStorage.getItem('arsm.matrixWidth') || '', 10);
  const pageW = Number.isFinite(stored) && stored > 400 ? stored : 820;
  for (const sel of ['header', '.controls', 'main', 'footer']) {
    const el = document.querySelector(sel);
    if (el) el.style.maxWidth = pageW + 'px';
  }

  const res = await fetch('data.json');
  if (!res.ok) { document.body.innerHTML = '<p>data.json missing.</p>'; return; }
  const data = await res.json();

  const totalServices = data.services.length;
  const counts = {};
  for (const r of data.regions) counts[r.code] = 0;
  for (const regions of Object.values(data.matrix)) {
    for (const code of regions) if (code in counts) counts[code]++;
  }

  const rows = data.regions.map(r => ({
    code: r.code,
    name: r.name,
    opt_in: !!r.opt_in,
    count: counts[r.code] || 0,
    pct: totalServices ? (counts[r.code] || 0) / totalServices : 0,
  }));

  document.getElementById('meta').textContent =
    `generated ${data.generated}  ·  ${totalServices} services  ·  ${data.regions.length} regions`;

  let sortKey = 'pct';
  let sortDir = -1; // -1 desc, 1 asc
  const sortDirEl = document.getElementById('sort-dir');
  const chartDir = () => sortDirEl.value === 'asc' ? 1 : -1;

  const scopeOf = () => document.querySelector('input[name=scope]:checked').value;
  const filtered = () => {
    const s = scopeOf();
    return rows.filter(r => s === 'all' || (s === 'optin' ? r.opt_in : !r.opt_in));
  };

  const renderTable = (list) => {
    const sorted = [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });
    const parts = ['<thead><tr>',
      `<th data-k="code">Region</th>`,
      `<th data-k="name">Name</th>`,
      `<th data-k="opt_in">Class</th>`,
      `<th class="num" data-k="count">Services</th>`,
      `<th class="num" data-k="pct">Completeness</th>`,
      `<th>Coverage</th>`,
      '</tr></thead><tbody>'];
    for (const r of sorted) {
      const pctStr = (r.pct * 100).toFixed(1) + '%';
      const barW = Math.round(r.pct * 160);
      parts.push(
        `<tr class="${r.opt_in ? 'optin' : ''}">`,
        `<td class="region"><code>${r.code}</code></td>`,
        `<td class="name">${r.name}</td>`,
        `<td>${r.opt_in ? 'opt-in' : 'default'}</td>`,
        `<td class="num">${r.count} / ${totalServices}</td>`,
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
        if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = (k === 'code' || k === 'name') ? 1 : -1; }
        renderTable(filtered());
      });
    }
  };

  const renderChart = (list) => {
    const dir = chartDir();
    const sorted = [...list].sort((a, b) => (b.pct - a.pct) * -dir);
    const svg = document.getElementById('chart');
    const n = sorted.length;
    const barH = 10;
    const rowH = 14;
    const marginLeft = 110;
    const marginRight = 56;
    const marginTop = 20;
    const marginBottom = 28;
    const chartWidth = 640;
    const innerWidth = chartWidth - marginLeft - marginRight;
    const plotHeight = n * rowH;
    const height = marginTop + marginBottom + plotHeight;

    svg.setAttribute('viewBox', `0 0 ${chartWidth} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

    const parts = [];

    // Alternating row stripes for readability (matches matrix row banding).
    sorted.forEach((_, i) => {
      if (i % 2 === 1) {
        parts.push(`<rect class="row-stripe" x="${marginLeft}" y="${marginTop + i * rowH}" width="${innerWidth}" height="${rowH}"/>`);
      }
    });

    // X-axis gridlines every 10%, major every 25%.
    for (let i = 0; i <= 10; i++) {
      const x = marginLeft + (innerWidth * i / 10);
      const major = i % 2.5 === 0;
      parts.push(`<line class="${major ? 'grid-major' : 'grid'}" x1="${x}" y1="${marginTop}" x2="${x}" y2="${marginTop + plotHeight}"/>`);
      if (i % 2.5 === 0) {
        parts.push(`<text class="tick-label" x="${x}" y="${marginTop + plotHeight + 14}" text-anchor="middle">${i * 10}%</text>`);
      }
    }
    // Axes.
    parts.push(`<line class="axis" x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${marginTop + plotHeight}"/>`);
    parts.push(`<line class="axis" x1="${marginLeft}" y1="${marginTop + plotHeight}" x2="${chartWidth - marginRight}" y2="${marginTop + plotHeight}"/>`);
    // Axis title.
    parts.push(`<text class="axis-title" x="${marginLeft + innerWidth / 2}" y="${height - 6}" text-anchor="middle">Completeness (services available ÷ total services)</text>`);

    sorted.forEach((r, i) => {
      const rowTop = marginTop + i * rowH;
      const y = rowTop + (rowH - barH) / 2;
      const w = Math.max(2, Math.round(r.pct * innerWidth));
      const cls = r.opt_in ? 'bar-optin' : 'bar-default';
      const labelCls = r.opt_in ? 'region-label optin' : 'region-label';
      const textY = y + barH - 3;
      const pct = (r.pct * 100).toFixed(1) + '%';
      parts.push(`<text class="${labelCls}" x="${marginLeft - 8}" y="${textY}" text-anchor="end">${r.code}</text>`);
      parts.push(`<rect class="${cls}" x="${marginLeft}" y="${y}" width="${w}" height="${barH}" rx="2" ry="2"><title>${r.code} — ${r.name}: ${r.count}/${totalServices} (${pct})</title></rect>`);
      // Value label inside bar if room, otherwise outside.
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
    renderChart(list);
    renderTable(list);
  };

  for (const el of document.querySelectorAll('input[name=scope]')) el.addEventListener('change', render);
  sortDirEl.addEventListener('change', () => {
    sortKey = 'pct';
    sortDir = chartDir();
    render();
  });
  render();
})();
