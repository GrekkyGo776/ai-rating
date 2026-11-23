/* Рейтинг нейросетей · ai.fizmat.guru. Без сборки и библиотек. Данные — data/models.json (собирает scripts/build_data.py). */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SECTIONS = [
    ["agent", "Агент · общий зачёт"], ["agent_work", "Агент · рабочие задачи"],
    ["agent_code", "Агент · код"], ["agent_outcome", "Агент · доведение задачи"],
    ["text", "Общий чат"], ["ru", "Русский язык"], ["math", "Математика"], ["code", "Программирование"],
    ["creative", "Творческие тексты"], ["hard", "Сложные запросы"], ["web", "Сайты и веб-код"],
    ["web_react", "React и Remotion"], ["vision", "Зрение: фото и схемы"], ["vision_hw", "Домашки по фото"], ["doc", "Документы и PDF"],
  ];
  const isAgentSec = (s) => typeof s === "string" && s.startsWith("agent");
  const isNonLlmContra = (m) => m.id === "gestalt" || m.org === "Gestalt";
  const modeTag = (mode) => mode ? `<span class="tag mode" title="Уровень рассуждения">${esc(mode)}</span>` : "";
  const rubApprox = (usdVal) => {
    const fx = D?.fx;
    if (usdVal == null || !Number.isFinite(fx?.usd_rub) || fx.usd_rub <= 0) return "";
    return ` ≈ ${nf(usdVal * fx.usd_rub, 0)} ₽`;
  };
  // Тесты с правильными ответами: колонка «Тесты» в таблице переключается между ними
  const TESTS = [
    ["eci", "Индекс Epoch", "индекс"], ["physics", "Физика · CritPt", "%"], ["mathx", "Сложная математика · FrontierMath", "%"],
    ["science", "Наука · GPQA Diamond", "%"], ["facts", "Факты · SimpleQA", "%"], ["ege", "Проверка ЕГЭ · fizmat.guru", "%"],
  ];
  const TESTNAME = Object.fromEntries(TESTS.map(([id, nm]) => [id, nm]));
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

  // Свежесть: показываем модели, вышедшие за выбранный срок (по умолчанию 12 месяцев; выбор запоминается в браузере).
  const PERIODS = [[30, "1 месяц", "1 мес"], [91, "3 месяца", "3 мес"], [182, "6 месяцев", "6 мес"], [365, "12 месяцев", "12 мес"], [0, "все модели", "все"], [-1, "без даты", "без даты"]];
  const PERIOD_KEY = "ai-rating-period";
  let PERIOD = 365, CUTOFF = "";
  try {
    const v = localStorage.getItem(PERIOD_KEY);
    if (v != null && PERIODS.some(([d]) => String(d) === v)) PERIOD = +v;
    else if (localStorage.getItem("ai-rating-fresh") === "0") PERIOD = 0; // прежний флажок «за 12 месяцев»
  } catch (e) { /* без памяти */ }
  const isFresh = m => PERIOD === 0 || (PERIOD < 0 ? !freshRelease(m) : !!freshRelease(m) && m.date >= CUTOFF && m.date <= D.built.slice(0,10));
  const models = () => (PERIOD ? D.models.filter(isFresh) : D.models);
  const periodName = () => PERIODS.find(([d]) => d === PERIOD)[1];
  const periodOptions = () => PERIODS.map(([d, nm]) => `<option value="${d}"${d === PERIOD ? " selected" : ""}>${d > 0 ? "за " + nm : nm}</option>`).join("");
  function setPeriod(d) {
    PERIOD = d; try { localStorage.setItem(PERIOD_KEY, String(d)); } catch (e) { /* без памяти */ }
    CUTOFF = PERIOD > 0 ? new Date(new Date(D.built).getTime() - PERIOD * 864e5).toISOString().slice(0, 10) : "";
    if (openZ) { const z = ZACHETS.find(x => x.id === openZ); const list = zachetList(z); if (!list.length || (!z.independent && !coversFamilies(list.map(x => x.m)))) openZ = null; }
    updateRankingOptions(); renderStatus(); renderLeaders(); renderZachet(); renderTasks(); renderTable(); renderCharts();
  }

  // ───────── метрики ─────────
  const metric = {
    eci: (m) => m.eci?.v ?? null,
    agent: (m) => m.arena.agent?.elo ?? null, agent_work: (m) => m.arena.agent_work?.elo ?? null,
    agent_code: (m) => m.arena.agent_code?.elo ?? null, agent_outcome: (m) => m.arena.agent_outcome?.elo ?? null,
    text: (m) => m.arena.text?.elo ?? null, ru: (m) => m.arena.ru?.elo ?? null, math: (m) => m.arena.math?.elo ?? null,
    code: (m) => m.arena.code?.elo ?? null, creative: (m) => m.arena.creative?.elo ?? null, hard: (m) => m.arena.hard?.elo ?? null,
    web: (m) => m.arena.web?.elo ?? null, web_react: (m) => m.arena.web_react?.elo ?? null,
    vision: (m) => m.arena.vision?.elo ?? null, vision_hw: (m) => m.arena.vision_hw?.elo ?? null,
    doc: (m) => m.arena.doc?.elo ?? null, contra: (m) => m.contra?.elo ?? null, code_video: (m) => m.code_video?.elo ?? null,
    physics: (m) => m.bench?.physics?.v ?? null, mathx: (m) => m.bench?.mathx?.v ?? null,
    science: (m) => m.bench?.science?.v ?? null, facts: (m) => m.bench?.facts?.v ?? null, ege: (m) => m.own?.ege?.v ?? null,
  };
  const MLABEL = { eci: "тесты", agent: "агент", agent_work: "работа", agent_code: "агент-код", agent_outcome: "результат",
    text: "Arena", ru: "русский", math: "математика", code: "код", creative: "тексты", hard: "сложные", web: "веб", web_react: "React",
    vision: "зрение", vision_hw: "домашки", doc: "документы", contra: "дизайн", code_video: "видео кодом",
    physics: "физика", mathx: "сложная мат.", science: "наука", facts: "факты", ege: "ЕГЭ" };

  // Поколения определяем по всему каталогу до применения фильтров.
  const families = {
    Anthropic: /^Claude (Opus|Fable|Haiku|Sonnet) (\d+)(?:\.(\d+))?\b/i,
    OpenAI: /^(GPT)-(\d+)(?:\.(\d+))?\b/i,
    Google: /^(Gemini) (\d+)(?:\.(\d+))?\b/i,
  };
  const currentIds = new Set();
  function identifyGenerations() {
    const lines = new Map();
    for (const m of D.models) {
      const match = families[m.org]?.exec(m.name);
      if (!match) continue;
      const [, line, major, minor = "0"] = match;
      const version = major + "." + minor;
      const latest = lines.get(line);
      const order = latest ? version.localeCompare(latest.version, "en", {numeric: true}) : 1;
      if (order > 0) lines.set(line, {version, ids: [m.id]});
      if (order === 0) latest.ids.push(m.id);
    }
    for (const {ids} of lines.values()) for (const id of ids) currentIds.add(id);
  }
  function coversFamilies(candidates) {
    const represented = new Set(candidates.filter(m => currentIds.has(m.id)).map(m => m.org));
    return Object.keys(families).every(org => represented.has(org));
  }

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
    { id: "agent", name: "Агент и сложная работа", text: "Многошаговые задачи, проекты с файлами и кодом, где модель должна доводить дело до результата.", need: "agent",
      w: { agent: 0.45, agent_outcome: 0.30, web: 0.15, facts: 0.10 } },
    { id: "video", name: "Видео и анимация (Reels / Shorts)", text: "Написать код на Remotion, React или Python и отрендерить анимированный ролик для Reels, Shorts или объяснения темы.", need: "code_video",
      w: { code_video: 0.55, web_react: 0.30, agent_code: 0.15 } },
    { id: "study", name: "Учёба и объяснения", text: "Объяснить тему, разобрать задачу, ответить на вопрос ученика по-русски и не выдумать лишнего.", need: "ru",
      w: { ru: 0.35, math: 0.3, facts: 0.15, eci: 0.2 } },
    { id: "physics", name: "Физика и наука", text: "Сложные задачи по физике и математике, научные вопросы.", need: "physics",
      w: { physics: 0.4, mathx: 0.25, science: 0.1, eci: 0.25 } },
    { id: "photo", name: "Проверка решений по фото", text: "Прочитать фото тетради, домашку или схему и найти ошибку в решении.", need: "vision",
      w: { vision_hw: 0.4, vision: 0.3, math: 0.15, eci: 0.15 } },
    { id: "code", name: "Программирование и сайты", text: "Писать код, вести проекты, делать сайты и приложения.", need: "web",
      w: { web: 0.35, agent_code: 0.30, code: 0.20, eci: 0.15 } },
    { id: "texts", name: "Тексты на русском", text: "Посты, письма, сценарии и всё, где важен живой русский язык.", need: "ru",
      w: { ru: 0.55, creative: 0.45 } },
    { id: "cheap", name: "Дёшево и сердито", text: "Хорошее качество за минимальные деньги через API. Слабые модели сюда не попадают.", need: "price",
      w: { quality: 0.6, cheap: 0.4 } },
    { id: "open", name: "Открытые модели", text: "Модели с открытыми весами: можно запустить на своём сервере.", need: "open",
      w: { eci: 0.5, text: 0.5 } },
  ];
  const WLABEL = { agent: "Agent Arena · общий зачёт", agent_outcome: "Agent Arena · доведение задачи", agent_code: "Agent Arena · код",
    code_video: "DesignArena · видео и анимация кодом", web_react: "Arena · React / Remotion",
    ru: "Arena · русский язык", math: "Arena · математика", eci: "Тесты · Epoch", vision: "Arena · зрение", vision_hw: "Arena · домашки по фото",
    web: "Arena · сайты и веб-код", code: "Arena · программирование", creative: "Arena · творческие тексты", text: "Arena · общий чат",
    quality: "Качество: тесты и Arena", cheap: "Низкая цена", facts: "Тесты · факты (SimpleQA)", physics: "Тесты · физика (CritPt)",
    mathx: "Тесты · сложная математика (FrontierMath)", science: "Тесты · наука (GPQA)", doc: "Arena · документы" };

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

  let curTask = "agent";
  function renderTasks() {
    const box = $("#tasks");
    const candidates = models();
    const rankings = new Map(TASKS.map(t => [t.id, candidates.map(m => ({m, r: taskScore(t, m)})).filter(x => x.r)]));
    const available = TASKS.filter(t => coversFamilies(rankings.get(t.id).map(x => x.m)));
    if (!available.some(t => t.id === curTask)) curTask = available[0]?.id;
    box.innerHTML = available.map((t) => `<button type="button" class="chip" id="task-${t.id}" data-t="${t.id}" aria-pressed="${t.id === curTask}">${esc(t.name)}</button>`).join("");
    box.onclick = (e) => { const b = e.target.closest("button[data-t]"); if (!b) return; curTask = b.dataset.t; renderTasks(); };
    const t = TASKS.find((x) => x.id === curTask);
    if (!t) {
      $("#podium").textContent = "За этот период нет подборок с участниками всех трёх семейств.";
      $("#recipe").replaceChildren();
      return;
    }
    const taskMode = (tid, m) => {
      if (tid === "agent") return m.arena?.agent?.mode || "";
      if (tid === "video") return m.code_video?.mode || "";
      if (tid === "photo") return m.arena?.vision_hw?.mode || m.arena?.vision?.mode || "";
      if (tid === "code") return m.arena?.web?.mode || m.arena?.agent_code?.mode || m.arena?.code?.mode || "";
      if (tid === "physics") return m.bench?.physics?.mode || "";
      if (tid === "study" || tid === "texts") return m.arena?.ru?.mode || "";
      return m.arena?.text?.mode || "";
    };
    const ranked = rankings.get(t.id).sort((a, b) => b.r.score - a.r.score).slice(0, 5);
    $("#podium").innerHTML = ranked.map(({ m, r }, i) => {
      const pm = taskMode(t.id, m);
      const costNote = t.id === "agent" && m.arena?.agent?.cost_p50 != null ? `<span>~$${money(m.arena.agent.cost_p50)} / задача</span>`
        : t.id === "video" && m.code_video?.cost != null ? `<span>~$${money(m.code_video.cost)} / ролик</span>` : "";
      return `<li>
      <span class="n">${i + 1}</span>
      <div class="nm"><b>${esc(m.name)} ${modeTag(pm)}</b><div class="why"><span><i class="dot" style="background:${color(m.org)}"></i> ${esc(m.org)}</span>${
        Object.entries(r.parts).map(([k, v]) => `<span>${esc(k === "quality" ? "качество" : k === "cheap" ? "цена" : MLABEL[k])} ${Math.round(v * 100)}</span>`).join("")}${
        costNote}${t.id === "cheap" ? `<span>$${money(blended(m))}</span>` : ""}</div></div>
      <div class="sc"><b>${Math.round(r.score * 100)}</b><span class="meter"><i style="width:${Math.round(r.score * 100)}%"></i></span></div>
    </li>`;
    }).join("") || `<li><span class="n">—</span><div class="nm">Пока нет моделей с нужными оценками.</div><span></span></li>`;
    $("#recipe").innerHTML = `<h3>${esc(t.name)}</h3><p>${esc(t.text)}</p><div class="weights">${
      Object.entries(t.w).map(([k, w]) => `<div><span>${esc(WLABEL[k])}</span><span class="mono r">${Math.round(w * 100)}%</span><span class="bar"><i style="width:${w * 100}%"></i></span></div>`).join("")
    }</div><p>Баллы — место модели в каждом рейтинге по шкале 0–100.</p>`;
  }

  // ───────── ничья или отрыв ─────────
  // Elo: разница D очков → лидера выбирают в 100/(1+10^(−D/400)) случаях из 100.
  // Ничья — интервалы погрешности пересекаются; отрыв — не пересекаются; явный отрыв — от 50 очков Elo.
  const winOf = (d) => Math.round(100 / (1 + 10 ** (-d / 400)));
  const overlap = (a,b) => [a.lo,a.hi,b.lo,b.hi].every(Number.isFinite) && a.lo <= b.hi && b.lo <= a.hi;
  const pts = (n) => `${nf(n, 0)} ${plural(Math.round(n), "очко", "очка", "очков")}`;
  function verdict(a, b, kind, z) {
    const d = a.v - b.v;
    if (overlap(a,b)) return {cls:"tie", text:"интервалы пересекаются"};
    if ([a.lo,a.hi,b.lo,b.hi].some(x => x == null)) {
      const diff = kind === "pct" ? nf(100*d,1)+" п.п." : (kind === "contra" || kind === "designarena") ? pts(d) : nf(d,1);
      return {cls:"na", text:"Разница "+diff+" · интервал не опубликован"};
    }
    if (kind === "eci") return { cls: d >= 5 ? "far" : "lead", text: `${d >= 5 ? "явный отрыв" : "отрыв"} ${nf(d, 1)}` };
    if (kind === "pct") {
      return { cls: d >= 0.05 ? "far" : "lead", text: `${d >= 0.05 ? "явный отрыв" : "отрыв"} ${nf(d * 100, 1)} п.п.` };
    }
    if (z && isAgentSec(z.sec)) {
      return { cls: d >= 50 ? "far" : "lead", text: `${d >= 50 ? "явный отрыв" : "отрыв"} ${pts(d)}` };
    }
    return { cls: d >= 50 ? "far" : "lead", text: `${d >= 50 ? "явный отрыв" : "отрыв"} ${pts(d)} · выбирают в ${winOf(d)} из 100` };
  }

  // ───────── лидеры и полные зачёты ─────────
  const GROUPS = [
    { id: "agents", title: "Агенты · реальная работа", sub: "многошаговые задачи, код и доведение до результата на Agent Arena" },
    { id: "tests", title: "Тесты", sub: "задачи с правильными ответами" },
    { id: "people", title: "Люди выбирают", sub: "слепые сравнения ответов на Arena" },
    { id: "practice", title: "Практика", sub: "веб-дизайн, наш зачёт, деньги и новинки" },
  ];
  const ZACHETS = [
    { id: "agent", g: "agents", what: "Агент · общий зачёт", unit: "индекс · Agent Arena", kind: "arena", sec: "agent",
      about: "Реальные многошаговые рабочие сессии с файлами, кодом и инструментами (Agent Capability Index). Показан лучший режим рассуждения каждой модели и медианная стоимость одной задачи." },
    { id: "agent_work", g: "agents", what: "Рабочие задачи", unit: "индекс · Agent Arena", kind: "arena", sec: "agent_work",
      about: "Многошаговые прикладные задачи (анализ, документы, работа с проектом) в Agent Arena." },
    { id: "agent_code", g: "agents", what: "Агентный код", unit: "индекс · Agent Arena", kind: "arena", sec: "agent_code",
      about: "Разработка и отладка кода в реальной среде с запуском команд и правкой файлов (Agent Arena · Code)." },
    { id: "agent_outcome", g: "agents", what: "Доводит задачу до конца", unit: "индекс · Agent Arena", kind: "arena", sec: "agent_outcome",
      about: "Как часто агент доводит задачу до нужного результата без срыва и ручных доделок (Agent Task Outcome)." },
    { id: "eci", g: "tests", what: "Сильнее всех по тестам", unit: "индекс Epoch", kind: "eci",
      about: "Индекс Epoch AI: сводная оценка по десяткам сложных тестов — математика, код, наука, рассуждения. Больше — сильнее. Единый уровень рассуждения источник для ECI не указывает." },
    { id: "physics", g: "tests", what: "Физика", unit: "% задач · CritPt", kind: "pct", src: "bench",
      about: "CritPt: задачи уровня научной работы по физике — от конденсированного состояния до астрофизики, их составили сами исследователи. Это намного сложнее олимпиад. Погрешность источник не публикует, поэтому устойчивость небольших различий по этим данным неизвестна." },
    { id: "mathx", g: "tests", what: "Сложная математика", unit: "% задач · FrontierMath", kind: "pct", src: "bench",
      about: "FrontierMath, уровни 1–3: новые задачи от профессиональных математиков, которых нет в интернете. Ответ проверяется автоматически." },
    { id: "science", g: "tests", what: "Наука", unit: "% верно · GPQA Diamond", kind: "pct", src: "bench",
      about: "GPQA Diamond: вопросы по физике, химии и биологии уровня аспиранта, на которые не найти ответ поиском. У лидеров тест упёрся в потолок, около 97 %: разница в верхушке почти ничего не значит." },
    { id: "facts", g: "tests", what: "Не выдумывает факты", unit: "% верно · SimpleQA Verified", kind: "pct", src: "bench",
      about: "SimpleQA Verified: короткие вопросы о фактах с одним правильным ответом. Чем выше, тем реже модель уверенно сочиняет неправду." },
    { id: "text", g: "people", what: "Лучшие ответы в чате", unit: "Elo · Arena, общий чат", kind: "arena", sec: "text",
      about: "Человек задаёт в чате любой вопрос и выбирает лучший из двух текстовых ответов неизвестных моделей. Длина и оформление ответа бонуса не дают. Это не про вёрстку и дизайн — для них зачёт «Сайты и веб-код»." },
    { id: "ru", g: "people", what: "Лучше всех по-русски", unit: "Elo · Arena, русский язык", kind: "arena", sec: "ru",
      about: "Тот же слепой выбор лучшего ответа, но вопросы задают на русском языке." },
    { id: "math", g: "people", what: "Математика", unit: "Elo · Arena, математика", kind: "arena", sec: "math",
      about: "Слепой выбор лучшего ответа на вопросы по математике." },
    { id: "web", g: "people", what: "Сайты и веб-код", unit: "Elo · Arena, веб-разработка", kind: "arena", sec: "web",
      about: "Человек просит сделать сайт или приложение, видит две готовые страницы и выбирает лучшую. Ближе всего к вопросу «кто лучше оформляет и верстает»." },
    { id: "web_react", g: "people", what: "React и Remotion", unit: "Elo · Arena, webdev-react", kind: "arena", sec: "web_react",
      about: "Слепые сравнения кода на React — на нём работает Remotion, главный движок для кодового рендера Reels, Shorts и интерактивных анимаций." },
    { id: "vision", g: "people", what: "Зрение: фото и схемы", unit: "Elo · Arena, зрение", kind: "arena", sec: "vision",
      about: "Вопросы с картинкой: фото, схемы, графики, скриншоты. Слепой выбор лучшего ответа." },
    { id: "vision_hw", g: "people", what: "Домашки по фото", unit: "Elo · Arena, зрение / homework", kind: "arena", sec: "vision_hw",
      about: "Срез Arena Vision по учебным и домашним задачам с фотографиями и схемами. Слепой выбор лучшего ответа." },
    { id: "doc", g: "people", what: "Документы и PDF", unit: "Elo · Arena, документы", kind: "arena", sec: "doc",
      about: "Человек загружает документ — PDF, статью, учебник — и задаёт по нему вопрос. Слепой выбор лучшего ответа." },
    { id: "code_video", g: "practice", what: "Видео и анимация кодом", unit: "Elo · DesignArena", kind: "designarena", independent: true,
      about: "Агента просят сделать анимированный ролик (объясняющее видео, кинетическую типографику, графики) — модель пишет код и рендерит видео, а люди вслепую выбирают лучший результат (DesignArena · Code to Video). Уровень рассуждения для большинства моделей источник не указывает." },
    { id: "contra", g: "practice", what: "Веб-дизайн · ИИ-модели", unit: "Elo · Contra Labs", kind: "contra", independent: true,
      about: "Профессиональные дизайнеры вслепую сравнивают сайты, сделанные по одному брифу (Frontier Design Benchmark). На карточке показан лидер среди чат-моделей; специализированная дизайн-система Gestalt вынесена в сноску. Уровень рассуждения источник не публикует." },
    { id: "ege", g: "practice", what: "Проверка ЕГЭ по физике", unit: "совпадений с экспертом · fizmat.guru", kind: "pct", src: "own", own: true, independent: true,
      about: "Наш зачёт. Модель проверяет решения второй части ЕГЭ по физике (задания 21–26) по критериям ФИПИ, как эксперт на экзамене. Считаем, как часто её балл совпал с баллом настоящего эксперта." },
    { id: "cheap", g: "practice", what: "Выгоднее всех", unit: "за 1 млн токенов при сильном качестве", kind: "cheap",
      about: "Модели с сильным качеством по тестам и Arena, по оценке «качество за деньги» (рецепт — в подборе «Дёшево и сердито»)." },
    { id: "fresh", g: "practice", what: "Самая свежая", unit: "дата выхода", kind: "fresh",
      about: "Новые модели по дате выхода, если у них уже есть оценки." },
  ];
  function zachetList(z) {
    if (z.kind === "eci") return models().filter((m) => m.eci).sort((a, b) => b.eci.v - a.eci.v).map((m) => ({ m, v: m.eci.v, lo: m.eci.lo, hi: m.eci.hi, mode: m.eci.mode || "" }));
    if (z.kind === "pct") return (z.own ? D.models : models()).filter((m) => m[z.src]?.[z.id]).sort((a, b) => b[z.src][z.id].v - a[z.src][z.id].v)
      .map((m) => ({ m, ...m[z.src][z.id], mode: m[z.src][z.id].mode || "" }));
    if (z.kind === "arena") return models().filter((m) => m.arena[z.sec]).sort((a, b) => b.arena[z.sec].elo - a.arena[z.sec].elo)
      .map((m) => ({ m, v: m.arena[z.sec].elo, lo: m.arena[z.sec].lo, hi: m.arena[z.sec].hi, votes: m.arena[z.sec].votes, mode: m.arena[z.sec].mode || "", cost_p50: m.arena[z.sec].cost_p50 ?? null }));
    if (z.kind === "contra") return D.models.filter((m) => m.contra?.elo != null).sort((a, b) => b.contra.elo - a.contra.elo)
      .map((m) => ({ m, v: m.contra.elo, lo: null, hi: null, votes: m.contra.votes, win_rate: m.contra.win_rate, rubric: m.contra.rubric, mode: "", nonLlm: isNonLlmContra(m) }));
    if (z.kind === "designarena") return D.models.filter((m) => m.code_video?.elo != null).sort((a, b) => b.code_video.elo - a.code_video.elo)
      .map((m) => ({ m, v: m.code_video.elo, lo: null, hi: null, votes: m.code_video.battles, win_rate: m.code_video.win_rate, cost_p50: m.code_video.cost ?? null, mode: m.code_video.mode || "" }));
    if (z.kind === "cheap") {
      const t = TASKS.find((x) => x.id === "cheap");
      return models().map((m) => ({ m, r: taskScore(t, m) })).filter((x) => x.r).sort((a, b) => b.r.score - a.r.score)
        .map((x) => ({ m: x.m, v: blended(x.m), score: x.r.score, mode: "" }));
    }
    return models().filter((m) => freshRelease(m) && (m.eci || m.arena.agent || (m.arena.text && m.arena.text.rank <= 60)))
      .sort((a, b) => b.date.localeCompare(a.date)).map((m) => ({ m, v: m.date, mode: "" }));
  }
  const pctf = (v) => `${nf(v * 100, 1)} %`;
  const zVal = (z, x) => z.kind === "eci" ? nf(x.v, 1) : z.kind === "pct" ? pctf(x.v) : (z.kind === "arena" || z.kind === "contra" || z.kind === "designarena") ? nf(x.v, 0) : z.kind === "cheap" ? "$" + money(x.v) : dayLong(x.v);
  const runnerItem = (z, x) => `${esc(x.m.name)}${x.mode ? ` · ${esc(x.mode)}` : ""} — ${zVal(z, x)}`;

  let openZ = null;
  function leaderCard(z) {
    const list = zachetList(z);
    if (!list.length || (!z.independent && !coversFamilies(list.map(x => x.m)))) return "";
    const ranked = z.kind === "contra" ? list.filter((x) => !x.nonLlm) : list;
    const nonLlmTop = z.kind === "contra" ? list.find((x) => x.nonLlm) : null;
    if (!ranked.length) return "";
    const [a, b, c] = ranked;
    const v = b && (z.kind === "eci" || z.kind === "arena" || z.kind === "pct" || z.kind === "contra" || z.kind === "designarena") ? verdict(a, b, z.kind, z) : null;
    const costLabel = z.kind === "designarena" ? "Средняя цена ролика" : "Медиана задачи";
    const costLine = a.cost_p50 != null ? `<span class="sub-note">${costLabel}: $${money(a.cost_p50)}${rubApprox(a.cost_p50)}</span>` : "";
    const sysLine = nonLlmTop ? `<span class="sub-note">Вне зачёта LLM: ${esc(nonLlmTop.m.name)} (${nf(nonLlmTop.v)} Elo — дизайн-система)</span>` : "";
    const modeNote = a.mode ? modeTag(a.mode) : (z.kind === "eci" || z.kind === "contra" || z.kind === "designarena" || z.own ? '<span class="tag" title="Источник не указывает единый режим рассуждения">режим не указан</span>' : "");
    return `<button type="button" class="lead" id="lead-${z.id}" data-z="${z.id}" aria-expanded="${openZ === z.id}" aria-controls="zachet">
      <span class="what">${esc(z.what)}</span>
      <span class="who-row"><span class="who">${esc(a.m.name)}</span>${modeNote}</span>
      <span class="org"><i class="dot" style="background:${color(a.m.org)}"></i>${esc(a.m.org)} ${FLAGS[a.m.cc] || ""}</span>
      <span class="val"><b>${zVal(z, a)}</b><span>${esc(z.unit)}</span></span>
      ${costLine}${sysLine}
      ${v ? `<span class="verdict ${v.cls}">${esc(v.text)}</span>` : ""}
      ${b ? `<span class="runner">Дальше: ${runnerItem(z, b)}${c ? `, ${runnerItem(z, c)}` : ""}</span>` : ""}
      ${z.own ? `<span class="pilot">Пилот за весь период · ${nf(list.length)} ${plural(list.length,"модель","модели","моделей")}${new Set(list.map(x=>x.n)).size===1 ? " · "+nf(a.n)+" работ" : ""}</span>` : ""}
      ${z.kind === "contra" ? `<span class="pilot">За весь период · ${nf(ranked.length)} ИИ-моделей</span>` : ""}
      <span class="open-all">${openZ === z.id ? "Свернуть зачёт" : `Весь зачёт · ${nf(list.length)}${z.independent ? "" : " из " + nf(models().length)}`}</span>
    </button>`;
  }
  function renderLeaders() {
    const open = ZACHETS.find((z) => z.id === openZ);
    $("#leaderGrid").innerHTML = GROUPS.map((g) => {
      const cards = ZACHETS.filter((z) => z.g === g.id).map(leaderCard).join("");
      if (!cards) return "";
      return `<div class="lgroup"><h3 class="lg-title">${esc(g.title)} <span>${esc(g.sub)}</span></h3><div class="leaders">${cards}</div>${
        open && open.g === g.id ? '<div class="zachet" id="zachet" hidden></div>' : ""}</div>`;
    }).join("");
    if (!$("#leaderGrid").textContent.trim()) $("#leaderGrid").textContent = "За этот период нет зачётов с участниками всех трёх семейств.";
    $("#leaderGrid").onclick = (e) => {
      const b = e.target.closest("button[data-z]"); if (!b) return;
      openZ = openZ === b.dataset.z ? null : b.dataset.z; zAll = false;
      renderLeaders(); renderZachet(true);
    };
  }

  let zAll = false;
  const Z_LIMIT = 20;
  function renderZachet(scroll) {
    const box = $("#zachet");
    const z = ZACHETS.find((x) => x.id === openZ);
    if (!box) return;
    if (!z) { box.hidden = true; box.innerHTML = ""; return; }
    const list = zachetList(z), shown = zAll ? list : list.slice(0, Z_LIMIT);
    const withCi = (z.kind === "eci" || z.kind === "arena" || z.kind === "pct") && shown.some((x) => x.lo != null);
    const agentMode = z.kind === "arena" && isAgentSec(z.sec);
    // группы ничьих: модель в группе, пока её интервал пересекается с интервалом лидера группы
    const groups = [];
    for (const x of shown) {
      const g = groups[groups.length - 1];
      if (withCi && g && overlap(g[0], x)) g.push(x); else groups.push([x]);
    }
    const lo = Math.min(...shown.map((x) => x.lo ?? x.v)), hi = Math.max(...shown.map((x) => x.hi ?? x.v));
    const X = (v) => ((v - lo) / (hi - lo || 1)) * 100;
    const top = z.kind === "contra" ? (list.find((x) => !x.nonLlm) || list[0]) : list[0];
    let place = 0, html = "";
    groups.forEach((g, gi) => {
      if (withCi && gi > 0) {
        const d = groups[gi - 1][0].v - g[0].v;
        html += `<li class="z-gap">${z.kind === "arena" ? (agentMode ? `Ступенька: ${pts(d)}` : `Ступенька: ${pts(d)} — модели выше выбирают примерно в ${winOf(d)} из 100 сравнений`) : z.kind === "pct" ? `Ступенька: ${nf(d * 100, 1)} п.п.` : `Ступенька: ${nf(d, 1)} по индексу`}</li>`;
      }
      if (withCi && g.length > 1) html += `<li class="z-group">${gi === 0 ? "Группа лидеров" : "Группа"} · близкие оценки у ${g.length} ${plural(g.length,"модели","моделей","моделей")}</li>`;
      for (const x of g) {
        place += 1;
        let note = "";
        if (z.kind === "arena") {
          note = x === top ? "лидер" : overlap(top, x) ? "интервал пересекается с лидером" : (agentMode ? `−${nf(top.v - x.v, 0)} к лидеру` : `лидера выбирают в ${winOf(top.v - x.v)} из 100`);
          if (x.cost_p50 != null) note += ` · ~$${money(x.cost_p50)} / задача`;
        }
        else if (z.kind === "contra") note = (x.nonLlm ? "дизайн-система (не чат-модель)" : x === top ? "лидер среди ИИ-моделей" : `−${nf(top.v - x.v, 0)} к лидеру LLM`) + (x.win_rate != null ? ` · победы ${pctf(x.win_rate)}` : "") + (x.rubric != null ? ` · дизайн ${nf(x.rubric)}/100` : "");
        else if (z.kind === "designarena") note = (x === top ? "лидер" : `−${nf(top.v - x.v, 0)} к лидеру`) + (x.win_rate != null ? ` · победы ${pctf(x.win_rate)}` : "") + (x.cost_p50 != null ? ` · ~$${money(x.cost_p50)} / ролик` : "");
        else if (z.kind === "eci") note = x === top ? "лидер" : overlap(top, x) ? "интервал пересекается с лидером" : `−${nf(top.v - x.v, 1)} к лидеру`;
        else if (z.kind === "pct") note = (x === top ? "лидер" : withCi && overlap(top, x) ? "интервал пересекается с лидером" : `−${nf((top.v - x.v) * 100, 1)} п.п. к лидеру`)
          + (z.own ? ` · точно ${x.exact}/${x.n}, в пределах 1 балла ${x.pm1}/${x.n} · ниже ${x.stricter}, выше ${x.softer}` : "");
        else if (z.kind === "cheap") note = `оценка ${Math.round(x.score * 100)}`;
        else note = x.m.arena?.agent ? `агент ${nf(x.m.arena.agent.elo)}` : x.m.eci ? `тесты ${nf(x.m.eci.v, 1)}` : x.m.arena.text ? `Arena ${nf(x.m.arena.text.elo)}` : "";
        const sampleWord = agentMode ? plural(x.votes, "сессия", "сессии", "сессий") : z.kind === "designarena" ? plural(x.votes, "сравнение", "сравнения", "сравнений") : plural(x.votes, "голос", "голоса", "голосов");
        html += `<li class="z-row g${gi % 2}">
          <span class="z-n">${place}</span>
          <span class="z-m"><b>${esc(x.m.name)} ${x.mode ? modeTag(x.mode) : ""}${x.nonLlm ? '<span class="tag sys">дизайн-система</span>' : ""}</b><span class="meta"><i class="dot" style="background:${color(x.m.org)}"></i> ${esc(x.m.org || "—")} ${FLAGS[x.m.cc] || ""}${x.votes ? ` · ${nf(x.votes)} ${sampleWord}` : ""}${!x.mode && (z.kind === "eci" || z.kind === "contra" || z.kind === "designarena" || z.own) ? " · режим не указан" : ""}</span></span>
          ${withCi && x.lo != null ? `<span class="z-ci" title="погрешность ${z.kind === "pct" ? `${pctf(x.lo)}–${pctf(x.hi)}` : `${nf(x.lo, z.kind === "eci" ? 1 : 0)}–${nf(x.hi, z.kind === "eci" ? 1 : 0)}`}"><i class="ci" style="left:${X(x.lo)}%;width:${Math.max(1, X(x.hi) - X(x.lo))}%"></i><i class="pt" style="left:${X(x.v)}%"></i></span>` : `<span class="z-ci"></span>`}
          <span class="z-v">${zVal(z, x)}</span>
          <span class="z-note">${esc(note)}</span>
        </li>`;
      }
    });
    const ownMeta = z.own ? (D.own || {})[z.id] || {} : null;
    box.innerHTML = `<div class="z-head"><div><div class="eyebrow">Весь зачёт · ${nf(list.length)} ${plural(list.length, "модель", "модели", "моделей")}</div><h3>${esc(z.what)}</h3><p>${esc(z.about)}</p>
      ${ownMeta ? `<p><b>Набор.</b> ${esc(ownMeta.set)}</p><p><b>Как мерили.</b> ${esc(ownMeta.method)}</p><p class="z-caveat">${esc(ownMeta.caveat)}</p>` : ""}
      ${withCi ? `<p class="z-legend"><span class="ci-demo"></span> полоска — интервал оценки. В одной группе интервалы пересекаются с интервалом первого участника.</p>` : ""}</div>
      <button type="button" class="btn" id="zClose">Свернуть</button></div>
      <ol class="z-list">${html}</ol>
      ${list.length > Z_LIMIT && !zAll ? `<div class="more"><button type="button" class="btn" id="zMore">Показать все ${nf(list.length)}</button></div>` : ""}`;
    box.hidden = false;
    $("#zClose").onclick = () => { const id = openZ; openZ = null; renderLeaders(); renderZachet(); $(`#lead-${id}`)?.focus(); };
    const more = $("#zMore"); if (more) more.onclick = () => { zAll = true; renderZachet(); };
    if (scroll) box.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  const focusNames = {all:"Все показатели", agent:"Агент и сложная работа", video:"Видео и анимация кодом", photo:"Проверить фото решения", ege:"Оценить работу ЕГЭ", web:"Сделать учебную страницу"};
  const PAIR_PRESETS = [
    ["claudefable52", "claudeopus55", "Fable 5.2 vs Opus 5.5"],
    ["claudefable52", "gemini4neon", "Fable 5.2 vs Neon"],
    ["claudeopus55", "gemini4neon", "Opus 5.5 vs Neon"],
    ["claudefable52", "gpt62astra", "Fable 5.2 vs GPT-6.2 Astra"],
    ["claudeopus55", "gpt62astra", "Opus 5.5 vs GPT-6.2 Astra"],
  ];
  const freshRelease = m => ["epoch","epoch_benchmark"].includes(m.dsrc) ? m.date : null;
  const safeCount = value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  const usd = value => "$" + value.toLocaleString("ru-RU",{maximumFractionDigits:8});
  const dateLabel = date => date ? date.slice(0,10).split("-").reverse().join(".") : "—";
  const modalLabel = {image:"фото", text:"текст", audio:"аудио", video:"видео", file:"файлы", pdf:"PDF"};
  const intervalText = (obj, id) => {
    if (id === "eci") return "90% байесовский интервал";
    if (id === "ege") return "95% интервал Уилсона";
    if (TESTNAME[id]) return "≈95% по стандартной ошибке";
    if (isAgentSec(id)) return "Интервал Agent Arena";
    return "Интервал Arena";
  };

  function quoteRequest(model, input, output, cached = 0) {
    if (input == null || output == null || cached == null) return {message:"Введите целое число токенов от нуля"};
    if (cached > input) return {message:"Из кэша нельзя прочитать больше токенов, чем на входе"};
    if ((model.ctx != null && input + output > model.ctx) || (model.max_output != null && output > model.max_output))
      return {message:"Запрос не помещается", hint:"Превышен лимит контекста или ответа"};
    const tiers = (model.price?.tiers || []).filter(t => input >= t.min_prompt_tokens)
      .sort((a,b) => b.min_prompt_tokens - a.min_prompt_tokens);
    const inputRate = tiers[0]?.in ?? model.price?.in;
    const outputRate = tiers[0]?.out ?? model.price?.out;
    const tier = tiers[0];
    const cacheRate = tier ? tier.cache_read : model.price?.cache_read;
    if (cached > 0 && !Number.isFinite(cacheRate))
      return {message:"Ставка чтения из кэша не опубликована", hint:tier ? "Для выбранной длины запроса" : ""};
    const regularInput = input - cached;
    if (!model.price || (regularInput > 0 && !Number.isFinite(inputRate)) || (output > 0 && !Number.isFinite(outputRate)))
      return {message:"Тариф не опубликован"};
    const amount = (regularInput * (inputRate || 0) + cached * (cacheRate || 0) + output * (outputRate || 0)) / 1e6;
    const notes = [];
    if (tiers.length) notes.push("Тариф длинного запроса от " + nf(tiers[0].min_prompt_tokens) + " токенов");
    if (model.ctx == null) notes.push("Контекст не проверен");
    if (model.max_output == null) notes.push("Отдельный лимит ответа неизвестен");
    return {amount, hint:notes.join(" · ")};
  }

  function bindPair() {
    const options = [...D.models].sort((a,b) => a.name.localeCompare(b.name,"ru",{numeric:true}));
    const byId = new Map(options.map(m => [m.id,m]));
    const url = new URL(location.href);
    const params = url.searchParams;
    const selects = [$("#pairA"),$("#pairB")];
    const inputs = [$("#pairInput"),$("#pairOutput"),$("#pairCached")];
    const tokenParams = ["input","output","cached"];
    const searches = [$("#pairSearchA"),$("#pairSearchB")];
    const matchStatus = [$("#pairMatchesA"),$("#pairMatchesB")];
    const fold = value => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");
    const searchIndex = new Map(options.map(m=>[m.id,fold(m.name+" "+(m.org || "")+" "+(m.or || ""))]));
    const paramNames = ["a","b"];
    const defaults = ["claudefable52","gemini4neon"];
    const result = $("#pairResult");
    const variantChoices = new Map();
    for (const [key,value] of params) {
      if (/^mode_[01]_[a-z_]+$/.test(key) && value.length <= 250) variantChoices.set(key,value);
    }
    let focus = Object.hasOwn(focusNames,params.get("focus")) ? params.get("focus") : "all";
    if (options.length < 2) {
      [...selects,...searches].forEach(el => { el.disabled = true; });
      result.textContent = "В каталоге пока меньше двух моделей.";
      $("#pairShare").disabled = true;
      $("#pairCost").hidden = true;
      return;
    }
    let stored = [];
    try { stored = JSON.parse(localStorage.getItem("ai-rating-pair") || "[]"); } catch {}
    selects.forEach((select,i) => {
      for (const m of options) select.add(new Option(m.name,m.id));
      const wanted = params.get(paramNames[i]) || stored?.[i];
      select.value = [wanted,defaults[i],options[i].id].find(id => byId.has(id));
    });
    if (selects[0].value === selects[1].value) selects[1].value = options.find(m => m.id !== selects[0].value).id;
    inputs.forEach((input,i) => {
      const value = params.get(tokenParams[i]);
      if (value != null && safeCount(value) != null) input.value = value;
    });
    if (tokenParams.some(k => params.has(k)) || params.has("cost")) $("#pairCost").open = true;
    if (paramNames.some(n => params.has(n) && !byId.has(params.get(n)))) $("#pairNotice").textContent = "Одна из моделей ссылки отсутствует в текущем каталоге. Показана доступная замена.";
    const selected = () => selects.map(s => byId.get(s.value));

    function filterPicker(i, keep = selects[i].value) {
      const query = fold(searches[i].value.trim());
      const other = selects[1-i].value;
      const fragment = document.createDocumentFragment();
      let count = 0;
      for (const model of options) {
        const matches = !query || searchIndex.get(model.id).includes(query);
        if (!matches && model.id !== keep) continue;
        const option = new Option(model.name,model.id);
        option.disabled = model.id === other && model.id !== keep;
        if (matches && !option.disabled) count++;
        fragment.appendChild(option);
      }
      selects[i].replaceChildren(fragment);
      selects[i].value = keep;
      matchStatus[i].textContent = !query ? "" : count ? "Найдено "+nf(count)
        : "Совпадений нет. Выбранная модель сохранена.";
    }
    searches.forEach((el,i)=>el.addEventListener("input",()=>filterPicker(i)));

    function shareURL() {
      const u = new URL(location.href);
      u.searchParams.set("compare","1");
      selects.forEach((s,i) => u.searchParams.set(paramNames[i],s.value));
      if (focus === "all") u.searchParams.delete("focus"); else u.searchParams.set("focus",focus);
      for (const key of [...u.searchParams.keys()]) if (key.startsWith("mode_")) u.searchParams.delete(key);
      for (const [key,value] of variantChoices) u.searchParams.set(key,value);
      u.searchParams.delete("cost");
      inputs.forEach((el,i) => {
        const key = tokenParams[i];
        if ($("#pairCost").open && safeCount(el.value) != null && (key !== "cached" || Number(el.value) > 0)) u.searchParams.set(key,el.value);
        else u.searchParams.delete(key);
      });
      if ($("#pairCost").open) u.searchParams.set("cost","1");
      u.hash = "compare";
      return u;
    }

    function syncLink(updateAddress = false) {
      const u = shareURL();
      $("#pairPermalink").href = u.href;
      if (updateAddress) history.replaceState(null,"",u);
    }

    function renderQuote() {
      const fx = D.fx;
      const age = Math.floor((Date.now() - Date.parse(fx?.date + "T00:00:00+03:00")) / 864e5);
      const rub = Number.isFinite(fx?.usd_rub) && fx.usd_rub > 0 && age >= 0 && age <= 7;
      const [input,output,cached] = inputs.map(el => safeCount(el.value));
      const costs = selected().map(m => {
        const q = quoteRequest(m,input,output,cached);
        const sum = q.amount == null ? esc(q.message) : usd(q.amount) + (rub ? " · " + nf(q.amount*fx.usd_rub,2) + " ₽" : "");
        return "<div><b>"+esc(m.name)+"</b><strong>"+sum+"</strong><small>"+esc(q.hint || "")+"</small></div>";
      }).join("");
      $("#pairQuote").innerHTML = '<div class="pair-quote">'+costs+"</div>" +
        (rub ? '<p><a href="https://www.cbr.ru/currency_base/daily/" target="_blank" rel="noopener">Курс ЦБ РФ</a> на '+dateLabel(fx.date)+" · "+nf(fx.usd_rub,4)+" ₽ за доллар.</p>" : "<p>Цена в долларах. Свежего курса ЦБ РФ для пересчёта в рубли нет.</p>");
      syncLink();
    }

    function renderPair() {
      const pair = selected();
      selects.forEach((select,i) => filterPicker(i,pair[i].id));
      const presets = $("#pairPresets");
      if (presets) {
        presets.innerHTML = PAIR_PRESETS.filter(([a,b]) => byId.has(a) && byId.has(b)).map(([a,b,label]) =>
          `<button type="button" class="chip" data-a="${a}" data-b="${b}" aria-pressed="${pair[0].id===a && pair[1].id===b}">${esc(label)}</button>`).join("");
        presets.onclick = (e) => {
          const btn = e.target.closest("button[data-a]"); if (!btn) return;
          variantChoices.clear();
          searches.forEach((el) => { el.value = ""; });
          filterPicker(0, btn.dataset.a); filterPicker(1, btn.dataset.b);
          edited();
        };
      }
      $("#pairFocus").innerHTML = Object.entries(focusNames).map(([id,title]) =>
        '<button type="button" class="chip" data-focus="'+id+'" aria-pressed="'+(focus===id)+'">'+title+"</button>").join("");
      const body = [];
      function group(label) {
        body.push('<tr class="pair-group"><th scope="rowgroup" colspan="3">'+esc(label)+"</th></tr>");
      }
      function row(label,cells,meta="") {
        body.push('<tr><th scope="row">'+esc(label)+meta+"</th>"+cells.map(x=>"<td>"+(x??'<span class="na">Нет замера</span>')+"</td>").join("")+"</tr>");
      }
      function conditionRow(label,values,format) {
        if (values.some(v=>v!=null)) row(label,values.map(v=>v==null?null:format(v)));
      }
      function measures(id,m) {
        if (id==="eci") return m.eci;
        if (id==="ege") return m.own?.ege;
        return m.bench?.[id] || m.arena?.[id];
      }
      const identityOf = variant => variant.source_id || variant.source_label || variant.mode || "";
      function chosenSample(id, i) {
        const base = measures(id, pair[i]);
        const choice = variantChoices.get("mode_"+i+"_"+id);
        return choice && base?.variants?.find(v=>identityOf(v)===choice) || base;
      }
      function measure(label,id){
        const bases=pair.map(m=>measures(id,m)), isArena=!!SECNAME[id];
        const samples=bases.map((_,i) => chosenSample(id, i));
        if (!samples.some(Boolean) && focus==="all") return;
        const key=isArena?"elo":"v";
        const format=isArena?v=>nf(v):id==="eci"?v=>nf(v,1):pctf;
        const coverage=options.filter(m=>measures(id,m)?.[key]!=null).length;
        const close=samples.every(o=>o?.lo!=null && o?.hi!=null) && overlap(samples[0],samples[1]);
        const notes="<small>"+nf(coverage)+" из "+nf(options.length)+"</small>" + (close?'<small class="pair-close">Интервалы пересекаются</small>':"");
        row(label,samples.map((o,i)=>{
          if(o?.[key]==null)return null;
          const mode=o.mode ? "<small>Режим "+esc(o.mode)+"</small>" : "<small>Режим не указан источником</small>";
          const range=o.lo!=null && o.hi!=null ? "<small>"+esc(intervalText(o,id))+" · "+format(o.lo)+"–"+format(o.hi)+"</small>" : "";
          const variants=(bases[i]?.variants||[]).filter(v=>v[key]!=null || v.v!=null);
          const controlKey="mode_"+i+"_"+id;
          const chosen=variantChoices.get(controlKey)||"";
          const more=variants.length>1 ? '<select class="pair-variant" data-variant="'+controlKey+'" aria-label="Режим '+esc(pair[i].name+" · "+label)+'"><option value="">Лучший замер</option>'+
            variants.map(v=>'<option value="'+esc(identityOf(v))+'"'+(identityOf(v)===chosen?" selected":"")+'>'+esc(v.source_label||v.mode||"Источник")+" · "+format(v[key]??v.v)+(v.cost_p50!=null?" · $"+money(v.cost_p50):"")+"</option>").join("")+"</select>" : "";
          return "<b>"+format(o[key])+"</b>"+mode+range+more;
        }),notes);
      }
      const agentSecs = SECTIONS.filter(([id]) => isAgentSec(id));
      const chatSecs = SECTIONS.filter(([id]) => !isAgentSec(id));
      const topicAgent = focus==="all" || focus==="agent" ? agentSecs : (focus==="web" || focus==="video") ? agentSecs.filter(([id]) => id==="agent_code" || id==="agent") : [];
      if (topicAgent.length) {
        group("Agent Arena · реальная работа");
        for (const [id, label] of topicAgent) measure(label, id);
        const agentSamples = [0, 1].map((i) => chosenSample("agent", i));
        conditionRow("Медианная цена задачи (Agent Arena)", agentSamples.map(s => s?.cost_p50 ?? null),
          v => "<b>$" + money(v) + "</b>" + (rubApprox(v) ? "<small>" + esc(rubApprox(v).trim()) + "</small>" : ""));
      }
      const topicTests = focus==="all"?TESTS:TESTS.filter(([id])=>focus==="ege"?id==="ege":focus==="photo"?id==="mathx":focus==="agent"?(id==="eci"||id==="facts"):false);
      const topicArena = focus==="all"?chatSecs:chatSecs.filter(([id])=>focus==="web"?["web","web_react","code"].includes(id):focus==="video"?["web_react","web"].includes(id):focus==="photo"?["vision_hw","vision","math"].includes(id):focus==="agent"?["web","ru"].includes(id):false);
      if(topicTests.length){
        group(focus==="ege"?"Пилот Fizmat Hero":"Тесты с проверяемым ответом");
        for(const [id,label] of topicTests) measure(label,id);
      }
      if ((focus==="all" || focus==="ege") && pair.some(m=>m.own?.ege)){
        const details = [["exact","Точно как эксперт"],["pm1","В пределах одного балла"],["stricter","Ниже эксперта"],["softer","Выше эксперта"]];
        for (const [key,label] of details) row(label, pair.map(m=>m.own?.ege?.[key]==null?null:nf(m.own.ege[key])+" из "+nf(m.own.ege.n)));
        conditionRow("Фактическая цена 100 проверок",pair.map(m=>m.own?.ege?.cost_rub_per_100),x=>nf(x,2)+" ₽");
      }
      if(topicArena.length){ group("Предпочтения участников Arena"); for(const [id,label] of topicArena) measure("Arena · "+label,id); }
      if (focus==="video" || (focus==="all" && pair.some(m=>m.code_video))){
        group("DesignArena · видео и анимация кодом");
        row("Elo · Code to Video",pair.map(m=>m.code_video?.elo==null?null:"<b>"+nf(m.code_video.elo)+"</b><small>"+(m.code_video.mode?"Режим "+esc(m.code_video.mode):"Режим не указан источником")+"</small><small>"+nf(m.code_video.battles)+" сравнений</small>"));
        row("Доля побед",pair.map(m=>m.code_video?.win_rate==null?null:pctf(m.code_video.win_rate)));
        conditionRow("Средняя цена рендера ролика",pair.map(m=>m.code_video?.cost),v=>"<b>$"+money(v)+"</b>"+(rubApprox(v)?"<small>"+esc(rubApprox(v).trim())+"</small>":""));
      }
      if (focus==="web" || (focus==="all" && pair.some(m=>m.contra))){
        group("Contra · веб-дизайн");
        row("Elo в слепых сравнениях",pair.map(m=>m.contra?.elo==null?null:"<b>"+nf(m.contra.elo)+"</b><small>"+nf(m.contra.votes)+" голосов</small>"));
        row("Доля побед",pair.map(m=>m.contra?.win_rate==null?null:pctf(m.contra.win_rate)+(m.contra.win_lo!=null && m.contra.win_hi!=null?"<small>95% интервал · "+pctf(m.contra.win_lo)+"–"+pctf(m.contra.win_hi)+"</small>":"")));
        conditionRow("Оценка по критериям дизайна",pair.map(m=>m.contra?.rubric),x=>nf(x)+" / 100");
      }
      group("Возможности и тарифы API");
      row("Форматы на входе",pair.map(m=>Array.isArray(m.input_modalities)?esc(m.input_modalities.map(x=>modalLabel[x]||x).join(", ")):null));
      for(const [key,label] of [["in","Вход"],["out","Выход"],["cache_read","Чтение из кэша"],["cache_write","Запись в кэш"]]){
        conditionRow(label+", $ за 1 млн токенов",pair.map(m=>m.price?.[key]),usd);
      }
      conditionRow("Контекст, токенов",pair.map(m=>m.ctx),nf);
      conditionRow("Максимальный ответ, токенов",pair.map(m=>m.max_output),nf);
      if(focus==="all"){
        row("Подтверждённый релиз",pair.map(m=>freshRelease(m)?dateLabel(m.date):"Дата не подтверждена"));
        conditionRow("Первое появление в Arena",pair.map(m=>m.first_seen),dateLabel);
        conditionRow("Добавлена в OpenRouter",pair.map(m=>m.listed),dateLabel);
      }
      const note=(focus==="all"||focus==="ege")&&D.own?.ege&&pair.some(m=>m.own?.ege)?'<p class="muted">'+esc(D.own.ege.caveat)+"</p>":"";
      result.innerHTML='<table class="pair-table"><caption class="sr-only">Сравнение выбранных моделей</caption><thead><tr><th scope="col">Показатель</th>'+pair.map(m=>'<th scope="col">'+esc(m.name)+"</th>").join("")+"</tr></thead><tbody>"+body.join("")+"</tbody></table>"+note;
      renderQuote();
    }
    function edited(){
      $("#pairNotice").textContent="";
      try { localStorage.setItem("ai-rating-pair",JSON.stringify(selected().map(x=>x.id))); } catch {}
      renderPair(); syncLink(true);
    }
    $("#pairFocus").onclick = event => {
      const button=event.target.closest("button[data-focus]");
      if(!button)return;
      focus=button.dataset.focus;
      if(focus==="ege" && !selected().some(m=>m.own?.ege)){
        const measured=options.filter(m=>m.own?.ege).sort((a,b)=>b.own.ege.v-a.own.ege.v);
        if(measured.length>=2) selects.forEach((s,i)=>{searches[i].value="";filterPicker(i,measured[i].id);});
      }
      edited();
    };
    result.addEventListener("change",event=>{
      const el=event.target.closest("select[data-variant]");
      if(!el)return;
      if(el.value)variantChoices.set(el.dataset.variant,el.value);else variantChoices.delete(el.dataset.variant);
      const key=el.dataset.variant;
      renderPair(); syncLink(true);
      result.querySelector('[data-variant="'+key+'"]')?.focus({preventScroll:true});
    });
    selects.forEach((s,i)=>s.addEventListener("change",()=>{
      for(const key of variantChoices.keys()) if(key.startsWith("mode_"+i+"_")) variantChoices.delete(key);
      edited();
    }));
    inputs.forEach(el=>el.addEventListener("input",()=>{renderQuote();syncLink(true);}));
    $("#pairCost").addEventListener("toggle",()=>syncLink(new URL(location.href).searchParams.has("compare")));
    $("#pairShare").onclick=async()=>{
      const u=shareURL().href;
      try{await navigator.clipboard.writeText(u);$("#pairNotice").textContent="Ссылка скопирована.";}
      catch {$("#pairNotice").textContent="Скопируйте адрес ссылки на эту пару.";$("#pairPermalink").focus();}
    };
    renderPair();
    if(params.get("compare")==="1" && (!url.hash || url.hash==="#compare"))
      requestAnimationFrame(()=>$("#compare").scrollIntoView({block:"start",behavior:"instant"}));
  }


  // ───────── история (стрелки) ─────────
  function deltaFor(metricKey, id) {
    const days = Object.keys(H).filter((d) => H[d][metricKey]).sort();
    if (days.length < 2) return "";
    const today = days[days.length - 1];
    const t0 = new Date(today); t0.setDate(t0.getDate() - 7);
    const ref = days.filter((d) => d <= t0.toISOString().slice(0, 10)).pop();
    if (!ref) return "";
    const now = H[today][metricKey].indexOf(id), then = H[ref][metricKey].indexOf(id);
    if (now < 0) return "";
    if (then < 0) return `<span class="delta up" title="Вошла в топ-50 после ${dayLong(ref)}">нов</span>`;
    const d = then - now;
    return d ? `<span class="delta ${d > 0 ? "up" : "down"}" title="Место ${then + 1} → ${now + 1} с ${dayLong(ref)}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>` : "";
  }

  // ───────── таблица ─────────
  const st = { q: "", sec: "agent", tst: "eci", org: "", open: false, price: false, k: "arena", dir: -1, all: false };
  const testOf = (m) => metric[st.tst]?.(m) ?? null;
  const testCell = (m) => {
    const v = testOf(m);
    if (v == null) return '<span class="na">—</span>';
    const w = Math.max(4, Math.round(70 * (NORM[st.tst] ? NORM[st.tst](v) : 0)));
    const o = st.tst === "eci" ? m.eci : st.tst === "ege" ? m.own.ege : m.bench[st.tst];
    const fmt = (x) => st.tst === "eci" ? nf(x, 1) : pctf(x);
    const tip = (o.lo != null && o.hi != null ? intervalText(o,st.tst)+" "+fmt(o.lo)+"–"+fmt(o.hi) : "Интервал не опубликован")+(o.mode ? " · Режим "+o.mode : "");
    return `<div class="score"><span class="meter"><i style="width:${w}px"></i></span><b title="${esc(tip)}">${fmt(v)}</b>${o.mode ? `<small class="muted">${esc(o.mode)}</small>` : ""}${st.tst === "eci" ? deltaFor("eci", m.id) : ""}</div>`;
  };
  const LIMIT = 40;
  function sortVal(m) {
    switch (st.k) {
      case "name": return m.name.toLowerCase();
      case "eci": return testOf(m);
      case "arena": return m.arena[st.sec]?.elo ?? null;
      case "price": return blended(m);
      case "date": return freshRelease(m);
    }
  }
  function renderTable() {
    const q = st.q.trim().toLowerCase();
    let list = models().filter((m) => (!q || m.name.toLowerCase().includes(q) || m.org.toLowerCase().includes(q))
      && (!st.org || m.org === st.org) && (!st.open || m.open === true) && (!st.price || m.price));
    list.sort((a, b) => {
      const va = sortVal(a), vb = sortVal(b);
      if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * st.dir;
    });
    const total = list.length;
    if (!st.all) list = list.slice(0, LIMIT);
    const secVals = models().map((m) => m.arena[st.sec]?.elo).filter(Boolean);
    const sMax = Math.max(...secVals), sMin = secVals.sort((a, b) => a - b)[Math.floor(secVals.length * 0.05)] || 0;
    const built = new Date(D.built);
    const agentSec = isAgentSec(st.sec);
    const label = (agentSec ? "" : "Arena · ") + (SECNAME[st.sec] || "нет зачётов");
    $("#arenaHead").textContent = (agentSec ? "" : "Люди · ") + (SECNAME[st.sec] || "нет зачётов");
    $("#testHead").textContent = "Тесты · " + (TESTNAME[st.tst] || "нет зачётов").split(" · ")[0];
    $("#rows").innerHTML = list.map((m, i) => {
      const a = m.arena[st.sec];
      const daysSince = freshRelease(m) ? (built - new Date(m.date)) / 864e5 : null;
      const isNew = daysSince != null && daysSince >= 0 && daysSince <= 30;
      const aW = a ? Math.max(4, Math.round(70 * Math.max(0, a.elo - sMin) / (sMax - sMin || 1))) : 0;
      const unitW = agentSec ? "сессий" : "голосов";
      const taskCost = a?.cost_p50 != null ? `<span>~$${money(a.cost_p50)} / задача</span>` : "";
      return `<tr>
        <td class="c-n mono muted">${i + 1}</td>
        <td class="c-m"><div class="mcell"><b>${esc(m.name)}</b><div class="meta"><span><i class="dot" style="background:${color(m.org)}"></i> ${esc(m.org || "—")} ${FLAGS[m.cc] || ""}</span>${
          m.open ? '<span class="tag open">открытые веса</span>' : ""}${isNew ? '<span class="tag new">новинка</span>' : ""}${
          a?.mode ? `<span class="tag mode" title="Режим рассуждения в выбранном зачёте Arena">${esc(a.mode)}</span>` : ""}${taskCost}</div></div></td>
        <td class="c-e r" data-label="${esc("Тесты · " + (TESTNAME[st.tst] || "нет зачётов"))}">${testCell(m)}</td>
        <td class="c-a r" data-label="${esc(label)}">${a ? `<div class="score"><span class="meter"><i style="width:${aW}px"></i></span><b title="${nf(a.votes)} ${unitW}, погрешность ${nf(a.lo)}–${nf(a.hi)}${a.mode ? ", режим " + esc(a.mode) : ""}">${nf(a.elo)}</b><span class="rk">#${a.rank}</span>${deltaFor(st.sec, m.id)}</div>` : '<span class="na">нет в разделе</span>'}</td>
        <td class="c-p r">${m.price ? `<span class="price">${money(m.price.in)} <small>/</small> ${money(m.price.out)}</span>` : '<span class="na">—</span>'}</td>
        <td class="c-d r muted"${m.dsrc === "arena" ? ' title="Примерно: день первого появления в Arena"' : ""}>${dayShort(freshRelease(m))}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="6" class="loading">Ничего не нашлось.</td></tr>`;
    $("#count").textContent = `${nf(total)} ${plural(total, "модель", "модели", "моделей")}`;
    $("#periodTbl").innerHTML = periodOptions();
    $("#moreBox").hidden = st.all || total <= LIMIT;
    $("#more").textContent = `Показать все ${nf(total)}`;
    document.querySelectorAll("thead th[data-k]").forEach((th) => {
      if (th.dataset.k === st.k) th.setAttribute("aria-sort", st.dir < 0 ? "descending" : "ascending"); else th.removeAttribute("aria-sort");
    });
  }
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; };

  function updateRankingOptions() {
    const current = models();
    for (const [key, choices] of [["sec", SECTIONS], ["tst", TESTS]]) {
      const allowed = choices.filter(([id]) => current.some(m => metric[id](m) != null));
      const select = $("#" + key);
      if (!allowed.some(([id]) => id === st[key])) st[key] = allowed[0]?.[0] || "";
      select.innerHTML = allowed.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join("") || '<option value="">Нет зачётов</option>';
      select.disabled = !allowed.length;
      select.value = st[key];
    }
  }

  function bindTable() {
    $("#tst").onchange = (e) => { st.tst = e.target.value; st.k = "eci"; st.dir = -1; renderTable(); };
    const orgs = [...new Set(D.models.map((m) => m.org).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    $("#org").innerHTML = `<option value="">все</option>` + orgs.map((o) => `<option>${esc(o)}</option>`).join("");
    $("#q").oninput = (e) => { st.q = e.target.value; renderTable(); };
    $("#sec").onchange = (e) => { st.sec = e.target.value; if (st.k !== "arena") { st.k = "arena"; st.dir = -1; } renderTable(); };
    $("#org").onchange = (e) => { st.org = e.target.value; renderTable(); };
    $("#onlyOpen").onchange = (e) => { st.open = e.target.checked; renderTable(); };
    $("#onlyPrice").onchange = (e) => { st.price = e.target.checked; renderTable(); };
    $("#periodTbl").onchange = (e) => setPeriod(+e.target.value);
    $("#more").onclick = () => { st.all = true; renderTable(); };
    document.querySelectorAll("thead th[data-k] button").forEach((b) => b.addEventListener("click", () => {
      const k = b.parentElement.dataset.k;
      if (st.k === k) st.dir *= -1; else { st.k = k; st.dir = k === "name" || k === "price" ? 1 : -1; }
      renderTable();
    }));
  }

  // ───────── графики ─────────
  // Выбор зрителя (общий для обоих графиков, запоминается в браузере):
  // pins — подписанные модели, only — скрыть остальные, orgs — оставить только этих разработчиков.
  const CS_KEY = "ai-rating-charts";
  const CS = { pins: new Set(), only: false, orgs: new Set(), mode: "agent" };
  try { const s = JSON.parse(localStorage.getItem(CS_KEY) || "{}"); CS.pins = new Set(s.pins || []); CS.only = !!s.only; CS.orgs = new Set(s.orgs || []); if (s.mode === "agent" || s.mode === "epoch") CS.mode = s.mode; } catch (e) { /* без памяти */ }
  const saveCS = () => { try { localStorage.setItem(CS_KEY, JSON.stringify({ pins: [...CS.pins], only: CS.only, orgs: [...CS.orgs], mode: CS.mode })); } catch (e) { /* без памяти */ } };
  const orgKey = (m) => ORGC[m.org] ? m.org : "other";
  const visible = (m) => (!CS.orgs.size || CS.orgs.has(orgKey(m))) && (!CS.only || !CS.pins.size || CS.pins.has(m.id));

  function scatter(svg, all, o) {
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
    const pts = all.filter((p) => visible(p.m));
    const pinned = CS.pins.size > 0;
    const labels = pinned ? pts.filter((p) => CS.pins.has(p.m.id)) : o.auto(pts);
    const lab = new Set(labels.map((p) => p.m.id));
    // точки: подписанные — крупнее и поверх, остальные при выборе бледнее
    const drawn = [...pts].sort((a, b) => lab.has(a.m.id) - lab.has(b.m.id));
    for (const p of drawn) {
      const on = lab.has(p.m.id), dim = pinned && !on;
      s += `<circle class="pt${on ? " on" : ""}" data-id="${esc(p.m.id)}" cx="${X(p.x)}" cy="${Y(p.y)}" r="${on ? 6.5 : 4.5}" fill="${color(p.m.org)}" fill-opacity="${on ? 1 : dim ? .22 : .75}" stroke="${on ? "var(--text)" : "var(--bg)"}" stroke-width="${on ? 1.6 : 1.2}"/>`;
    }
    // подписи: пробуем справа, слева, сверху, снизу; не налезаем на другие подписи, точки и края
    const placed = [];
    const dots = pts.map((p) => ({ x: X(p.x), y: Y(p.y), id: p.m.id }));
    const hits = (bx, self) => placed.filter((b) => !(bx.x > b.x + b.w || bx.x + bx.w < b.x || bx.y > b.y + b.h || bx.y + bx.h < b.y)).length * 10
      + dots.filter((d) => d.id !== self && d.x > bx.x - 4 && d.x < bx.x + bx.w + 4 && d.y > bx.y - 4 && d.y < bx.y + bx.h + 4).length;
    for (const p of labels) {
      const cx = X(p.x), cy = Y(p.y), w = p.m.name.length * 6.3 + 4, h = 14;
      const cands = [
        { x: cx + 9, y: cy - h / 2, a: "start", tx: cx + 9, ty: cy + 4 },
        { x: cx - 9 - w, y: cy - h / 2, a: "end", tx: cx - 9, ty: cy + 4 },
        { x: cx - w / 2, y: cy - 10 - h, a: "middle", tx: cx, ty: cy - 13 },
        { x: cx - w / 2, y: cy + 10, a: "middle", tx: cx, ty: cy + 21 },
        { x: cx + 7, y: cy - 8 - h, a: "start", tx: cx + 7, ty: cy - 11 },
        { x: cx - 7 - w, y: cy - 8 - h, a: "end", tx: cx - 7, ty: cy - 11 },
      ].filter((c) => c.x >= L - 2 && c.x + w <= W - R + 2 && c.y >= 0 && c.y + h <= H2 - B + 2)
        .map((c) => ({ ...c, w, h, score: 0 }));
      if (!cands.length) continue;
      cands.forEach((c) => { c.score = hits(c, p.m.id); });
      const best = cands.reduce((a, b) => (b.score < a.score ? b : a));
      if (!pinned && best.score >= 10) continue; // в авто-режиме лишние подписи не рисуем
      placed.push(best);
      s += `<text class="lbl" x="${best.tx}" y="${best.ty}" text-anchor="${best.a}">${esc(p.m.name)}</text>`;
    }
    if (!pts.length) s += `<text x="${(L + W - R) / 2}" y="${(T + H2 - B) / 2}" text-anchor="middle">Нет моделей под выбранные фильтры</text>`;
    svg.innerHTML = s;
    const fig = svg.closest(".chart");
    let tip = fig.querySelector(".tip");
    if (!tip) { tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; fig.appendChild(tip); }
    const byId = new Map(pts.map((p) => [p.m.id, p]));
    const show = (c) => {
      const p = byId.get(c.dataset.id); if (!p) return;
      tip.innerHTML = o.tip(p) + `<br><span class="muted">${CS.pins.has(p.m.id) ? "Нажмите, чтобы убрать подпись" : "Нажмите, чтобы подписать"}</span>`;
      tip.hidden = false;
      const fr = fig.getBoundingClientRect(), cr = c.getBoundingClientRect();
      let left = cr.left - fr.left + 12, top = cr.top - fr.top - 10;
      if (left + 240 > fr.width) left = cr.left - fr.left - 250;
      tip.style.left = Math.max(6, left) + "px"; tip.style.top = Math.max(6, top) + "px";
    };
    svg.onmousemove = (e) => { const c = e.target.closest(".pt"); if (c) show(c); else tip.hidden = true; };
    svg.onmouseleave = () => { tip.hidden = true; };
    svg.onclick = (e) => {
      const c = e.target.closest(".pt"); if (!c) { tip.hidden = true; return; }
      togglePin(c.dataset.id);
    };
  }
  function niceTicks(a, b, step) { const out = []; for (let v = Math.ceil(a / step) * step; v <= b; v += step) out.push(Math.round(v)); return out; }

  function togglePin(id) {
    if (CS.pins.has(id)) CS.pins.delete(id); else CS.pins.add(id);
    saveCS(); renderCharts();
  }

  function renderChartTools() {
    const isAgent = CS.mode === "agent";
    const inCharts = models().filter((m) => isAgent ? (m.arena.agent && (m.arena.text || m.arena.agent.cost_p50 > 0)) : (m.eci && (m.arena.text || blended(m) > 0)));
    const byId = new Map(D.models.map((m) => [m.id, m]));
    for (const id of [...CS.pins]) if (!byId.has(id)) CS.pins.delete(id);
    const orgs = Object.keys(ORGC).filter((o) => inCharts.some((m) => m.org === o));
    const box = $("#chartTools");
    box.innerHTML = `<div class="ct-row">
        <div class="ct-mode" role="group" aria-label="Режим графиков">
          <button type="button" class="chip" data-cmode="agent" aria-pressed="${isAgent}">Agent Arena и цена задачи</button>
          <button type="button" class="chip" data-cmode="epoch" aria-pressed="${!isAgent}">Тесты Epoch и цена токенов</button>
        </div>
        <div class="field ct-add"><label for="pinAdd">Подписать</label><input id="pinAdd" list="pinList" placeholder="Claude Fable 5.2, Gemini 4 Neon…" autocomplete="off"></div>
        <datalist id="pinList">${inCharts.map((m) => `<option value="${esc(m.name)}"></option>`).join("")}</datalist>
        <div class="field"><label for="periodCh">Вышли</label><select id="periodCh">${periodOptions()}</select></div>
        <label class="toggle" for="pinOnly"><input type="checkbox" id="pinOnly"${CS.only ? " checked" : ""}${CS.pins.size ? "" : " disabled"}>только подписанные</label>
        ${CS.pins.size || CS.orgs.size || CS.only ? `<button type="button" class="btn sm" id="pinReset">Сбросить</button>` : ""}
      </div>
      <p class="ct-msg" id="pinMsg" role="status" hidden></p>
      ${CS.pins.size ? `<div class="pins">${[...CS.pins].map((id) => byId.get(id)).filter(Boolean).map((m) => `<button type="button" class="pin" data-id="${esc(m.id)}" title="Убрать подпись"><i class="dot" style="background:${color(m.org)}"></i>${esc(m.name)}<span aria-hidden="true">×</span><span class="sr-only">убрать</span></button>`).join("")}</div>`
        : `<p class="ct-hint">Нажмите на точку, чтобы подписать модель, или найдите её в поле выше. Пока ничего не выбрано, подписаны самые заметные модели.</p>`}
      <div class="legend" role="group" aria-label="Разработчики">${[...orgs, "other"].map((o) => `<button type="button" class="org-chip" data-org="${esc(o)}" aria-pressed="${CS.orgs.has(o)}"><i class="dot" style="background:${color(o === "other" ? "" : o)}"></i>${esc(o === "other" ? "другие" : o)}</button>`).join("")}${CS.orgs.size ? `<span class="ct-note">показаны только выбранные разработчики</span>` : ""}</div>`;
    box.querySelectorAll("button[data-cmode]").forEach((b) => b.onclick = () => { CS.mode = b.dataset.cmode; saveCS(); renderCharts(); });
    const add = $("#pinAdd");
    const tryAdd = (exact) => {
      const q = add.value.trim().toLowerCase(); if (!q) return;
      const m = inCharts.find((x) => x.name.toLowerCase() === q) || (!exact && inCharts.find((x) => x.name.toLowerCase().includes(q)));
      if (m) { CS.pins.add(m.id); saveCS(); renderCharts(); $("#pinAdd")?.focus(); return; }
      const other = D.models.find((x) => x.name.toLowerCase() === q) || (!exact && D.models.find((x) => x.name.toLowerCase().includes(q)));
      const msg = $("#pinMsg");
      msg.textContent = other && PERIOD && !isFresh(other) ? `${other.name} вышла раньше, чем за ${periodName()}, и скрыта. Выберите срок подлиннее или «все модели».` :
        other ? `${other.name} нет на этом графике: у модели пока нет ${isAgent ? "замера Agent Arena" : "индекса Epoch"}. Она есть в таблице выше.` : `Не нашёл «${add.value.trim()}». Попробуйте часть названия, например «Neon».`;
      msg.hidden = false;
    };
    add.addEventListener("change", () => tryAdd(true));
    add.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); tryAdd(false); } });
    $("#pinOnly").onchange = (e) => { CS.only = e.target.checked; saveCS(); renderCharts(); };
    $("#periodCh").onchange = (e) => setPeriod(+e.target.value);
    const reset = $("#pinReset"); if (reset) reset.onclick = () => { CS.pins.clear(); CS.orgs.clear(); CS.only = false; saveCS(); renderCharts(); };
    box.querySelectorAll(".pin").forEach((b) => b.onclick = () => togglePin(b.dataset.id));
    box.querySelectorAll(".org-chip").forEach((b) => b.onclick = () => {
      const o = b.dataset.org; if (CS.orgs.has(o)) CS.orgs.delete(o); else CS.orgs.add(o); saveCS(); renderCharts();
    });
  }

  function emptyScatter(svg, msg) {
    svg.setAttribute("viewBox", "0 0 640 420");
    svg.innerHTML = `<text x="320" y="210" text-anchor="middle">${esc(msg)}</text>`;
    const tip = svg.closest(".chart")?.querySelector(".tip");
    if (tip) tip.hidden = true;
    svg.onmousemove = null; svg.onmouseleave = null; svg.onclick = null;
  }

  function renderCharts() {
    renderChartTools();
    const isAgent = CS.mode === "agent";
    const frontOf = (list) => { const f = []; let best = -Infinity; [...list].sort((a, c) => a.x - c.x || c.y - a.y).forEach((p) => { if (p.y > best) { best = p.y; f.push(p); } }); return f; };
    const fewMsg = "За этот период мало моделей с обоими замерами — выберите срок подлиннее";
    if (isAgent) {
      $("#sc1Title").textContent = "Агентная работа vs обычный чат";
      $("#sc1Desc").textContent = "По горизонтали обычный чат Arena, по вертикали Agent Arena (многошаговые задачи). Выше линии — модели, которые особенно сильны в реальной работе.";
      $("#sc2Title").textContent = "Сила агента и цена одной задачи";
      $("#sc2Desc").textContent = "Медианная стоимость одной агентной задачи в долларах (лог. шкала, Agent Arena). Пунктир — самые выгодные модели: сильнее за эти деньги нет.";
      const p1 = models().filter((m) => m.arena.agent && m.arena.text).map((m) => ({ m, x: m.arena.text.elo, y: m.arena.agent.elo }));
      if (p1.length > 3) {
        const xs = p1.map((p) => p.x), ys = p1.map((p) => p.y);
        const x0 = Math.floor(Math.min(...xs) / 20) * 20 - 10, x1 = Math.ceil(Math.max(...xs) / 20) * 20 + 10;
        const y0 = Math.floor(Math.min(...ys) / 50) * 50 - 20, y1 = Math.ceil(Math.max(...ys) / 50) * 50 + 20;
        const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
        const k = p1.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / p1.reduce((a, p) => a + (p.x - mx) ** 2, 0), b = my - k * mx;
        const resid = (p) => p.y - (k * p.x + b);
        scatter($("#sc1"), p1, {
          x0, x1, y0, y1, xl: "Обычный чат · Elo Arena", yl: "Агент · индекс Agent Arena",
          auto: (pts) => [...new Set([
            ...[...pts].sort((a, c) => c.y - a.y).slice(0, 5),
            ...[...pts].sort((a, c) => c.x - a.x).slice(0, 3),
            ...[...pts].sort((a, c) => resid(c) - resid(a)).slice(0, 2),
          ])],
          xt: niceTicks(x0, x1, 20).map((v) => ({ v, l: v })), yt: niceTicks(y0, y1, 50),
          line: [[x0, k * x0 + b], [x1, k * x1 + b]],
          tip: (p) => `<b>${esc(p.m.name)}</b>${esc(p.m.org)}<br>Агент: ${nf(p.y)} (${esc(p.m.arena.agent.mode || "режим не указан")}) · Чат: ${nf(p.x)}`,
        });
      } else emptyScatter($("#sc1"), fewMsg);
      const p2 = models().filter((m) => m.arena.agent && m.arena.agent.cost_p50 > 0).map((m) => ({ m, x: Math.log10(m.arena.agent.cost_p50), y: m.arena.agent.elo }));
      if (p2.length > 3) {
        const xs = p2.map((p) => p.x), ys = p2.map((p) => p.y);
        const x0 = Math.floor(Math.min(...xs) * 2) / 2 - 0.1, x1 = Math.ceil(Math.max(...xs) * 2) / 2 + 0.1;
        const y0 = Math.floor(Math.min(...ys) / 50) * 50 - 20, y1 = Math.ceil(Math.max(...ys) / 50) * 50 + 20;
        const front = frontOf(p2);
        const ticks = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20].filter((v) => Math.log10(v) >= x0 && Math.log10(v) <= x1);
        scatter($("#sc2"), p2, {
          x0, x1, y0, y1, xl: "Медианная цена задачи, $ (лог. шкала)", yl: "Агент · индекс Agent Arena",
          auto: (pts) => [...new Set([...frontOf(pts).slice(-6).reverse(), ...[...pts].sort((a, c) => c.y - a.y).slice(0, 4)])],
          xt: ticks.map((v) => ({ v: Math.log10(v), l: "$" + String(v).replace(".", ",") })), yt: niceTicks(y0, y1, 50),
          line: front.map((p) => [p.x, p.y]),
          tip: (p) => `<b>${esc(p.m.name)}</b>${esc(p.m.org)} · режим ${esc(p.m.arena.agent.mode || "не указан")}<br>Агент: ${nf(p.y)} (#${p.m.arena.agent.rank}) · ~$${money(p.m.arena.agent.cost_p50)} / задача${esc(rubApprox(p.m.arena.agent.cost_p50))}`,
        });
      } else emptyScatter($("#sc2"), fewMsg);
      return;
    }
    $("#sc1Title").textContent = "Умная по тестам ≠ любимая людьми";
    $("#sc1Desc").textContent = "По горизонтали индекс Epoch, по вертикали Elo в Arena. Выше линии — модели, которые людям нравятся больше, чем можно ждать по тестам.";
    $("#sc2Title").textContent = "Сила и цена";
    $("#sc2Desc").textContent = "Цена за 1 млн токенов (3 части входа на 1 часть выхода), шкала логарифмическая. Пунктир — самые выгодные модели: сильнее за эти деньги нет.";
    // 1. тесты × люди
    const p1 = models().filter((m) => m.eci && m.arena.text).map((m) => ({ m, x: m.eci.v, y: m.arena.text.elo }));
    if (p1.length > 3) {
      const xs = p1.map((p) => p.x), ys = p1.map((p) => p.y);
      const x0 = Math.floor(Math.min(...xs) / 5) * 5 - 2, x1 = Math.ceil(Math.max(...xs) / 5) * 5 + 2;
      const y0 = Math.floor(Math.min(...ys) / 20) * 20 - 10, y1 = Math.ceil(Math.max(...ys) / 20) * 20 + 10;
      const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
      const k = p1.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / p1.reduce((a, p) => a + (p.x - mx) ** 2, 0), b = my - k * mx;
      const resid = (p) => p.y - (k * p.x + b);
      scatter($("#sc1"), p1, {
        x0, x1, y0, y1, xl: "Тесты · индекс Epoch", yl: "Люди · Elo Arena",
        auto: (pts) => [...new Set([
          ...[...pts].sort((a, c) => c.x - a.x).slice(0, 4),
          ...[...pts].sort((a, c) => c.y - a.y).slice(0, 3),
          ...[...pts].sort((a, c) => resid(c) - resid(a)).slice(0, 2),
          ...[...pts].sort((a, c) => resid(a) - resid(c)).slice(0, 2),
        ])],
        xt: niceTicks(x0, x1, 5).map((v) => ({ v, l: v })), yt: niceTicks(y0, y1, 20),
        line: [[x0, k * x0 + b], [x1, k * x1 + b]],
        tip: (p) => `<b>${esc(p.m.name)}</b>${esc(p.m.org)}<br>Тесты: ${nf(p.x, 1)} · Arena: ${nf(p.y)} (#${p.m.arena.text.rank}, ${esc(p.m.arena.text.mode || "режим не указан")})`,
      });
    } else emptyScatter($("#sc1"), fewMsg);
    // 2. сила × цена
    const p2 = models().filter((m) => m.eci && blended(m) > 0).map((m) => ({ m, x: Math.log10(blended(m)), y: m.eci.v }));
    if (p2.length > 3) {
      const xs = p2.map((p) => p.x), ys = p2.map((p) => p.y);
      const x0 = Math.floor(Math.min(...xs) * 2) / 2 - 0.1, x1 = Math.ceil(Math.max(...xs) * 2) / 2 + 0.1;
      const y0 = Math.floor(Math.min(...ys) / 10) * 10 - 2, y1 = Math.ceil(Math.max(...ys) / 10) * 10 + 2;
      const front = frontOf(p2);
      const ticks = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100].filter((v) => Math.log10(v) >= x0 && Math.log10(v) <= x1);
      scatter($("#sc2"), p2, {
        x0, x1, y0, y1, xl: "Цена, $ за 1 млн токенов (лог. шкала)", yl: "Тесты · индекс Epoch",
        auto: (pts) => frontOf(pts).slice(-7).reverse(),
        xt: ticks.map((v) => ({ v: Math.log10(v), l: "$" + String(v).replace(".", ",") })), yt: niceTicks(y0, y1, 10),
        line: front.map((p) => [p.x, p.y]),
        tip: (p) => `<b>${esc(p.m.name)}</b>${esc(p.m.org)}<br>Тесты: ${nf(p.y, 1)} · $${money(10 ** p.x)} за 1 млн<br><span class="muted">вход $${money(p.m.price.in)}, выход $${money(p.m.price.out)}</span>`,
      });
    } else emptyScatter($("#sc2"), fewMsg);
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
    ].join("");
    const sources = [["arena","Arena"],["epoch","Epoch"],["openrouter","OpenRouter"],["contra","Contra"],["designarena","DesignArena"],["cbr","ЦБ РФ"]];
    const sourceRows = sources.filter(([key])=>s[key] || src[key]).map(([key,name])=>{
      const meta=src[key]||{}, last=s[key]?.fetched || meta.fetched, count=meta.count;
      const timestamp=last ? new Date(last).toLocaleString("ru-RU",{timeZone:"Europe/Moscow",dateStyle:"short",timeStyle:"short"})+" МСК" : "не указана";
      return "<li><b>"+name+"</b> · последняя загрузка "+esc(timestamp)+(count!=null?" · записей "+nf(count):"")+(meta.published?" · публикация "+esc(meta.published):"")+(s[key]?.ok===false?" · из кэша":"")+"</li>";
    });
    let detail=$("#sourceDates");
    if(!detail){detail=document.createElement("details");detail.id="sourceDates";detail.className="source-times";$("#status").after(detail);}
    detail.innerHTML="<summary>Свежесть источников</summary><ul>"+sourceRows.join("")+"</ul>";
    $("#period").innerHTML = `<span class="period-label">Вышли за</span><span class="period-chips" role="group" aria-label="Срок выхода моделей">${
      PERIODS.map(([d, , short]) => `<button type="button" class="chip" data-d="${d}" aria-pressed="${d === PERIOD}">${short}</button>`).join("")
    }</span><span class="period-count"><b>${nf(models().length)}</b> из ${nf(D.models.length)} ${plural(D.models.length, "модели", "моделей", "моделей")}</span>`;
    $("#period").onclick = (e) => { const b = e.target.closest("button[data-d]"); if (b) setPeriod(+b.dataset.d); };
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
    CUTOFF = PERIOD > 0 ? new Date(new Date(D.built).getTime() - PERIOD * 864e5).toISOString().slice(0, 10) : "";
    buildNorm(); identifyGenerations(); updateRankingOptions(); bindPair(); renderStatus(); renderLeaders(); renderTasks(); bindTable(); renderTable(); renderCharts();
    let rt; let lastW = innerWidth;
    addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (Math.abs(innerWidth - lastW) > 40) { lastW = innerWidth; renderCharts(); } }, 250); });
  }).catch((e) => {
    $("#status").innerHTML = `<span class="pill"><i class="stale"></i>Не удалось загрузить данные. Обновите страницу.</span>`;
    console.error(e);
  });
})();
