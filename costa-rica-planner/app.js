/* Pura Vida Planner: all numbers live in data.json; this file only does math + rendering. */
(function () {
  "use strict";

  const CATS = [
    { id: "flights",    label: "Flights",    emoji: "✈️", color: "#7c4dff" },
    { id: "housing",    label: "Housing",    emoji: "🛏️", color: "#0288d1" },
    { id: "food",       label: "Food",       emoji: "🍛", color: "#ff9800" },
    { id: "alcohol",    label: "Alcohol",    emoji: "🍺", color: "#f9c80e" },
    { id: "moped",      label: "Moped",      emoji: "🛵", color: "#e53935" },
    { id: "activities", label: "Activities", emoji: "🎟️", color: "#1b8a4b" },
    { id: "transport",  label: "Transport",  emoji: "🚌", color: "#00acc1" },
    { id: "extras",     label: "Extras",     emoji: "🧴", color: "#8d6e63" },
    { id: "buffer",     label: "10% buffer", emoji: "🛟", color: "#90a4ae" }
  ];
  const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));
  const LS = { state: "crp-state-v1", exp: "crp-expenses-v1", checks: "crp-checks-v1", names: "crp-names-v1" };

  let D = null;            // data.json
  let S = null;            // user settings
  let charts = {};
  let map = null;
  let srcIndex = {};       // source id -> number

  /* ---------- helpers ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const load = (k, dflt) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
  const round = n => Math.round(n * 100) / 100;

  function fmt(usd, opts) {
    opts = opts || {};
    if (S.currency === "CRC") {
      return "₡" + Math.round(usd * S.fx).toLocaleString("en-US");
    }
    const digits = opts.cents && Math.abs(usd) < 100 && usd % 1 ? 2 : 0;
    return "$" + usd.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function srcLinks(ids) {
    if (!ids || !ids.length) return "";
    return '<span class="src-links">' + ids.map(id => {
      const s = D.sources.find(x => x.id === id);
      return s ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">[${srcIndex[id]}]</a>` : "";
    }).join("") + "</span>";
  }
  const estTag = est => est ? '<span class="tag">estimate</span>' : '<span class="tag ok">sourced</span>';
  const region = id => D.regions.find(r => r.id === id);
  const dateLabel = iso => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  function defaults() {
    return {
      tier: D.meta.defaultTier,
      beers: D.alcohol.beersPerDayDefault,
      mopedDays: D.moped.defaultDays,
      paidActs: D.defaultPaidActivities,
      budget: D.meta.defaultBudget,
      flight: D.flights.chosen,
      currency: "USD",
      fx: D.meta.exchangeRate.usdToCrc
    };
  }

  /* ---------- the cost model ---------- */
  function compute(set) {
    const n = D.meta.travelers;
    const tier = D.tiers[set.tier];
    const flight = D.flights.options.find(f => f.id === set.flight) || D.flights.options[0];
    const enabledActs = new Set(D.activities.slice().sort((a, b) => a.priority - b.priority).slice(0, set.paidActs).map(a => a.id));
    const mopedSet = new Set(D.moped.dayPriority.slice(0, set.mopedDays));
    const beachDays = D.days.filter(d => d.region === "manuel" || d.region === "uvita").map(d => d.day);
    const lastDay = D.days.length;
    const A = D.alcohol;

    const days = D.days.map(d => {
      const c = Object.fromEntries(CATS.map(k => [k.id, 0]));
      const lines = [];
      // flights split between departure & return day
      if (d.day === 1 || d.day === lastDay) {
        c.flights += (flight.pp + (flight.extraPp || 0)) * n / 2;
      }
      // housing (night of this day)
      if (d.day < lastDay) {
        const l = region(d.region).lodging[tier.lodgingKey];
        c.housing += l.perNight;
      }
      // food
      c.food += D.food.perPersonDay[set.tier] * n * (d.day === lastDay ? 0.5 : 1);
      if (d.nicerDinner) c.food += D.food.nicerDinner.pp * n;
      // alcohol
      if (set.beers > 0 && d.day < lastDay) {
        const beer = A.barShare * A.barBeer.price + (1 - A.barShare) * A.marketBeer.price;
        c.alcohol += set.beers * n * beer;
        if (d.day === 3 || d.day === 10) c.alcohol += A.guaro.price * A.guaro.bottles / 2;
        if (beachDays.includes(d.day)) c.alcohol += A.cocktail.price * A.cocktail.perPersonTrip * n / beachDays.length;
      }
      // moped
      if (mopedSet.has(d.day)) c.moped += D.moped.dailyRate + D.moped.insurancePerDay + D.moped.gasPerDay;
      // activities
      (d.activities || []).forEach(id => {
        const a = D.activities.find(x => x.id === id);
        if (a && enabledActs.has(id)) { c.activities += a.pp * n; lines.push(a.name); }
      });
      // transport
      if (d.leg) {
        const leg = D.legs.find(l => l.id === d.leg);
        const mode = leg.modes[leg.tierMode[set.tier]];
        c.transport += mode.pp * n;
      }
      if (d.day > 1 && d.day < lastDay) c.transport += D.localTransport.perDayFor2;
      if (d.day === 1) c.transport += D.flights.transfers[0].perCar;
      if (d.day === lastDay) c.transport += D.flights.transfers[1].perCar;
      // extras
      D.extras.filter(e => e.day === d.day).forEach(e => { c.extras += e.amount * (e.per === "person" ? n : 1); });
      return { day: d.day, region: d.region, c, moped: mopedSet.has(d.day), acts: lines };
    });

    // buffer: % of everything, spread evenly
    const sub = days.reduce((s, d) => s + CATS.reduce((t, k) => t + d.c[k.id], 0), 0);
    const buffer = sub * D.bufferPct / 100;
    days.forEach(d => { d.c.buffer = buffer / days.length; d.total = CATS.reduce((t, k) => t + d.c[k.id], 0); });

    const cats = Object.fromEntries(CATS.map(k => [k.id, days.reduce((s, d) => s + d.c[k.id], 0)]));
    const total = Object.values(cats).reduce((a, b) => a + b, 0);
    const regions = {};
    days.forEach(d => {
      const v = d.total - d.c.flights - d.c.buffer;
      regions[d.region] = (regions[d.region] || 0) + v;
    });
    return { days, cats, total, regions, enabledActs, mopedSet, flight };
  }

  /* ---------- rendering ---------- */
  let R = null;
  function recalc() {
    save(LS.state, S);
    R = compute(S);
    renderHeader();
    renderControls();
    renderCatTable();
    renderCharts();
    renderDrivers();
    renderDays();
    renderLegTable();
    renderFlightTable();
    renderMopedCosts();
    renderPriceSources();
    renderAlcohol();
    renderFoodRef();
    renderSettle();
  }

  function renderHeader() {
    $("totalAll").textContent = fmt(R.total);
    $("totalPP").textContent = fmt(R.total / D.meta.travelers);
    const diff = S.budget - R.total;
    const box = $("budgetStat");
    box.classList.toggle("over", diff < 0);
    box.classList.toggle("under", diff >= 0);
    $("budgetLabel").textContent = diff >= 0 ? "🟢 Under budget by" : "🔴 Over budget by";
    $("budgetDiff").textContent = fmt(Math.abs(diff));
    $("meterFill").style.width = Math.min(100, S.budget ? (R.total / S.budget) * 100 : 100) + "%";
    $("curUSD").classList.toggle("active", S.currency === "USD");
    $("curCRC").classList.toggle("active", S.currency === "CRC");
    $("fxNote").textContent = "💱 Exchange rate (editable): " + D.meta.exchangeRate.label.replace(/₡455/, "₡" + S.fx);
  }

  function renderControls() {
    $("budgetInput").value = S.budget;
    $("beersSlider").value = S.beers; $("beersVal").textContent = S.beers;
    $("mopedSlider").value = S.mopedDays; $("mopedVal").textContent = S.mopedDays + (S.mopedDays ? " (Days " + D.moped.dayPriority.slice(0, S.mopedDays).sort((a, b) => a - b).join(", ") + ")" : "");
    $("actSlider").max = D.activities.length;
    $("actSlider").value = S.paidActs; $("actVal").textContent = S.paidActs + " of " + D.activities.length;
    $("flightSelect").value = S.flight;
    $("fxRate").value = S.fx;
    document.querySelectorAll("#tierToggle button").forEach(b => b.classList.toggle("active", b.dataset.tier === S.tier));
    $("tierDesc").textContent = D.tiers[S.tier].desc;
  }

  function renderCatTable() {
    const rows = CATS.map(k => `<tr><td><span class="cat-dot" style="background:${k.color}"></span>${k.emoji} ${k.label}</td>
      <td class="num">${fmt(R.cats[k.id])}</td><td class="num">${fmt(R.cats[k.id] / D.meta.travelers)}</td>
      <td class="num">${R.total ? Math.round(R.cats[k.id] / R.total * 100) : 0}%</td></tr>`).join("");
    $("catTable").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">For 2</th><th class="num">Per person</th><th class="num">Share</th></tr></thead>
      <tbody>${rows}<tr class="total"><td>Total</td><td class="num">${fmt(R.total)}</td><td class="num">${fmt(R.total / D.meta.travelers)}</td><td class="num">100%</td></tr></tbody></table></div>`;
  }

  function conv(v) { return S.currency === "CRC" ? Math.round(v * S.fx) : round(v); }
  const tickFmt = v => (S.currency === "CRC" ? "₡" : "$") + Number(v).toLocaleString("en-US");

  function renderCharts() {
    if (!window.Chart) return;
    Chart.defaults.font.family = "Nunito, system-ui, sans-serif";
    Chart.defaults.font.weight = 600;
    Chart.defaults.color = "#3d544d";
    const tip = { callbacks: { label: ctx => ` ${ctx.dataset.label ? ctx.dataset.label + ": " : ""}${tickFmt(ctx.parsed.y != null ? ctx.parsed.y : ctx.parsed)}` } };
    const dayLabels = D.days.map(d => "D" + d.day);

    // donut
    upsert("donutChart", {
      type: "doughnut",
      data: { labels: CATS.map(k => k.emoji + " " + k.label), datasets: [{ data: CATS.map(k => conv(R.cats[k.id])), backgroundColor: CATS.map(k => k.color), borderColor: "#fff", borderWidth: 3 }] },
      options: { maintainAspectRatio: false, cutout: "58%", plugins: { legend: { position: "right", labels: { boxWidth: 14 } }, tooltip: { callbacks: { label: ctx => " " + ctx.label + ": " + tickFmt(ctx.parsed) } } } }
    });
    // stacked daily
    upsert("dailyChart", {
      type: "bar",
      data: { labels: dayLabels, datasets: CATS.map(k => ({ label: k.emoji + " " + k.label, data: R.days.map(d => conv(d.c[k.id])), backgroundColor: k.color, borderRadius: 4, stack: "s" })) },
      options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: tickFmt } } }, plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } }, tooltip: { mode: "index", ...tip } } }
    });
    // cumulative vs cap
    let run = 0;
    const cum = R.days.map(d => (run += d.total, conv(run)));
    upsert("cumChart", {
      type: "line",
      data: { labels: dayLabels, datasets: [
        { label: "Running total", data: cum, borderColor: "#0288d1", backgroundColor: "rgba(2,136,209,.15)", fill: true, tension: .3, pointRadius: 4, pointBackgroundColor: cum.map(v => v > conv(S.budget) ? "#e53935" : "#0288d1") },
        { label: "Budget cap", data: dayLabels.map(() => conv(S.budget)), borderColor: "#e53935", borderDash: [8, 6], pointRadius: 0, fill: false }
      ] },
      options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: tickFmt } }, x: { grid: { display: false } } }, plugins: { legend: { position: "bottom" }, tooltip: tip } }
    });
    // per region
    const regIds = D.regions.map(r => r.id);
    upsert("regionChart", {
      type: "bar",
      data: { labels: D.regions.map(r => r.emoji + " " + r.short), datasets: [{ label: "Cost", data: regIds.map(id => conv(R.regions[id] || 0)), backgroundColor: D.regions.map(r => r.color), borderRadius: 10 }] },
      options: { maintainAspectRatio: false, indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => " " + tickFmt(ctx.parsed.x) } } }, scales: { x: { ticks: { callback: tickFmt } }, y: { grid: { display: false } } } }
    });
    // splurge vs save
    const cheap = compute({ ...S, tier: "budget", beers: 0, mopedDays: 0, paidActs: 4 });
    const cats = CATS.filter(k => k.id !== "buffer" && k.id !== "flights");
    upsert("splurgeChart", {
      type: "bar",
      data: { labels: cats.map(k => k.emoji + " " + k.label), datasets: [
        { label: "🪙 Save (bare minimum)", data: cats.map(k => conv(Math.min(cheap.cats[k.id], R.cats[k.id]))), backgroundColor: "#1b8a4b", borderRadius: 6, stack: "x" },
        { label: "🤑 Splurge (your extras)", data: cats.map(k => conv(Math.max(0, R.cats[k.id] - cheap.cats[k.id]))), backgroundColor: "#ff7a1a", borderRadius: 6, stack: "x" }
      ] },
      options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: tickFmt } } }, plugins: { legend: { position: "bottom" }, tooltip: { mode: "index", ...tip } } }
    });
  }
  function upsert(id, cfg) {
    if (charts[id]) { charts[id].data = cfg.data; charts[id].options = cfg.options; charts[id].update(); return; }
    charts[id] = new Chart($(id), cfg);
  }

  function renderDrivers() {
    const sorted = CATS.filter(k => k.id !== "buffer").map(k => [k, R.cats[k.id]]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const cheap = compute({ ...S, tier: "budget", beers: 0, mopedDays: 0, paidActs: 4 });
    $("drivers").innerHTML = sorted.map(([k, v]) => `<li>${k.emoji} <b>${k.label}</b>: ${fmt(v)} (${Math.round(v / R.total * 100)}%)</li>`).join("") +
      `<li style="list-style:none;margin-top:8px" class="muted">💡 The bare-minimum version of this trip (same flights) costs about <b>${fmt(cheap.total)}</b>, ${fmt(R.total - cheap.total)} less than your current settings.</li>`;
  }

  function renderDays() {
    const tier = D.tiers[S.tier];
    $("dayCards").innerHTML = D.days.map((d, i) => {
      const r = region(d.region);
      const rd = R.days[i];
      const lodging = d.day < D.days.length ? r.lodging[tier.lodgingKey] : null;
      const acts = (d.activities || []).map(id => {
        const a = D.activities.find(x => x.id === id);
        const on = R.enabledActs.has(id);
        return `<li class="${on ? "" : "off"}">${a.emoji} ${esc(a.name)}: ${fmt(a.pp * D.meta.travelers)} for 2${on ? "" : " (off, raise the activities slider)"}</li>`;
      }).join("");
      let legHtml = "";
      if (d.leg) {
        const leg = D.legs.find(l => l.id === d.leg);
        const m = leg.modes[leg.tierMode[S.tier]];
        legHtml = `<div class="meta">🚌 ${esc(m.label)} · ${esc(leg.drive)} · ${fmt(m.pp * D.meta.travelers)} for 2</div>`;
      }
      return `<article class="day">
        <div class="day-head" style="background:linear-gradient(110deg, ${r.color}, ${shade(r.color)})">
          <div><div class="d">Day ${d.day} · ${r.emoji} ${esc(r.short)}</div><div class="date">${dateLabel(d.date)}</div></div>
          <div class="day-cost" title="Estimated cost for 2 (incl. share of buffer)">${fmt(rd.total)}</div>
        </div>
        <div class="day-body">
          <div>${rd.moped ? '<span class="badge">🛵 Moped day</span>' : ""}${d.nicerDinner ? '<span class="badge blue">🍽️ Nicer dinner</span>' : ""}</div>
          <div class="slot"><span>🌅</span><div><b>Morning</b>${esc(d.morning)}</div></div>
          <div class="slot"><span>☀️</span><div><b>Afternoon</b>${esc(d.afternoon)}</div></div>
          <div class="slot"><span>🌙</span><div><b>Evening</b>${esc(d.evening)}</div></div>
          ${acts ? `<ul class="act-list">${acts}</ul>` : ""}
          <div class="meta">🛏️ ${esc(d.sleep)}${lodging ? ` · ${fmt(lodging.perNight)}/night (${tier.label.toLowerCase()})` : ""}</div>
          <div class="meta">🍛 ${esc(d.food)}</div>
          <div class="meta">🚦 ${esc(d.transport)}</div>
          ${legHtml}
          <div class="rain">🌧️ <b>Rain plan:</b> ${esc(d.rain.note)} <br>☂️ <b>Backup:</b> ${esc(d.rain.backup)}</div>
        </div>
      </article>`;
    }).join("");
  }
  function shade(hex) {
    const n = parseInt(hex.slice(1), 16);
    const f = v => Math.max(0, Math.min(255, Math.round(v * 0.7 + 255 * 0.3 * 0.4)));
    return "#" + [n >> 16, (n >> 8) & 255, n & 255].map(v => f(v).toString(16).padStart(2, "0")).join("");
  }

  function renderLegTable() {
    $("legTable").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Leg</th><th>Day</th><th>Time</th><th>Your mode (${D.tiers[S.tier].label})</th><th class="num">Bus/cheap pp</th><th class="num">Shuttle pp</th></tr></thead><tbody>` +
      D.legs.map((l, i) => {
        const m = l.modes[l.tierMode[S.tier]];
        return `<tr><td><b>${i + 1}.</b> ${esc(region(l.from).short)} → ${esc(region(l.to).short)}</td><td>${l.day}</td><td>${esc(l.drive)}</td>
        <td>${esc(m.label)}</td>
        <td class="num">${fmt(l.modes.bus.pp, { cents: 1 })}${l.modes.bus.estimate ? '<span class="tag">est.</span>' : ""}${srcLinks(l.modes.bus.src)}</td>
        <td class="num">${fmt(l.modes.shuttle.pp, { cents: 1 })}${l.modes.shuttle.estimate ? '<span class="tag">est.</span>' : ""}${srcLinks(l.modes.shuttle.src)}</td></tr>`;
      }).join("") + `</tbody></table></div>`;
  }

  function renderFlightTable() {
    $("flightTable").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Route</th><th class="num">Planning pp</th><th class="num">Seen range</th><th>Notes</th></tr></thead><tbody>` +
      D.flights.options.map(f => `<tr${f.id === S.flight ? ' style="background:#eef8f2"' : ""}><td><b>${esc(f.route)}</b>${f.recommended ? ' <span class="tag ok">recommended</span>' : ""}</td>
        <td class="num">${fmt(f.pp + (f.extraPp || 0))}${f.extraPp ? "<br><small>incl. " + fmt(f.extraPp) + " to reach JFK</small>" : ""}</td>
        <td class="num">${fmt(f.low)}–${fmt(f.high)}</td><td>${esc(f.note)} ${srcLinks(f.src)}</td></tr>`).join("") +
      `</tbody></table></div><p class="muted">May 2027 fares aren't bookable yet, so these are recent fare snapshots. Set Google Flights / Kayak alerts now. The airport transfer (SJO ↔ Alajuela) is ${fmt(D.flights.transfers[0].perCar)} / ${fmt(D.flights.transfers[1].perCar)} per car <span class="tag">estimate</span> ${srcLinks(D.flights.transfers[0].src)}</p>`;
  }

  /* ---------- map ---------- */
  function initMap() {
    if (map) { map.invalidateSize(); return; }
    const pts = D.stops.map(s => region(s.region));
    if (!window.L) return svgMap(pts);
    map = L.map("map", { scrollWheelZoom: false });
    const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap contributors" }).addTo(map);
    let tileErrors = 0;
    tiles.on("tileerror", () => { if (++tileErrors === 6) $("mapFallback").hidden = false, svgMap(pts, true); });
    const latlngs = [];
    D.stops.forEach((s, i) => {
      const r = region(s.region);
      const ll = [r.lat + (i === 5 ? -0.03 : 0), r.lng + (i === 5 ? 0.03 : 0)];
      latlngs.push(ll);
      L.marker(ll, { icon: L.divIcon({ className: "num-marker", html: String(s.n), iconSize: [34, 34] }) })
        .addTo(map).bindPopup(`<b>${s.n}. ${r.emoji} ${esc(r.name)}</b><br>${esc(s.days)} · ${s.nights} night${s.nights > 1 ? "s" : ""}`);
    });
    D.legs.forEach((l, i) => {
      const a = region(l.from), b = region(l.to);
      const line = [[a.lat, a.lng], [b.lat, b.lng]];
      L.polyline(line, { color: ["#ff7a1a", "#1b8a4b", "#0288d1", "#00897b", "#7c4dff"][i], weight: 5, dashArray: "10 8", opacity: .9 }).addTo(map);
      const mid = [(a.lat + b.lat) / 2, (a.lng + b.lng) / 2];
      L.marker(mid, { icon: L.divIcon({ className: "", html: `<span class="leg-label">Leg ${i + 1}: ${esc(l.drive.split("·")[0].trim())}</span>`, iconSize: null }) }).addTo(map);
    });
    L.marker([D.regions[0].lat - 0.02, D.regions[0].lng - 0.01], { icon: L.divIcon({ className: "", html: '<span class="leg-label">✈️ SJO</span>' }) }).addTo(map);
    map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
  }
  function svgMap(pts, keepLeaflet) {
    // Simple offline fallback: plot stops by lat/lng (no coastline).
    const W = 600, H = 520, minLat = 8.9, maxLat = 10.8, minLng = -85.2, maxLng = -83.5;
    const x = lng => (lng - minLng) / (maxLng - minLng) * W, y = lat => H - (lat - minLat) / (maxLat - minLat) * H;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Route sketch"><text x="16" y="28" font-weight="800" fill="#01579b">Offline route sketch (map tiles unavailable)</text>`;
    D.legs.forEach(l => { const a = region(l.from), b = region(l.to); s += `<line x1="${x(a.lng)}" y1="${y(a.lat)}" x2="${x(b.lng)}" y2="${y(b.lat)}" stroke="#ff7a1a" stroke-width="4" stroke-dasharray="10 8"/>`; });
    D.stops.slice(0, 5).forEach(st => { const r = region(st.region); s += `<circle cx="${x(r.lng)}" cy="${y(r.lat)}" r="16" fill="#ff7a1a" stroke="#fff" stroke-width="3"/><text x="${x(r.lng)}" y="${y(r.lat) + 5}" text-anchor="middle" fill="#fff" font-weight="800">${st.n}</text><text x="${x(r.lng) + 22}" y="${y(r.lat) + 5}" font-weight="800" fill="#17302a">${esc(r.short)}</text>`; });
    s += `<text x="16" y="${H - 16}" fill="#5b6f69">Pacific Ocean ↙</text></svg>`;
    $("mapFallback").innerHTML = s; $("mapFallback").hidden = false;
    if (!keepLeaflet) $("map").style.display = "none";
  }

  /* ---------- moped / save / sources ---------- */
  function renderMopedStatic() {
    const M = D.moped;
    $("safetyNote").innerHTML = esc(M.safetyNote);
    $("mopedRules").innerHTML = M.rules.map(r => `<li>${esc(r)}</li>`).join("");
    $("mopedGood").innerHTML = M.goodIdea.map(r => `<li>${esc(r)}</li>`).join("");
    $("mopedBad").innerHTML = M.shuttleBetter.map(r => `<li>${esc(r)}</li>`).join("");
  }
  function renderMopedCosts() {
    const M = D.moped, perDay = M.dailyRate + M.insurancePerDay + M.gasPerDay;
    $("mopedCosts").innerHTML = `
      <li><b>Rental:</b> ${fmt(M.dailyRate)}/day. ${esc(M.dailyRateNote)} ${srcLinks(["localbird-scooter", "riderly-quepos"])}</li>
      <li><b>Insurance:</b> ${fmt(M.insurancePerDay)}/day. ${esc(M.insuranceNote)} ${srcLinks(["bikesbooking-sj"])}</li>
      <li><b>Gas:</b> ${fmt(M.gasPerDay)}/day. ${esc(M.gasNote)}</li>
      <li><b>Deposit:</b> ${esc(M.deposit)} ${srcLinks(["riderly-quepos"])}</li>
      <li><b>Weekly / multi-day:</b> ${esc(M.weekly)} ${srcLinks(["tripadvisor-mango"])}</li>
      <li><b>ATV:</b> ${esc(M.atv)} ${srcLinks(["fourtrax", "midworld-atv"])}</li>
      <li><b>Your plan:</b> ${S.mopedDays} day(s) × ${fmt(perDay)} = <b>${fmt(perDay * S.mopedDays)}</b>, one scooter for both of you.</li>`;
  }
  function renderHacks() {
    $("hacks").innerHTML = D.hacks.map((h, i) => `<div class="hack"><span class="n">#${i + 1}</span><div class="e">${h.emoji}</div><h4>${esc(h.title)}</h4><p>${esc(h.text)} ${srcLinks(h.src)}</p></div>`).join("");
    $("freeList").innerHTML = D.freeActivities.map(f => `<li>${f.emoji} ${esc(f.name)}</li>`).join("");
  }
  function renderAlcohol() {
    const A = D.alcohol;
    $("alcoholInfo").innerHTML = `<ul class="clean">
      <li>🍻 <b>${esc(A.barBeer.label)}:</b> ≈${fmt(A.barBeer.price, { cents: 1 })} (${esc(A.barBeer.range)}) ${srcLinks(A.barBeer.src)}</li>
      <li>🛒 <b>${esc(A.marketBeer.label)}:</b> ≈${fmt(A.marketBeer.price, { cents: 1 })} (${esc(A.marketBeer.range)}) ${srcLinks(A.marketBeer.src)}</li>
      <li>🥃 <b>${esc(A.guaro.label)}:</b> ≈${fmt(A.guaro.price, { cents: 1 })} (${esc(A.guaro.range)}), ${A.guaro.bottles} bottles planned ${srcLinks(A.guaro.src)}</li>
      <li>🍹 <b>${esc(A.cocktail.label)}:</b> ≈${fmt(A.cocktail.price)} each, ${A.cocktail.perPersonTrip} per person <span class="tag">estimate</span></li>
      <li>⏰ <b>Happy hour:</b> ${esc(A.happyHour)}</li>
      <li>🪪 ${esc(A.ageNote)}</li>
      <li>📐 The model assumes ${Math.round(A.barShare * 100)}% of beers are at a bar and the rest from the supermarket. Your ${S.beers}/day each comes to <b>${fmt(R.cats.alcohol)}</b> for the trip.</li></ul>`;
  }
  function renderFoodRef() {
    $("foodRef").innerHTML = `<p>${esc(D.food.basis)} ${srcLinks(D.food.src)}</p>
      <p><b>Daily food per person:</b> Budget ${fmt(D.food.perPersonDay.budget)} · Mid ${fmt(D.food.perPersonDay.mid)} · Comfy ${fmt(D.food.perPersonDay.comfy)} <span class="tag">estimate</span>.
      Nicer dinner: ${fmt(D.food.nicerDinner.pp)} pp <span class="tag">estimate</span>. ${esc(D.food.nicerDinner.note)}</p>
      <div class="table-wrap"><table><tbody>${D.food.reference.map(r => `<tr><td>${esc(r.item)}</td><td>${esc(r.price)} ${srcLinks(r.src)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function renderPriceSources() {
    const n = D.meta.travelers;
    const row = (item, price, est, src, extra) => `<tr><td>${item}</td><td class="num">${price}</td><td>${estTag(est)}</td><td>${extra ? esc(extra) + " " : ""}${srcLinks(src) || '<span class="muted">no source, assumption</span>'}</td></tr>`;
    const tbl = (title, rows) => `<div class="src-group"><h4>${title}</h4><div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Price</th><th>Type</th><th>Basis / source</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    let h = "";
    h += tbl("✈️ Flights & airport", D.flights.options.map(f => row(esc(f.route) + " (round trip pp)", fmt(f.pp), f.estimate, f.src, `seen ${fmt(f.low)}–${fmt(f.high)}`)).join("") +
      D.flights.transfers.map(t => row(esc(t.name), fmt(t.perCar) + " / car", t.estimate, t.src, t.note)).join(""));
    h += tbl("🛏️ Lodging (per night, for 2)", D.regions.map(r => ["dorm", "private", "hotel"].map(k => row(`${r.emoji} ${esc(r.short)}: ${k === "dorm" ? "2 dorm beds" : k === "private" ? "private room (hostel)" : "budget hotel/cabina/Airbnb"}`, fmt(r.lodging[k].perNight), r.lodging[k].estimate, r.lodging[k].src, r.lodging[k].note)).join("")).join(""));
    h += tbl("🚌 Transport between regions (per person)", D.legs.map(l => ["bus", "shuttle"].map(k => row(`${esc(region(l.from).short)} → ${esc(region(l.to).short)}: ${esc(l.modes[k].label)}`, fmt(l.modes[k].pp, { cents: 1 }), l.modes[k].estimate, l.modes[k].src, l.modes[k].note)).join("")).join("") +
      row("Local Uber/taxi/bus (per day, for 2)", fmt(D.localTransport.perDayFor2), true, D.localTransport.src, D.localTransport.note));
    h += tbl("🍛 Food & 🍺 alcohol", ["budget", "mid", "comfy"].map(t => row(`Food per person per day (${D.tiers[t].label})`, fmt(D.food.perPersonDay[t]), true, D.food.src)).join("") +
      row("Nicer dinner (pp)", fmt(D.food.nicerDinner.pp), true, []) +
      row(esc(D.alcohol.barBeer.label), fmt(D.alcohol.barBeer.price, { cents: 1 }), false, D.alcohol.barBeer.src, D.alcohol.barBeer.range) +
      row(esc(D.alcohol.marketBeer.label), fmt(D.alcohol.marketBeer.price, { cents: 1 }), false, D.alcohol.marketBeer.src, D.alcohol.marketBeer.range) +
      row(esc(D.alcohol.guaro.label), fmt(D.alcohol.guaro.price, { cents: 1 }), false, D.alcohol.guaro.src, D.alcohol.guaro.range) +
      row(esc(D.alcohol.cocktail.label), fmt(D.alcohol.cocktail.price), true, []));
    h += tbl("🛵 Moped", row("150cc scooter / day", fmt(D.moped.dailyRate), false, ["localbird-scooter"]) + row("Optional CDW / day", fmt(D.moped.insurancePerDay), true, ["bikesbooking-sj"]) + row("Gas / day", fmt(D.moped.gasPerDay), true, []));
    h += tbl("🎟️ Activities (per person)", D.activities.map(a => row(`${a.emoji} ${esc(a.name)}`, fmt(a.pp), a.estimate, a.src, a.note)).join(""));
    h += tbl("🧴 Extras", D.extras.map(e => row(`${e.emoji} ${esc(e.name)}`, fmt(e.amount, { cents: 1 }) + (e.per === "person" ? " pp" : " total"), e.estimate, e.src, e.note)).join("") +
      row("Exchange rate", "₡" + S.fx + " / $1", true, D.meta.exchangeRate.src, "Hardcoded, editable in the header") +
      row("Emergency buffer", D.bufferPct + "% of subtotal", true, []));
    $("priceSources").innerHTML = h;
  }
  function renderSourceList() {
    $("srcIntro").textContent = `Researched on ${D.meta.researchedOn} with web search. "Sourced" means a published 2025–2026 price or listing; "estimate" means a range I padded or a number I couldn't verify. May 2027 prices will drift, so re-check before booking.`;
    $("srcList").innerHTML = D.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> <span class="note">· ${esc(s.note)}</span></li>`).join("");
  }

  /* ---------- expenses ---------- */
  let EXP = [];
  let NAMES = null;
  function renderExpenses() {
    const catOpts = CATS.filter(k => k.id !== "buffer").map(k => `<option value="${k.id}">${k.emoji} ${k.label}</option>`).join("");
    $("expBody").innerHTML = EXP.map((e, i) => `<tr data-i="${i}">
      <td><input data-f="item" value="${esc(e.item)}" placeholder="What was it?"></td>
      <td><select data-f="cat">${catOpts}</select></td>
      <td><input data-f="amount" type="number" min="0" step="0.01" value="${e.amount}" style="max-width:110px"></td>
      <td><select data-f="paidBy"><option value="A">${esc(NAMES[0])}</option><option value="B">${esc(NAMES[1])}</option></select></td>
      <td style="text-align:center"><input data-f="split" type="checkbox" ${e.split ? "checked" : ""}></td>
      <td class="no-print"><button class="del" title="Remove" data-del="${i}">✖️</button></td></tr>`).join("") ||
      `<tr><td colspan="6" class="muted">No expenses yet. Add one, or load the planned big-ticket items.</td></tr>`;
    $("expBody").querySelectorAll("tr[data-i]").forEach(tr => {
      const e = EXP[+tr.dataset.i];
      tr.querySelector('[data-f="cat"]').value = e.cat;
      tr.querySelector('[data-f="paidBy"]').value = e.paidBy;
    });
    renderSettle();
  }
  function renderSettle() {
    if (!NAMES) return;
    let paid = { A: 0, B: 0 }, shared = { A: 0, B: 0 }, total = 0;
    EXP.forEach(e => { const a = +e.amount || 0; total += a; paid[e.paidBy] += a; if (e.split) shared[e.paidBy] += a; });
    const half = (shared.A + shared.B) / 2;
    const aOver = shared.A - half;
    let line = "✅ All square!";
    if (Math.abs(aOver) >= 0.01) line = aOver > 0 ? `💸 ${esc(NAMES[1])} owes ${esc(NAMES[0])} <u>${fmt(aOver, { cents: 1 })}</u>` : `💸 ${esc(NAMES[0])} owes ${esc(NAMES[1])} <u>${fmt(-aOver, { cents: 1 })}</u>`;
    $("settle").innerHTML = `<div class="settle-grid">
      <div>Logged so far<b>${fmt(total)}</b><small>vs. plan ${fmt(R ? R.total : 0)}</small></div>
      <div>${esc(NAMES[0])} paid<b>${fmt(paid.A)}</b><small>${fmt(shared.A)} of it shared</small></div>
      <div>${esc(NAMES[1])} paid<b>${fmt(paid.B)}</b><small>${fmt(shared.B)} of it shared</small></div></div>
      <div class="settle-line">${line}</div><p class="muted">Shared items are split 50/50. Unticked items count as the payer's own spending.</p>`;
  }
  function bindExpenses() {
    $("expBody").addEventListener("input", ev => {
      const tr = ev.target.closest("tr[data-i]"); if (!tr) return;
      const e = EXP[+tr.dataset.i], f = ev.target.dataset.f;
      e[f] = f === "split" ? ev.target.checked : f === "amount" ? parseFloat(ev.target.value) || 0 : ev.target.value;
      save(LS.exp, EXP); renderSettle();
    });
    $("expBody").addEventListener("change", ev => {
      const tr = ev.target.closest("tr[data-i]"); if (!tr) return;
      const e = EXP[+tr.dataset.i], f = ev.target.dataset.f;
      if (f === "split") e.split = ev.target.checked; else if (f === "cat" || f === "paidBy") e[f] = ev.target.value;
      save(LS.exp, EXP); renderSettle();
    });
    $("expBody").addEventListener("click", ev => {
      const b = ev.target.closest("[data-del]"); if (!b) return;
      EXP.splice(+b.dataset.del, 1); save(LS.exp, EXP); renderExpenses();
    });
    $("addExp").onclick = () => { EXP.push({ item: "", cat: "food", amount: 0, paidBy: "A", split: true }); save(LS.exp, EXP); renderExpenses(); };
    $("clearExp").onclick = () => { if (confirm("Delete all logged expenses?")) { EXP = []; save(LS.exp, EXP); renderExpenses(); } };
    $("seedExp").onclick = () => {
      const n = D.meta.travelers, tierKey = D.tiers[S.tier].lodgingKey;
      const items = [{ item: "Flights (" + R.flight.route + ") ×2", cat: "flights", amount: round((R.flight.pp + (R.flight.extraPp || 0)) * n), paidBy: "A", split: true }];
      D.stops.forEach((s, i) => { const r = region(s.region); items.push({ item: `Lodging: ${r.short} (${s.nights}n)`, cat: "housing", amount: r.lodging[tierKey].perNight * s.nights, paidBy: i % 2 ? "A" : "B", split: true }); });
      D.activities.filter(a => R.enabledActs.has(a.id)).forEach((a, i) => items.push({ item: a.name + " ×2", cat: "activities", amount: a.pp * n, paidBy: i % 2 ? "B" : "A", split: true }));
      items.push({ item: "Travel insurance (each)", cat: "extras", amount: 56.28, paidBy: "A", split: false });
      items.push({ item: "Travel insurance (each)", cat: "extras", amount: 56.28, paidBy: "B", split: false });
      EXP = EXP.concat(items); save(LS.exp, EXP); renderExpenses();
    };
    const onName = () => { NAMES = [$("nameA").value || "Traveler 1", $("nameB").value || "Traveler 2"]; save(LS.names, NAMES); renderExpenses(); };
    $("nameA").addEventListener("change", onName); $("nameB").addEventListener("change", onName);
  }

  /* ---------- checklists ---------- */
  function renderChecklists() {
    const st = load(LS.checks, { pre: {}, pack: {} });
    const draw = (listId, progId, items, key) => {
      $(listId).innerHTML = items.map(t => `<li><label><input type="checkbox" data-k="${esc(t)}" ${st[key][t] ? "checked" : ""}><span>${esc(t)}</span></label></li>`).join("");
      const prog = () => { $(progId).textContent = items.filter(t => st[key][t]).length + " / " + items.length; };
      prog();
      $(listId).onchange = ev => { st[key][ev.target.dataset.k] = ev.target.checked; save(LS.checks, st); prog(); };
    };
    draw("preList", "preProg", D.pretrip, "pre");
    draw("packList", "packProg", D.packing, "pack");
  }

  /* ---------- countdown ---------- */
  function tick() {
    const ms = new Date(D.meta.departDate) - new Date();
    if (ms <= 0) { $("countdown").textContent = "🎉 Pura vida!"; return; }
    const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
    $("countdown").textContent = `${d}d ${h}h ${m}m`;
  }

  /* ---------- wiring ---------- */
  function bindControls() {
    $("tierToggle").innerHTML = Object.entries(D.tiers).map(([k, t]) => `<button data-tier="${k}">${t.emoji} ${t.label}</button>`).join("");
    $("tierToggle").onclick = ev => { const b = ev.target.closest("button"); if (b) { S.tier = b.dataset.tier; recalc(); } };
    $("flightSelect").innerHTML = D.flights.options.map(f => `<option value="${f.id}">${esc(f.route)}</option>`).join("");
    $("budgetInput").oninput = e => { S.budget = Math.max(0, +e.target.value || 0); recalc(); };
    $("beersSlider").oninput = e => { S.beers = +e.target.value; recalc(); };
    $("mopedSlider").max = D.moped.dayPriority.length;
    $("mopedSlider").oninput = e => { S.mopedDays = +e.target.value; recalc(); };
    $("actSlider").oninput = e => { S.paidActs = +e.target.value; recalc(); };
    $("flightSelect").onchange = e => { S.flight = e.target.value; recalc(); };
    $("fxRate").onchange = e => { const v = +e.target.value; if (v > 0) { S.fx = v; recalc(); } };
    $("curUSD").onclick = () => { S.currency = "USD"; recalc(); renderExpenses(); };
    $("curCRC").onclick = () => { S.currency = "CRC"; recalc(); renderExpenses(); };
    $("resetBtn").onclick = () => { const c = S.currency, fx = S.fx; S = defaults(); S.currency = c; S.fx = fx; recalc(); };
    $("printBtn").onclick = () => { initMap(); setTimeout(() => window.print(), 300); };
    window.addEventListener("beforeprint", () => { Object.values(charts).forEach(c => c.resize()); if (map) map.invalidateSize(); });
    $("tabs").onclick = ev => {
      const b = ev.target.closest("button[data-tab]"); if (!b) return;
      document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("active", x === b));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + b.dataset.tab));
      save("crp-tab", b.dataset.tab);
      if (b.dataset.tab === "map") setTimeout(initMap, 30);
    };
  }

  function start(data) {
    D = data;
    D.sources.forEach((s, i) => { srcIndex[s.id] = i + 1; });
    S = Object.assign(defaults(), load(LS.state, {}));
    EXP = load(LS.exp, []);
    NAMES = load(LS.names, D.meta.travelerNames.slice());
    $("nameA").value = NAMES[0]; $("nameB").value = NAMES[1];
    $("subtitle").textContent = D.meta.subtitle;
    $("routeWhy").textContent = D.routeWhy;
    $("researched").textContent = D.meta.researchedOn;
    bindControls();
    bindExpenses();
    renderMopedStatic();
    renderHacks();
    renderSourceList();
    renderChecklists();
    recalc();
    renderExpenses();
    tick(); setInterval(tick, 30000);
    const tab = load("crp-tab", "plan");
    const btn = document.querySelector(`#tabs button[data-tab="${tab}"]`);
    if (btn && tab !== "plan") btn.click();
  }

  fetch("data.json", { cache: "no-cache" })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(start)
    .catch(() => {
      $("loadError").hidden = false;
      $("dataFile").onchange = ev => {
        const f = ev.target.files[0]; if (!f) return;
        f.text().then(t => { $("loadError").hidden = true; start(JSON.parse(t)); }).catch(err => alert("Couldn't read that file: " + err.message));
      };
    });
})();
