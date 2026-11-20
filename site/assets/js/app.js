/* Рейтинг нейросетей · ai.fizmat.guru. Без сборки и библиотек. Данные — data/models.json (собирает scripts/build_data.py). */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SECTIONS = [
    ["text", "Общий зачёт"], ["ru", "Русский язык"], ["math", "Математика"], ["code", "Программирование"],
    ["creative", "Творческие тексты"], ["hard", "Сложные запросы"], ["web", "Сайты и веб-код"], ["vision", "Зрение: фото и схемы"],
  ];
  const SECNAME = Object.fromEntries(SECTIONS);
  const ORGC = { Anthropic: "--o-anthropic", OpenAI: "--o-openai", Google: "--o-google", Meta: "--o-meta", xAI: "--o-xai",
    DeepSeek: "--o-deepseek", Alibaba: "--o-alibaba", "Moonshot AI": "--o-moonshot", "Z.ai": "--o-zai" };
  const color = (o) => `var(${ORGC[o] || "--o-other"})`;
  const FLAGS = { us: "🇺🇸", cn: "🇨🇳", fr: "🇫🇷", ae: "🇦🇪", gb: "🇬🇧", ca: "🇨🇦", kr: "🇰🇷", il: "🇮🇱", jp: "🇯🇵", in: "🇮🇳", ch: "🇨🇭", de: "🇩🇪" };
  const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const MON_S = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const nf = (v, d = 0) => v == null ? "—" : Number(v).toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
  const dayLong = (iso) => { if (!iso) return ""; const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return `${d} ${MON[m - 1]}`; };
  const dayShort = (iso) => { if (!iso) return "—"; const [y, m] = iso.slice(0, 10).split("-").map(Number); return `${MON_S[m - 1]} ${y}`; };
  const money = (v) => v == null ? "—" : v >= 10 ? nf(v, 0) : v >= 1 ? nf(v, 2).replace(/,?0+$/, (z) => z.startsWith(",") && z.length > 1 ? "" : z) : nf(v, 2);
  const blended = (m) => m.price ? (3 * m.price.in + m.price.out) / 4 : null;

  let D = null, H = {}, NORM = {};

  // ───────── метрики ─────────
  const metric = {
    eci: (m) => m.eci?.v ?? null,
    text: (m) => m.arena.text?.elo ?? null, ru: (m) => m.arena.ru?.elo ?? null, math: (m) => m.arena.math?.elo ?? null,
    code: (m) => m.arena.code?.elo ?? null, creative: (m) => m.arena.creative?.elo ?? null, hard: (m) => m.arena.hard?.elo ?? null,
    web: (m) => m.arena.web?.elo ?? null, vision: (m) => m.arena.vision?.elo ?? null,
  };
  const MLABEL = { eci: "тесты", text: "Arena", ru: "русский", math: "математика", code: "код", creative: "тексты", hard: "сложные", web: "веб", vision: "зрение" };

  function buildNorm() {
    for (const k of Object.keys(metric)) {
      const vals = D.models.map(metric[k]).filter((v) => v != null).sort((a, b) => a - b);
      if (!vals.length) continue;
      const lo = vals[Math.floor(vals.length * 0.05)], hi = vals[vals.length - 1];
      NORM[k] = (v) => v == null ? null : Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
    }
    const lp = D.models.map(blended).filter((v) => v > 0).map(Math.log10).sort((a, b) => a - b);
    const plo = lp[0], phi = lp[lp.length - 1];
    NORM.cost = (v) => v > 0 ? (Math.log10(v) - plo) / (phi - plo || 1) : null;
  }
  const n = (k, m) => NORM[k] ? NORM[k](metric[k](m)) : null;

  // ───────── подбор под задачу ─────────
  const TASKS = [
    { id: "study", name: "Учёба и объяснения", text: "Объяснить тему, разобрать задачу, ответить на вопрос ученика по-русски.", need: "ru",
      w: { ru: 0.4, math: 0.35, eci: 0.25 } },
    { id: "photo", name: "Проверка решений по фото", text: "Прочитать фото тетради или схему и найти ошибку в решении.", need: "vision",
      w: { vision: 0.5, math: 0.3, eci: 0.2 } },
    { id: "code", name: "Программирование и сайты", text: "Писать код, делать сайты и приложения.", need: "web",
      w: { web: 0.45, code: 0.3, eci: 0.25 } },
    { id: "texts", name: "Тексты на русском", text: "Посты, письма, сценарии и всё, где важен живой русский язык.", need: "ru",
      w: { ru: 0.55, creative: 0.45 } },
    { id: "cheap", name: "Дёшево и сердито", text: "Хорошее качество за минимальные деньги через API. Слабые модели сюда не попадают.", need: "price",
      w: { quality: 0.6, cheap: 0.4 } },
    { id: "open", name: "Открытые модели", text: "Модели с открытыми весами: можно запустить на своём сервере.", need: "open",
      w: { eci: 0.5, text: 0.5 } },
  ];
  const WLABEL = { ru: "Arena · русский язык", math: "Arena · математика", eci: "Тесты · Epoch", vision: "Arena · зрение",
    web: "Arena · сайты и веб-код", code: "Arena · программирование", creative: "Arena · творческие тексты", text: "Arena · общий зачёт",
    quality: "Качество: тесты и Arena", cheap: "Низкая цена" };

  function taskScore(t, m) {
    if (t.need === "price" && !m.price) return null;
    if (t.need === "open" && m.open !== true) return null;
    if (t.need !== "price" && t.need !== "open" && metric[t.need](m) == null) return null;
    const parts = {};
    if (t.id === "cheap") {
      const q = [n("eci", m), n("text", m)].filter((v) => v != null);
      if (!q.length) return null;
      const quality = q.reduce((a, b) => a + b, 0) / q.length;
      if (quality < 0.55) return null;
      parts.quality = quality; parts.cheap = 1 - NORM.cost(blended(m));
    } else {
      for (const k of Object.keys(t.w)) { const v = n(k, m); if (v != null) parts[k] = v; }
    }
    let wsum = 0, s = 0;
    for (const [k, v] of Object.entries(parts)) { wsum += t.w[k]; s += t.w[k] * v; }
    if (wsum < 0.7) return null;
    return { score: s / wsum, parts };
  }

  let curTask = "study";
  function renderTasks() {
    const box = $("#tasks");
    box.innerHTML = TASKS.map((t) => `<button type="button" class="chip" id="task-${t.id}" data-t="${t.id}" aria-pressed="${t.id === curTask}">${esc(t.name)}</button>`).join("");
    box.onclick = (e) => { const b = e.target.closest("button[data-t]"); if (!b) return; curTask = b.dataset.t; renderTasks(); };
    const t = TASKS.find((x) => x.id === curTask);
    const ranked = D.models.map((m) => ({ m, r: taskScore(t, m) })).filter((x) => x.r).sort((a, b) => b.r.score - a.r.score).slice(0, 5);
    $("#podium").innerHTML = ranked.map(({ m, r }, i) => `<li>
      <span class="n">${i + 1}</span>
      <div class="nm"><b>${esc(m.name)}</b><div class="why"><span><i class="dot" style="background:${color(m.org)}"></i> ${esc(m.org)}</span>${
        Object.entries(r.parts).map(([k, v]) => `<span>${esc(k === "quality" ? "качество" : k === "cheap" ? "цена" : MLABEL[k])} ${Math.round(v * 100)}</span>`).join("")}${
        t.id === "cheap" ? `<span>$${money(blended(m))}</span>` : ""}</div></div>
      <div class="sc"><b>${Math.round(r.score * 100)}</b><span class="meter"><i style="width:${Math.round(r.score * 100)}%"></i></span></div>
    </li>`).join("") || `<li><span class="n">—</span><div class="nm">Пока нет моделей с нужными оценками.</div><span></span></li>`;
    $("#recipe").innerHTML = `<h3>${esc(t.name)}</h3><p>${esc(t.text)}</p><div class="weights">${
      Object.entries(t.w).map(([k, w]) => `<div><span>${esc(WLABEL[k])}</span><span class="mono r">${Math.round(w * 100)}%</span><span class="bar"><i style="width:${w * 100}%"></i></span></div>`).join("")
    }</div><p>Баллы — место модели в каждом рейтинге по шкале 0–100.</p>`;
  }

  // ───────── лидеры ─────────
  function leaderCard(what, list, val, unit, extra = "") {
    if (!list.length) return "";
    const [a, b, c] = list;
    const tie = b && a.lo != null && b.hi != null && b.hi >= a.lo;
    return `<article class="lead">
      <div class="what">${esc(what)}</div>
      <div class="who">${esc(a.m.name)}</div>
      <div class="org"><i class="dot" style="background:${color(a.m.org)}"></i>${esc(a.m.org)} ${FLAGS[a.m.cc] || ""}</div>
      <div class="val"><b>${val(a)}</b><span>${esc(unit)}${tie ? " · почти ничья" : ""}</span></div>
      ${extra}
      ${b ? `<div class="runner">Дальше: ${esc(b.m.name)} (${val(b)})${c ? `, ${esc(c.m.name)} (${val(c)})` : ""}</div>` : ""}
    </article>`;
  }
  function renderLeaders() {
    const byArena = (s) => D.models.filter((m) => m.arena[s]).sort((a, b) => b.arena[s].elo - a.arena[s].elo)
      .map((m) => ({ m, v: m.arena[s].elo, lo: m.arena[s].lo, hi: m.arena[s].hi }));
    const byEci = D.models.filter((m) => m.eci).sort((a, b) => b.eci.v - a.eci.v).map((m) => ({ m, v: m.eci.v, lo: m.eci.lo, hi: m.eci.hi }));
    const elo = (x) => nf(x.v, 0);
    const cheapT = TASKS.find((t) => t.id === "cheap");
    const cheap = D.models.map((m) => ({ m, r: taskScore(cheapT, m) })).filter((x) => x.r).sort((a, b) => b.r.score - a.r.score)
      .map((x) => ({ m: x.m, v: blended(x.m) }));
    const fresh = D.models.filter((m) => m.date && (m.eci || (m.arena.text && m.arena.text.rank <= 60)))
      .sort((a, b) => b.date.localeCompare(a.date)).map((m) => ({ m, v: m.date }));
    $("#leaderGrid").innerHTML = [
      leaderCard("Сильнее всех по тестам", byEci, (x) => nf(x.v, 1), "индекс Epoch"),
      leaderCard("Любимица людей", byArena("text"), elo, "Elo · Arena, общий зачёт"),
      leaderCard("Лучше всех по-русски", byArena("ru"), elo, "Elo · Arena, русский язык"),
      leaderCard("Математика", byArena("math"), elo, "Elo · Arena, математика"),
      leaderCard("Сайты и веб-код", byArena("web"), elo, "Elo · Arena, веб-разработка"),
      leaderCard("Зрение: фото и схемы", byArena("vision"), elo, "Elo · Arena, зрение"),
      leaderCard("Выгоднее всех", cheap, (x) => "$" + money(x.v), "за 1 млн токенов при сильном качестве"),
      leaderCard("Самая свежая", fresh, (x) => dayLong(x.v), "дата выхода"),
    ].join("");
  }

  // ───────── история (стрелки) ─────────
  function deltaFor(metricKey, id) {
    const days = Object.keys(H).sort();
    if (days.length < 2) return "";
    const today = days[days.length - 1];
    const t0 = new Date(today); t0.setDate(t0.getDate() - 7);
    const ref = days.filter((d) => d <= t0.toISOString().slice(0, 10)).pop() || days[0];
    if (ref === today) return "";
    const now = H[today]?.[metricKey]?.indexOf(id), then = H[ref]?.[metricKey]?.indexOf(id);
    if (now == null || now < 0) return "";
    if (then == null || then < 0) return `<span class="delta up" title="Новая в топ-50 с ${dayLong(ref)}">нов</span>`;
    const d = then - now;
    return d ? `<span class="delta ${d > 0 ? "up" : "down"}" title="Место ${then + 1} → ${now + 1} с ${dayLong(ref)}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>` : "";
  }

  // ───────── таблица ─────────
  const st = { q: "", sec: "text", org: "", open: false, price: false, k: "eci", dir: -1, all: false };
  const LIMIT = 40;
  function sortVal(m) {
    switch (st.k) {
      case "name": return m.name.toLowerCase();
      case "eci": return m.eci?.v ?? null;
      case "arena": return m.arena[st.sec]?.elo ?? null;
      case "price": return blended(m);
      case "date": return m.date || null;
    }
  }
  function renderTable() {
    const q = st.q.trim().toLowerCase();
    let list = D.models.filter((m) => (!q || m.name.toLowerCase().includes(q) || m.org.toLowerCase().includes(q))
      && (!st.org || m.org === st.org) && (!st.open || m.open === true) && (!st.price || m.price));
    list.sort((a, b) => {
      const va = sortVal(a), vb = sortVal(b);
      if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * st.dir;
    });
    const total = list.length;
    if (!st.all) list = list.slice(0, LIMIT);
    const secVals = D.models.map((m) => m.arena[st.sec]?.elo).filter(Boolean);
    const sMax = Math.max(...secVals), sMin = secVals.sort((a, b) => a - b)[Math.floor(secVals.length * 0.05)] || 0;
    const built = new Date(D.built);
    const label = "Arena · " + SECNAME[st.sec];
    $("#arenaHead").textContent = "Люди · " + SECNAME[st.sec];
    $("#rows").innerHTML = list.map((m, i) => {
      const a = m.arena[st.sec];
      const isNew = m.date && (built - new Date(m.date)) / 864e5 <= 30;
      const eciW = m.eci ? Math.max(4, Math.round(70 * NORM.eci(m.eci.v))) : 0;
      const aW = a ? Math.max(4, Math.round(70 * Math.max(0, a.elo - sMin) / (sMax - sMin || 1))) : 0;
      return `<tr>
        <td class="c-n mono muted">${i + 1}</td>
        <td class="c-m"><div class="mcell"><b>${esc(m.name)}</b><div class="meta"><span><i class="dot" style="background:${color(m.org)}"></i> ${esc(m.org || "—")} ${FLAGS[m.cc] || ""}</span>${
          m.open ? '<span class="tag open">открытые веса</span>' : ""}${isNew ? '<span class="tag new">новинка</span>' : ""}${
          a?.mode ? `<span>режим ${esc(a.mode)}</span>` : ""}</div></div></td>
        <td class="c-e r">${m.eci ? `<div class="score"><span class="meter"><i style="width:${eciW}px"></i></span><b title="погрешность ${nf(m.eci.lo, 1)}–${nf(m.eci.hi, 1)}">${nf(m.eci.v, 1)}</b>${deltaFor("eci", m.id)}</div>` : '<span class="na">—</span>'}</td>
        <td class="c-a r" data-label="${esc(label)}">${a ? `<div class="score"><span class="meter"><i style="width:${aW}px"></i></span><b title="${nf(a.votes)} голосов, погрешность ${nf(a.lo)}–${nf(a.hi)}">${nf(a.elo)}</b><span class="rk">#${a.rank}</span>${deltaFor(st.sec, m.id)}</div>` : '<span class="na">нет в разделе</span>'}</td>
        <td class="c-p r">${m.price ? `<span class="price">${money(m.price.in)} <small>/</small> ${money(m.price.out)}</span>` : '<span class="na">—</span>'}</td>
        <td class="c-d r muted">${dayShort(m.date)}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="6" class="loading">Ничего не нашлось.</td></tr>`;
    $("#count").textContent = `${nf(total)} ${plural(total, "модель", "модели", "моделей")}`;
    $("#moreBox").hidden = st.all || total <= LIMIT;
    $("#more").textContent = `Показать все ${nf(total)}`;
    document.querySelectorAll("thead th[data-k]").forEach((th) => {
      if (th.dataset.k === st.k) th.setAttribute("aria-sort", st.dir < 0 ? "descending" : "ascending"); else th.removeAttribute("aria-sort");
    });
  }
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; };

  function bindTable() {
    $("#sec").innerHTML = SECTIONS.map(([id, nm]) => `<option value="${id}">${esc(nm)}</option>`).join("");
    const orgs = [...new Set(D.models.map((m) => m.org).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    $("#org").innerHTML = `<option value="">все</option>` + orgs.map((o) => `<option>${esc(o)}</option>`).join("");
    $("#q").oninput = (e) => { st.q = e.target.value; renderTable(); };
    $("#sec").onchange = (e) => { st.sec = e.target.value; if (st.k !== "arena") { st.k = "arena"; st.dir = -1; } renderTable(); };
    $("#org").onchange = (e) => { st.org = e.target.value; renderTable(); };
    $("#onlyOpen").onchange = (e) => { st.open = e.target.checked; renderTable(); };
    $("#onlyPrice").onchange = (e) => { st.price = e.target.checked; renderTable(); };
    $("#more").onclick = () => { st.all = true; renderTable(); };
    document.querySelectorAll("thead th[data-k] button").forEach((b) => b.addEventListener("click", () => {
      const k = b.parentElement.dataset.k;
      if (st.k === k) st.dir *= -1; else { st.k = k; st.dir = k === "name" || k === "price" ? 1 : -1; }
      renderTable();
    }));
  }

  // ───────── графики ─────────
  function scatter(svg, pts, o) {
    const narrow = (svg.clientWidth || 640) < 520;
    const W = narrow ? 380 : 640, H2 = narrow ? 360 : 420, L = narrow ? 56 : 60, R = 12, T = 14, B = 44;
    svg.setAttribute("viewBox", `0 0 ${W} ${H2}`);
    const X = (v) => L + (v - o.x0) / (o.x1 - o.x0) * (W - L - R), Y = (v) => T + (1 - (v - o.y0) / (o.y1 - o.y0)) * (H2 - T - B);
    let s = "";
    const xt = narrow ? o.xt.filter((_, i) => i % 2 === 0) : o.xt;
    for (const t of xt) s += `<line x1="${X(t.v)}" x2="${X(t.v)}" y1="${T}" y2="${H2 - B}" stroke="rgba(160,180,255,.09)"/><text x="${X(t.v)}" y="${H2 - B + 18}" text-anchor="middle">${t.l}</text>`;
    for (const t of o.yt) s += `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="rgba(160,180,255,.09)"/><text x="${L - 8}" y="${Y(t) + 4}" text-anchor="end">${nf(t)}</text>`;
    s += `<text x="${(L + W - R) / 2}" y="${H2 - 6}" text-anchor="middle">${esc(o.xl)}</text><text transform="translate(12 ${(T + H2 - B) / 2}) rotate(-90)" text-anchor="middle">${esc(o.yl)}</text>`;
    if (o.line) s += `<polyline points="${o.line.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")}" fill="none" stroke="var(--sky)" stroke-opacity=".55" stroke-width="1.5" stroke-dasharray="5 5"/>`;
    const placed = [];
    const labels = new Set(o.labels);
    pts.forEach((p, i) => { s += `<circle class="pt" data-i="${i}" cx="${X(p.x)}" cy="${Y(p.y)}" r="${labels.has(p.m.id) ? 6 : 4.5}" fill="${color(p.m.org)}" fill-opacity="${labels.has(p.m.id) ? 1 : .75}" stroke="var(--bg)" stroke-width="1.2"/>`; });
    const order = [...labels];
    pts.filter((p) => labels.has(p.m.id)).sort((a, b) => order.indexOf(a.m.id) - order.indexOf(b.m.id)).forEach((p) => {
      const cx = X(p.x), cy = Y(p.y), w = p.m.name.length * 6.2 + 4;
      const right = cx + 8 + w < W - R;
      const box = { x: right ? cx + 8 : cx - 8 - w, y: cy - 12, w, h: 14 };
      if (placed.some((b) => !(box.x > b.x + b.w || box.x + box.w < b.x || box.y > b.y + b.h || box.y + box.h < b.y))) return;
      placed.push(box);
      s += `<text class="lbl" x="${right ? cx + 8 : cx - 8}" y="${cy - 1}" text-anchor="${right ? "start" : "end"}">${esc(p.m.name)}</text>`;
    });
    svg.innerHTML = s;
    const fig = svg.closest(".chart");
    let tip = fig.querySelector(".tip");
    if (!tip) { tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; fig.appendChild(tip); }
    const show = (e) => {
      const c = e.target.closest(".pt"); if (!c) { tip.hidden = true; return; }
      const p = pts[+c.dataset.i]; tip.innerHTML = o.tip(p); tip.hidden = false;
      const fr = fig.getBoundingClientRect(), cr = c.getBoundingClientRect();
      let left = cr.left - fr.left + 12, top = cr.top - fr.top - 10;
      if (left + 240 > fr.width) left = cr.left - fr.left - 250;
      tip.style.left = Math.max(6, left) + "px"; tip.style.top = Math.max(6, top) + "px";
    };
    svg.onmousemove = show; svg.onclick = show; svg.onmouseleave = () => { tip.hidden = true; };
  }
  function niceTicks(a, b, step) { const out = []; for (let v = Math.ceil(a / step) * step; v <= b; v += step) out.push(Math.round(v)); return out; }

  function renderCharts() {
    // 1. тесты × люди
    const p1 = D.models.filter((m) => m.eci && m.arena.text).map((m) => ({ m, x: m.eci.v, y: m.arena.text.elo }));
    if (p1.length > 3) {
      const xs = p1.map((p) => p.x), ys = p1.map((p) => p.y);
      const x0 = Math.floor(Math.min(...xs) / 5) * 5 - 2, x1 = Math.ceil(Math.max(...xs) / 5) * 5 + 2;
      const y0 = Math.floor(Math.min(...ys) / 20) * 20 - 10, y1 = Math.ceil(Math.max(...ys) / 20) * 20 + 10;
      const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
      const k = p1.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / p1.reduce((a, p) => a + (p.x - mx) ** 2, 0), b = my - k * mx;
      const res = p1.map((p) => ({ id: p.m.id, r: p.y - (k * p.x + b) }));
      const lab = new Set([
        ...[...p1].sort((a, b2) => b2.x - a.x).slice(0, 4).map((p) => p.m.id),
        ...[...p1].sort((a, b2) => b2.y - a.y).slice(0, 3).map((p) => p.m.id),
        ...[...res].sort((a, b2) => b2.r - a.r).slice(0, 2).map((r) => r.id),
        ...[...res].sort((a, b2) => a.r - b2.r).slice(0, 2).map((r) => r.id),
      ]);
      scatter($("#sc1"), p1, {
        x0, x1, y0, y1, xl: "Тесты · индекс Epoch", yl: "Люди · Elo Arena", labels: lab,
        xt: niceTicks(x0, x1, 5).map((v) => ({ v, l: v })), yt: niceTicks(y0, y1, 20),
        line: [[x0, k * x0 + b], [x1, k * x1 + b]],
        tip: (p) => `<b>${esc(p.m.name)}</b>${esc(p.m.org)}<br>Тесты: ${nf(p.x, 1)} · Arena: ${nf(p.y)} (#${p.m.arena.text.rank})`,
      });
    }
    // 2. сила × цена
    const p2 = D.models.filter((m) => m.eci && blended(m) > 0).map((m) => ({ m, x: Math.log10(blended(m)), y: m.eci.v }));
    if (p2.length > 3) {
      const xs = p2.map((p) => p.x), ys = p2.map((p) => p.y);
      const x0 = Math.floor(Math.min(...xs) * 2) / 2 - 0.1, x1 = Math.ceil(Math.max(...xs) * 2) / 2 + 0.1;
      const y0 = Math.floor(Math.min(...ys) / 10) * 10 - 2, y1 = Math.ceil(Math.max(...ys) / 10) * 10 + 2;
      const front = []; let best = -Infinity;
      [...p2].sort((a, b) => a.x - b.x || b.y - a.y).forEach((p) => { if (p.y > best) { best = p.y; front.push(p); } });
      const ticks = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100].filter((v) => Math.log10(v) >= x0 && Math.log10(v) <= x1);
      scatter($("#sc2"), p2, {
        x0, x1, y0, y1, xl: "Цена, $ за 1 млн токенов (лог. шкала)", yl: "Тесты · индекс Epoch", labels: new Set(front.slice(-7).reverse().map((p) => p.m.id)),
        xt: ticks.map((v) => ({ v: Math.log10(v), l: "$" + String(v).replace(".", ",") })), yt: niceTicks(y0, y1, 10),
        line: front.map((p) => [p.x, p.y]),
        tip: (p) => `<b>${esc(p.m.name)}</b>${esc(p.m.org)}<br>Тесты: ${nf(p.y, 1)} · $${money(10 ** p.x)} за 1 млн<br><span class="muted">вход $${money(p.m.price.in)}, выход $${money(p.m.price.out)}</span>`,
      });
    }
    const orgs = Object.keys(ORGC).filter((o) => D.models.some((m) => m.org === o && m.eci));
    $("#legend").innerHTML = orgs.map((o) => `<span><i class="dot" style="background:${color(o)}"></i>${esc(o)}</span>`).join("") + `<span><i class="dot" style="background:${color("")}"></i>другие</span>`;
  }

  // ───────── статус ─────────
  function renderStatus() {
    const s = D.status || {}, src = D.sources || {};
    const b = new Date(D.built);
    const time = b.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
    const pill = (ok, html) => `<span class="pill"><i class="${ok ? "" : "stale"}"></i>${html}</span>`;
    $("#status").innerHTML = [
      pill(true, `Обновлено <b>${dayLong(D.built)}, ${time} МСК</b>`),
      pill(s.arena?.ok !== false, `Arena: публикация <b>${dayLong(src.arena?.published)}</b>${s.arena?.ok === false ? " · не обновилась" : ""}`),
      pill(s.epoch?.ok !== false, `Epoch: модели по <b>${dayLong(src.epoch?.latest_model)}</b>${s.epoch?.ok === false ? " · не обновился" : ""}`),
      pill(s.openrouter?.ok !== false, `Цены: <b>OpenRouter</b>${s.openrouter?.ok === false ? " · не обновились" : ""}`),
      `<span class="pill"><b>${nf(D.models.length)}</b> моделей</span>`,
    ].join("");
    $("#built").textContent = `данные от ${dayLong(D.built)} ${b.getFullYear()}`;
  }

  // ───────── звёздное небо ─────────
  function sky() {
    const c = $("#sky"); if (!c) return;
    const ctx = c.getContext("2d"); let stars = [], w = 0, h = 0;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const size = () => {
      const r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      w = r.width; h = r.height; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({ length: Math.round(w * h / 2600) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.2 + 0.2, p: Math.random() * 6.28, s: 0.4 + Math.random() }));
    };
    const draw = (t) => {
      ctx.clearRect(0, 0, w, h);
      const g = ctx.createRadialGradient(w * 0.78, h * 0.15, 0, w * 0.78, h * 0.15, Math.max(w, h) * 0.7);
      g.addColorStop(0, "rgba(58,107,255,.22)"); g.addColorStop(1, "rgba(5,7,15,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (const s of stars) {
        const a = reduce ? 0.7 : 0.45 + 0.45 * Math.sin(s.p + t / 900 * s.s);
        ctx.fillStyle = `rgba(200,215,255,${a})`; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
      }
      if (!reduce) requestAnimationFrame(draw);
    };
    size(); addEventListener("resize", size); requestAnimationFrame(draw);
  }

  // ───────── запуск ─────────
  sky();
  Promise.all([
    fetch("data/models.json", { cache: "no-cache" }).then((r) => r.json()),
    fetch("data/history.json", { cache: "no-cache" }).then((r) => r.ok ? r.json() : {}).catch(() => ({})),
  ]).then(([d, h]) => {
    D = d; H = h || {};
    buildNorm(); renderStatus(); renderLeaders(); renderTasks(); bindTable(); renderTable(); renderCharts();
    let rt; let lastW = innerWidth;
    addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (Math.abs(innerWidth - lastW) > 40) { lastW = innerWidth; renderCharts(); } }, 250); });
  }).catch((e) => {
    $("#status").innerHTML = `<span class="pill"><i class="stale"></i>Не удалось загрузить данные. Обновите страницу.</span>`;
    console.error(e);
  });
})();
