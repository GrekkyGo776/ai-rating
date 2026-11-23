#!/usr/bin/env python3
"""Собирает данные для сайта «Рейтинг нейросетей» из открытых источников.

Источники (все открытые, ключи не нужны):
  * Arena — официальный набор lmarena-ai/leaderboard-dataset на Hugging Face (CC BY 4.0);
  * Epoch AI — индекс возможностей ECI (CC BY 4.0);
  * OpenRouter — публичный список моделей с ценами.

Шаги:
  1. fetch — скачать каждый источник в data/cache/<источник>.json (Arena — ещё и полную историю:
     даты первого появления моделей и места за 60 дней).
     Если источник не ответил, остаётся вчерашний кэш, а в статусе
     появляется пометка «не обновился».
  2. merge — свести кэши в site/data/models.json и дописать снимок
     лидеров в site/data/history.json.

Запуск:  python scripts/build_data.py            (fetch + merge)
         python scripts/build_data.py --offline  (только merge из кэша)
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "cache"
OUT = ROOT / "site" / "data"
ALIASES = ROOT / "config" / "aliases.json"
OWN = ROOT / "config" / "own_benchmarks.json"
UA = "ai-rating-site/1.0 (+https://ai.fizmat.guru)"

HF_DATASET = "lmarena-ai/leaderboard-dataset"
# Разделы Arena, которые показываем: (id на сайте, подмножество набора, категория)
ARENA_SECTIONS = [
    ("agent", "agent_capability", "overall"),
    ("agent_work", "agent_capability", "work"),
    ("agent_code", "agent_capability", "code"),
    ("agent_outcome", "agent_task_outcome", "overall"),
    ("text", "text_style_control", "overall"),
    ("ru", "text_style_control", "russian"),
    ("math", "text_style_control", "math"),
    ("code", "text_style_control", "coding"),
    ("creative", "text_style_control", "creative_writing"),
    ("hard", "text_style_control", "hard_prompts"),
    ("web", "webdev", "overall"),
    ("web_react", "webdev", "webdev-react"),
    ("vision", "vision", "overall"),
    ("vision_hw", "vision", "homework"),
    ("doc", "document", "overall"),
]
EPOCH_ZIP = "https://epoch.ai/data/benchmark_data.zip"
OPENROUTER = "https://openrouter.ai/api/v1/models"
CBR = "https://www.cbr.ru/scripts/XML_daily.asp"
DESIGNARENA_VIDEO = "https://www.designarena.ai/api/leaderboard?arenaType=agents&category=agon_code_video"

MSK = dt.timezone(dt.timedelta(hours=3))


# ───────────────────────── сеть ─────────────────────────

def http_get(url: str, tries: int = 4, timeout: int = 90) -> bytes:
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 — любая сетевая ошибка → повтор
            last = e
            time.sleep(2 + 3 * i)
    raise RuntimeError(f"{url}: {last}")


# ───────────────────────── Arena ─────────────────────────

def _arena_rows_parquet(subset: str) -> list[dict]:
    import pyarrow.parquet as pq  # в GitHub Actions ставится из requirements.txt

    url = f"https://huggingface.co/datasets/{HF_DATASET}/resolve/main/{subset}/latest-00000-of-00001.parquet"
    table = pq.read_table(io.BytesIO(http_get(url)))
    return table.to_pylist()


def _arena_rows_json(subset: str, category: str) -> list[dict]:
    """Запасной путь без pyarrow: JSON-API Hugging Face (медленнее, иногда отвечает 5xx)."""
    rows, offset = [], 0
    where = urllib.parse.quote(f"\"category\"='{category}'")
    while True:
        url = (f"https://datasets-server.huggingface.co/filter?dataset={HF_DATASET}&config={subset}"
               f"&split=latest&where={where}&offset={offset}&length=100")
        d = json.loads(http_get(url, tries=6))
        batch = [x["row"] for x in d.get("rows", [])]
        rows += batch
        offset += 100
        if not batch or offset >= d.get("num_rows_total", 0):
            return rows


def _arena_num(row: dict, *cols: str) -> float | None:
    for col in cols:
        val = row.get(col)
        if val is not None:
            num = float(val)
            if math.isfinite(num):
                return num
    return None


def fetch_arena() -> dict:
    try:
        import pyarrow  # noqa: F401
        use_parquet = True
    except ImportError:
        use_parquet = False
    by_subset: dict[str, list[dict]] = {}
    sections = {}
    published = None

    def load_rows(subset: str, category: str) -> list[dict]:
        if use_parquet:
            if subset not in by_subset:
                by_subset[subset] = _arena_rows_parquet(subset)
            return [r for r in by_subset[subset] if r.get("category") == category]
        return _arena_rows_json(subset, category)

    # Медианная стоимость реальной агентной задачи и объём вывода из поднабора agent
    agent_costs: dict[str, dict] = {}
    try:
        for r in load_rows("agent", "overall"):
            cost = _arena_num(r, "cost_per_task_p50")
            toks = _arena_num(r, "output_tokens_per_task_p50")
            meta = {}
            if cost is not None and cost >= 0:
                meta["cost_p50"] = round(cost, 2)
            if toks is not None and toks >= 0:
                meta["tokens_p50"] = int(round(toks))
            if meta:
                agent_costs[r["model_name"]] = meta
    except Exception as e:  # noqa: BLE001 — отсутствие цен не должно ломать весь Arena
        print(f"! agent cost metadata skipped: {e}", file=sys.stderr)

    for sid, subset, category in ARENA_SECTIONS:
        rows = load_rows(subset, category)
        if not rows:
            raise RuntimeError(f"Arena: пустой раздел {subset}/{category}")
        published = max(published or "", max(str(r["leaderboard_publish_date"])[:10] for r in rows))
        parsed = []
        for r in rows:
            elo = _arena_num(r, "rating", "index_score")
            if elo is None:
                continue
            lo = _arena_num(r, "rating_lower", "index_score_ci_lower")
            hi = _arena_num(r, "rating_upper", "index_score_ci_upper")
            votes = int(round(_arena_num(r, "vote_count", "session_count", "observation_count") or 0))
            item = {
                "name": r["model_name"],
                "org": r.get("organization") or "",
                "license": r.get("license") or "",
                "elo": round(elo, 1),
                "lo": round(lo, 1) if lo is not None else None,
                "hi": round(hi, 1) if hi is not None else None,
                "votes": votes,
                "rank": int(r["rank"]),
            }
            if sid == "agent" and r["model_name"] in agent_costs:
                item.update(agent_costs[r["model_name"]])
            parsed.append(item)
        sections[sid] = parsed
    return {"published": published, "sections": sections}


# ───────────────────────── Epoch ─────────────────────────

def fetch_epoch() -> dict:
    z = zipfile.ZipFile(io.BytesIO(http_get(EPOCH_ZIP, timeout=180)))
    name = next(n for n in z.namelist() if n.endswith("epoch_capabilities_index/eci_scores.csv"))
    rows = list(csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8")))
    models = []
    for r in rows:
        try:
            eci = float(r["eci"])
        except (TypeError, ValueError):
            continue
        models.append({
            "name": r.get("Display name") or r["Model"],
            "source_id": r["Model"],
            "eci": round(eci, 1),
            "lo": round(float(r["eci_ci_low"]), 1) if r.get("eci_ci_low") else None,
            "hi": round(float(r["eci_ci_high"]), 1) if r.get("eci_ci_high") else None,
            "date": r.get("date") or None,
            "org": r.get("Organization") or "",
            "country": r.get("Country (of organization)") or "",
            "open": {"Open weights": True, "Closed weights": False}.get(r.get("Accessibility group")),
        })
    return {"latest_model_date": max((m["date"] or "") for m in models), "models": models, "bench": epoch_benchmarks(z)}


# Отдельные тесты Epoch: (id на сайте, файл в архиве, колонка с баллом). Балл — доля от 0 до 1.
EPOCH_BENCH = [
    ("physics", "critpt_external.csv", "Accuracy"),                          # CritPt: исследовательская физика
    ("mathx", "frontiermath_tiers_1_3_v2.csv", "Best score (across scorers)"),  # FrontierMath, уровни 1–3
    ("science", "gpqa_diamond.csv", "Best score (across scorers)"),          # GPQA Diamond: наука
    ("facts", "simpleqa_verified.csv", "Best score (across scorers)"),       # SimpleQA Verified: точность фактов
]


def epoch_benchmarks(z: zipfile.ZipFile) -> dict:
    names = z.namelist()
    meta_name = next((n for n in names if n.endswith("model_metadata.csv")), None)
    metadata = {}
    versions_by_group = {}
    if meta_name:
        for r in csv.DictReader(io.TextIOWrapper(z.open(meta_name), encoding="utf-8")):
            if r.get("model_version"):
                metadata[r["model_version"]] = r
                version_base = r["model_version"].split("_", 1)[0]
                versions_by_group.setdefault(r.get("model_group"), set()).add(version_base)
    out = {}
    for bid, fname, col in EPOCH_BENCH:
        path = next((n for n in names if n.endswith("/" + fname) or n == fname), None)
        if not path:
            continue
        rows = []
        for r in csv.DictReader(io.TextIOWrapper(z.open(path), encoding="utf-8")):
            source_id = r.get("Model version") or ""
            meta = metadata.get(source_id, {})
            name = r.get("Name") or meta.get("display_name")
            source_label = name or source_id
            mode = None
            if not name and source_id:
                base, _, mode = source_id.partition("_")
                group = meta.get("model_group")
                # A group containing several releases or base/instruct variants is ambiguous.
                name = group if group and len(versions_by_group[group]) == 1 else base.split("/")[-1]
                if mode and re.fullmatch(r"\d+k", mode, re.I):
                    mode += " thinking"
            try:
                v = float(r.get(col) or "")
            except ValueError:
                continue
            if not name:
                continue
            se = r.get("stderr")
            rows.append({"name": name, "v": round(v, 4), "se": round(float(se), 4) if se not in (None, "") else None,
                         "date": r.get("Release date") or meta.get("date") or None, "source_id": source_id or None,
                         "source_label": source_label, "mode": mode,
                         "org": r.get("Organization") or meta.get("organization") or "",
                         "country": r.get("Country") or meta.get("country") or ""})
        out[bid] = rows
    return out


# ───────────────────────── OpenRouter ─────────────────────────

def unit_price(raw):
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return round(value * 1e6, 8) if math.isfinite(value) and value >= 0 else None


def fetch_openrouter() -> dict:
    page = OPENROUTER
    seen = set()
    data = []
    while page:
        if page in seen or urllib.parse.urlsplit(page).netloc != "openrouter.ai":
            raise ValueError("OpenRouter вернул некорректную ссылку на следующую страницу")
        seen.add(page)
        result = json.loads(http_get(page))
        data.extend(result["data"])
        next_page = (result.get("links") or {}).get("next")
        page = urllib.parse.urljoin(page, next_page) if next_page else None
    if not data:
        raise ValueError("Пустой каталог OpenRouter")
    models = []
    for m in data:
        mid = m.get("id", "")
        if ":" in mid:  # :free, :batch, :extended — варианты одной модели
            continue
        p = m.get("pricing") or {}
        try:
            pin, pout = float(p.get("prompt")), float(p.get("completion"))
        except (TypeError, ValueError):
            continue
        if pin < 0 or pout < 0:
            continue
        name = m.get("name") or mid
        tiers = []
        for tier in p.get("overrides") or []:
            if not isinstance(tier.get("min_prompt_tokens"), int):
                continue
            rates = {key: unit_price(tier.get(field)) for key, field in
                     [("in", "prompt"), ("out", "completion"), ("cache_read", "input_cache_read"), ("cache_write", "input_cache_write")]}
            tiers.append({"min_prompt_tokens": tier["min_prompt_tokens"], **{k: v for k, v in rates.items() if v is not None}})
        models.append({
            "id": mid,
            "canonical_slug": m.get("canonical_slug"),
            "name": name.split(": ", 1)[-1],
            "in": round(pin * 1e6, 4),
            "out": round(pout * 1e6, 4),
            "context": m.get("context_length"),
            "max_output": (m.get("top_provider") or {}).get("max_completion_tokens"),
            "input_modalities": (m.get("architecture") or {}).get("input_modalities"),
            "cache_read": unit_price(p.get("input_cache_read")),
            "cache_write": unit_price(p.get("input_cache_write")),
            "tiers": sorted(tiers, key=lambda row: row["min_prompt_tokens"]),
            "created": dt.datetime.fromtimestamp(m["created"], dt.timezone.utc).date().isoformat() if m.get("created") else None,
        })
    return {"models": models}


def fetch_cbr() -> dict:
    xml = ET.fromstring(http_get(CBR))
    usd = next(node for node in xml.findall("Valute") if node.findtext("CharCode") == "USD")
    value = float(usd.findtext("Value").replace(",", ".")) / int(usd.findtext("Nominal"))
    if not math.isfinite(value) or value <= 0:
        raise ValueError("Некорректный курс USD ЦБ РФ")
    return {"usd_rub": value, "date": dt.datetime.strptime(xml.attrib["Date"], "%d.%m.%Y").date().isoformat(),
            "source": "ЦБ РФ"}


def fetch_contra_source() -> dict:
    from contra_data import fetch_contra
    return fetch_contra(http_get)


def fetch_designarena() -> dict:
    """DesignArena · Code to Video (агент пишет код и рендерит видео/анимацию)."""
    raw = json.loads(http_get(DESIGNARENA_VIDEO, timeout=45).decode("utf-8"))
    rows = raw.get("data") or []
    if not rows:
        raise ValueError("DesignArena: пустой список agon_code_video")
    models = []
    for idx, r in enumerate(rows, 1):
        mid = str(r.get("modelId") or "").strip()
        elo = r.get("elo")
        if not mid or elo is None:
            continue
        wr = r.get("winRate")
        cost = r.get("avgCostUsd")
        models.append({
            "id": mid,
            "elo": round(float(elo), 1),
            "win_rate": round(float(wr) / 100.0, 4) if wr is not None else None,
            "battles": int(r.get("battles") or 0),
            "cost": round(float(cost), 2) if cost is not None and float(cost) >= 0 else None,
            "rank": idx,
        })
    return {"models": models}


# Полная история Arena: когда модель впервые появилась (дата для моделей, которых нет в Epoch и OpenRouter)
# и места за последние 60 дней (стрелки ▲▼). Файл text_style_control — около 60 МБ, читаем только нужные колонки.
HIST_SECTIONS = [("agent", "agent_capability", "overall"), ("text", "text_style_control", "overall"),
                 ("ru", "text_style_control", "russian"), ("math", "text_style_control", "math"),
                 ("web", "webdev", "overall"), ("vision", "vision", "overall"), ("doc", "document", "overall")]


def fetch_arena_history() -> dict:
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    first: dict[str, str] = {}
    snaps: dict[str, dict] = {}
    tables = {}
    score_cols = {}
    for _, subset, _ in HIST_SECTIONS:
        if subset in tables:
            continue
        score_col = "index_score" if subset.startswith("agent_") else "rating"
        score_cols[subset] = score_col
        url = f"https://huggingface.co/datasets/{HF_DATASET}/resolve/main/{subset}/full-00000-of-00001.parquet"
        tables[subset] = pq.read_table(io.BytesIO(http_get(url, timeout=300)),
                                       columns=["model_name", "category", "leaderboard_publish_date", score_col])
    latest = max(str(d)[:10] for tb in tables.values() for d in pc.unique(tb["leaderboard_publish_date"]).to_pylist())
    since = (dt.date.fromisoformat(latest[:10]) - dt.timedelta(days=60)).isoformat()
    for sid, subset, category in HIST_SECTIONS:
        tb = tables[subset]
        score_col = score_cols[subset]
        rows = tb.filter(pc.equal(tb["category"], category)).to_pylist()
        best: dict[str, dict[str, float]] = {}
        for r in rows:
            val = r.get(score_col)
            if val is None or not math.isfinite(float(val)):
                continue
            d = str(r["leaderboard_publish_date"])[:10]
            k = key(r["model_name"])
            if k not in first or d < first[k]:
                first[k] = d
            if d >= since:
                day = best.setdefault(d, {})
                if float(val) > day.get(k, -1e9):
                    day[k] = float(val)
        for d, day in best.items():
            snaps.setdefault(d, {})[sid] = [k for k, _ in sorted(day.items(), key=lambda kv: -kv[1])[:50]]
    return {"latest": latest, "first_seen": first, "snaps": snaps}


FETCHERS = {"arena": fetch_arena, "arena_history": fetch_arena_history, "epoch": fetch_epoch,
            "openrouter": fetch_openrouter, "cbr": fetch_cbr, "contra": fetch_contra_source,
            "designarena": fetch_designarena}


def source_count(source, payload):
    if source == "arena":
        return len({key(r["name"]) for rows in payload.get("sections", {}).values() for r in rows})
    if source == "arena_history":
        return len(payload.get("first_seen", {}))
    if source == "cbr":
        return int(bool(payload.get("usd_rub")))
    return len(payload.get("models", []))


def save_json(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temp.replace(path)


def fetch_all() -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    status = {}
    now = dt.datetime.now(MSK).isoformat(timespec="minutes")
    for src, fn in FETCHERS.items():
        path = CACHE / f"{src}.json"
        old = optional_cache(src)
        try:
            payload = fn()
            count = source_count(src, payload)
            if not count:
                raise ValueError("Источник вернул пустую выгрузку")
            payload["fetched"] = now
            save_json(path, payload)
            status[src] = {"ok": True, "fetched": now}
            previous_count = source_count(src, old)
            if previous_count and count < previous_count * 0.75:
                status[src]["warning"] = f"Охват снизился: {previous_count} → {count}"
            print(f"✓ {src}")
        except Exception as e:  # noqa: BLE001
            status[src] = {"ok": False, "fetched": old.get("fetched"), "error": str(e)[:300]}
            print(f"✗ {src}: {e}", file=sys.stderr)
    return status


# ───────────────────────── сведение ─────────────────────────

MODE_RE = re.compile(
    r"\s*\((?:ultra|max|xhigh|x-high|high|medium|low|minimal|none|non[- ]?reasoning|reasoning|default|adaptive|"
    r"thinking|instant|fast|pro mode)(?:[, ][^)]*)?\)\s*$",
    re.I,
)


def strip_mode(name: str) -> tuple[str, str]:
    m = MODE_RE.search(name)
    if not m:
        return name.strip(), ""
    return name[: m.start()].strip(), m.group(0).strip(" ()")


BENCH_MODE_RE = re.compile(r"\s*\((?=[^)]*\b(?:max|xhigh|x-high|high|medium|low|minimal|none|fallback|reasoning|thinking|together|"
                           r"fireworks|default|adaptive|effort|budget)\b)[^)]*\)\s*$", re.I)


def bench_identity(name: str) -> tuple[str, str]:
    """Месяц версии может соседствовать с режимом в тех же скобках."""
    modes = []
    while match := BENCH_MODE_RE.search(name):
        parts = [s.strip() for s in match.group(0).strip(" ()").split(",")]
        versions = [s for s in parts if re.fullmatch(r"(?:[a-z]{3,9}\s+20\d{2}|20\d{2}-\d\d-\d\d)", s, re.I)]
        modes[0:0] = [s for s in parts if s not in versions]
        name = name[:match.start()].strip()
        if versions:
            name += " (" + ", ".join(versions) + ")"
            break
    return name.strip(), ", ".join(modes)


def norm(name: str) -> str:
    base, _ = strip_mode(name.split(": ", 1)[-1])
    base = base.lower().replace("‑", "-")
    return re.sub(r"[\s\-_.:/]+", "", base)


ORG_NAMES = {
    "openai": "OpenAI", "google": "Google", "google deepmind": "Google", "google deepmind,google": "Google",
    "anthropic": "Anthropic", "meta": "Meta", "meta ai": "Meta", "xai": "xAI", "spacexai": "xAI",
    "deepseek": "DeepSeek", "deepseek,peking university": "DeepSeek", "alibaba": "Alibaba", "moonshot": "Moonshot AI",
    "moonshot ai": "Moonshot AI", "kimi": "Moonshot AI", "z.ai (zhipu ai)": "Z.ai", "zhipu": "Z.ai", "zai": "Z.ai",
    "z.ai": "Z.ai", "z ai": "Z.ai", "mistral": "Mistral", "mistral ai": "Mistral", "minimax": "MiniMax", "nvidia": "NVIDIA",
    "xiaomi": "Xiaomi", "tencent": "Tencent", "amazon": "Amazon", "microsoft": "Microsoft", "cohere": "Cohere",
    "ibm": "IBM", "stepfun": "StepFun", "bytedance": "ByteDance", "baidu": "Baidu", "inclusionai": "InclusionAI",
    "ant group": "InclusionAI", "thinking machines": "Thinking Machines", "allenai": "Ai2", "ai2": "Ai2",
}
ORG_COUNTRY = {
    "OpenAI": "us", "Google": "us", "Anthropic": "us", "Meta": "us", "xAI": "us", "NVIDIA": "us", "Amazon": "us",
    "Microsoft": "us", "IBM": "us", "Thinking Machines": "us", "Ai2": "us",
    "DeepSeek": "cn", "Alibaba": "cn", "Moonshot AI": "cn", "Z.ai": "cn", "MiniMax": "cn", "Xiaomi": "cn",
    "Tencent": "cn", "StepFun": "cn", "ByteDance": "cn", "Baidu": "cn", "InclusionAI": "cn",
    "Mistral": "fr", "Cohere": "ca",
}
COUNTRY_CODES = {"United States of America": "us", "China": "cn", "France": "fr", "United Arab Emirates": "ae",
                 "United Kingdom": "gb", "Canada": "ca", "South Korea": "kr", "Korea (Republic of)": "kr",
                 "Israel": "il", "Japan": "jp", "India": "in", "Switzerland": "ch", "Germany": "de"}


def org_name(raw: str) -> str:
    raw = (raw or "").strip()
    return ORG_NAMES.get(raw.lower(), raw[:1].upper() + raw[1:] if raw else "")


def key(name: str) -> str:
    """Ключ сведения: нормализованное имя с учётом ручных пар из config/aliases.json."""
    global _ALIAS
    if _ALIAS is None:
        pairs = json.loads(ALIASES.read_text(encoding="utf-8")).get("pairs", {}) if ALIASES.exists() else {}
        _ALIAS = {norm(k): norm(v) for k, v in pairs.items()}
    n = norm(name)
    return _ALIAS.get(n, n)


_ALIAS: dict | None = None


def version_date(name: str) -> str | None:
    """Дата в названии версии сама по себе не подтверждает её публичный релиз."""
    m = re.search(r"(?<!\d)(20\d{2})[-.]?(\d{2})[-.]?(\d{2})(?!\d)", name)
    if m:
        try:
            return dt.date(*map(int, m.groups())).isoformat()
        except ValueError:
            pass
    return None


def add_measurement(group: dict, metric: str, sample: dict, value_key: str):
    """Лучший замер доступен старым клиентам, альтернативные режимы сохраняются рядом."""
    current = group.get(metric)
    if current is None:
        group[metric] = sample
        return
    variants = current.get("variants") or [current.copy()]
    if sample in variants:
        return
    variants.append(sample.copy())
    best = max(variants, key=lambda r: r[value_key])
    group[metric] = {**best, "variants": variants}


def optional_cache(name: str):
    path = CACHE / (name + ".json")
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def merge(status: dict | None = None) -> dict:
    arena = json.loads((CACHE / "arena.json").read_text(encoding="utf-8"))
    epoch = json.loads((CACHE / "epoch.json").read_text(encoding="utf-8"))
    orouter = json.loads((CACHE / "openrouter.json").read_text(encoding="utf-8"))
    hist_path = CACHE / "arena_history.json"
    ahist = json.loads(hist_path.read_text(encoding="utf-8")) if hist_path.exists() else {"first_seen": {}, "snaps": {}}
    contra = optional_cache("contra")
    designarena = optional_cache("designarena")
    fx = optional_cache("cbr")
    first_seen = {}
    for source_key, day in ahist["first_seen"].items():
        k = key(source_key)
        first_seen[k] = min(day, first_seen.get(k, day))

    models: dict[str, dict] = {}

    def get(k: str) -> dict:
        return models.setdefault(k, {"arena": {}})

    # Arena: лучший режим модели в каждом разделе
    for sid, rows in arena["sections"].items():
        for r in rows:
            k = key(r["name"])
            m = get(k)
            base, mode = strip_mode(r["name"])
            sample = {
                "elo": r["elo"], "lo": r["lo"], "hi": r["hi"],
                "votes": r["votes"], "rank": r["rank"], "mode": mode,
                "source_label": r["name"],
                "interval_type": "arena_agent" if sid.startswith("agent") else "arena",
            }
            if r.get("cost_p50") is not None:
                sample["cost_p50"] = r["cost_p50"]
            if r.get("tokens_p50") is not None:
                sample["tokens_p50"] = r["tokens_p50"]
            add_measurement(m["arena"], sid, sample, "elo")
            if "aname" not in m or sid == "text" and m["arena"][sid]["source_label"] == r["name"]:
                m["aname"] = base
            m.setdefault("org", org_name(r["org"]))
            if r["license"]:
                m.setdefault("open", r["license"].lower() != "proprietary")

    for e in epoch["models"]:
        m = get(key(e["name"]))
        name, mode = strip_mode(e["name"])
        add_measurement(m, "eci", {"v": e["eci"], "lo": e["lo"], "hi": e["hi"],
                        "mode": mode, "source_label": e["name"], "source_id": e.get("source_id"),
                        "interval_type": "bayesian_90"}, "v")
        if m["eci"]["source_label"] != e["name"]:
            continue
        m["ename"] = name
        if e["org"]:
            m["org"] = org_name(e["org"].split(",")[0]) if "," in e["org"] and "google" not in e["org"].lower() else org_name(e["org"])
        if e["country"]:
            m["cc"] = COUNTRY_CODES.get(e["country"], "")
        if e["open"] is not None:
            m["open"] = e["open"]
        if e["date"]:
            m["date"] = e["date"]

    for bid, rows in (epoch.get("bench") or {}).items():
        for r in rows:
            name, mode = bench_identity(r["name"])
            m = get(key(name))
            m.setdefault("bname", name)
            if r.get("org") and not m.get("org"):
                m["org"] = org_name(r["org"])
            if r.get("country") and not m.get("cc"):
                m["cc"] = COUNTRY_CODES.get(r["country"], "")
            if r.get("date"):
                m.setdefault("bench_dates", set()).add(r["date"])
            se = r["se"]
            measurement = {"v": r["v"], "lo": None, "hi": None, "mode": r.get("mode") or mode,
                           "source_label": r.get("source_label") or r["name"], "source_id": r.get("source_id"),
                           "interval_type": None}
            if se is not None:
                measurement.update(lo=round(max(0, r["v"] - 1.96 * se), 4),
                                   hi=round(min(1, r["v"] + 1.96 * se), 4), interval_type="normal_95")
            add_measurement(m.setdefault("bench", {}), bid, measurement, "v")

    for row in contra.get("models", []):
        m = get(key(row["name"]))
        m["contra"] = {k: v for k, v in row.items() if k not in ("name", "org")}
        m["cname"] = row["name"]
        if not m.get("org"):
            m["org"] = org_name(row["org"])

    da_mode_re = re.compile(r"-(xhigh|max|high|medium|low)$", re.I)
    for row in designarena.get("models", []):
        raw_id = row.get("id") or ""
        k_full = key(raw_id)
        mode = ""
        if k_full in models:
            k = k_full
        else:
            mm = da_mode_re.search(raw_id)
            if mm:
                base_k = key(raw_id[: mm.start()])
                if base_k in models:
                    k = base_k
                    mode = mm.group(1).capitalize() if mm.group(1).lower() != "xhigh" else "xHigh"
                else:
                    continue
            else:
                continue  # пропускаем временные анонимные кодовые имена DesignArena
        sample = {
            "elo": row["elo"], "win_rate": row.get("win_rate"), "battles": row.get("battles") or 0,
            "cost": row.get("cost"), "rank": row.get("rank"), "mode": mode, "source_label": raw_id,
        }
        add_measurement(models[k], "code_video", sample, "elo")

    own = json.loads(OWN.read_text(encoding="utf-8")) if OWN.exists() else {}
    for oid, ob in own.items():
        if oid.startswith("_"):
            continue
        for r in ob.get("results", []):
            n, ex = r["n"], r["exact"]
            p, z = ex / n, 1.96
            c = (p + z * z / (2 * n)) / (1 + z * z / n)
            h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
            m = get(key(r["model"]))
            m.setdefault("oname", r["model"])
            measured_cost = r.get("cost_rub_per_100")
            m.setdefault("own", {})[oid] = {
                "v": round(p, 4), "lo": round(c - h, 4), "hi": round(c + h, 4), "n": n, "exact": ex,
                "pm1": r.get("pm1"), "stricter": r.get("stricter"), "softer": r.get("softer"),
                "sum_ai": r.get("sum_ai"), "sum_exp": r.get("sum_exp"), "interval_type": "wilson_95",
                **({"cost_rub_per_100": measured_cost} if measured_cost is not None else {})}

    prices = {}
    for p in orouter["models"]:
        prices.setdefault(key(p["name"]), p)
        prices.setdefault(key(p["id"].split("/", 1)[-1]), p)
    if ALIASES.exists():
        for excluded in json.loads(ALIASES.read_text(encoding="utf-8")).get("price_exclusions", {}):
            prices.pop(key(excluded), None)

    out = []
    for k, m in models.items():
        p = prices.get(k)
        name = m.get("ename") or m.get("aname") or m.get("bname") or m.get("cname") or m["oname"]
        dates = m.get("bench_dates", set())
        date = m.get("date") or (next(iter(dates)) if len(dates) == 1 else None)
        rec = {
            "id": k,
            "name": name,
            "org": m.get("org") or "",
            "cc": m.get("cc") or ORG_COUNTRY.get(m.get("org", ""), ""),
            "open": m.get("open"),
            "date": date,
            "dsrc": "epoch" if m.get("date") else "epoch_benchmark" if date else None,
            "version_date": version_date(name) or version_date(m.get("aname", "")),
            "first_seen": first_seen.get(k),
            "listed": (p or {}).get("created"),
            "eci": m.get("eci"),
            "bench": m.get("bench") or {},
            "own": m.get("own") or {},
            "arena": m["arena"],
            "contra": m.get("contra"),
            "code_video": m.get("code_video"),
            "price": {key: p.get(key) for key in ("in", "out", "cache_read", "cache_write", "tiers")} if p else None,
            "ctx": (p or {}).get("context"),
            "input_modalities": (p or {}).get("input_modalities"),
            "max_output": (p or {}).get("max_output"),
            "or": (p or {}).get("id"),
            "or_canonical": (p or {}).get("canonical_slug"),
        }
        out.append(rec)

    out.sort(key=lambda r: (
        -(r["eci"] or {}).get("v", 0),
        -(r["arena"].get("agent") or {}).get("elo", 0),
        -(r["arena"].get("text") or {}).get("elo", 0),
    ))
    now = dt.datetime.now(MSK)
    caches = {"arena": arena, "arena_history": ahist, "epoch": epoch, "openrouter": orouter,
              "contra": contra, "designarena": designarena, "cbr": fx}
    if status is None:
        previous = json.loads((OUT / "models.json").read_text("utf-8")) if (OUT / "models.json").exists() else {}
        status = {}
        for src, cached in caches.items():
            last = previous.get("status", {}).get(src, {})
            if last.get("fetched") and last["fetched"] == cached.get("fetched"):
                status[src] = {**last, "cached": True}
            else:
                status[src] = {"ok": bool(cached), "cached": True, "fetched": cached.get("fetched")}
    result = {
        "built": now.isoformat(timespec="minutes"),
        "status": status,
        "sources": {
            "arena": {"published": arena.get("published"), "url": f"https://huggingface.co/datasets/{HF_DATASET}"},
            "epoch": {"latest_model": epoch.get("latest_model_date"), "url": "https://epoch.ai/benchmarks"},
            "openrouter": {"url": "https://openrouter.ai/models"},
            "contra": {"url": "https://contralabs.com/frontierdesign/leaderboard", "published": contra.get("published")},
            "designarena": {"url": "https://www.designarena.ai/leaderboard"},
            "cbr": {"url": CBR, "published": fx.get("date")},
        },
        "fx": {k: fx[k] for k in ("usd_rub", "date", "source")} if fx else None,
        "own": {oid: {k: v for k, v in ob.items() if k != "results"} for oid, ob in own.items() if not oid.startswith("_")},
        "models": out,
    }
    for src, meta in result["sources"].items():
        meta["count"] = source_count(src, caches[src])
        meta["fetched"] = status.get(src, {}).get("fetched")
    OUT.mkdir(parents=True, exist_ok=True)
    save_json(OUT / "models.json", result)
    write_history(out, now.date().isoformat(), ahist.get("snaps", {}), arena.get("published"))
    write_agent_csv(out, arena.get("published"))
    write_sheet_csv(out, result)
    matched = sum(1 for r in out if r["eci"] and r["arena"].get("text"))
    print(f"моделей на сайте: {len(out)}; с индексом Epoch и Arena: {matched}; с ценой: {sum(1 for r in out if r['price'])}")
    return result


FLAGS_BY_CC = {
    "us": "🇺🇸", "cn": "🇨🇳", "fr": "🇫🇷", "ae": "🇦🇪", "gb": "🇬🇧",
    "ca": "🇨🇦", "kr": "🇰🇷", "il": "🇮🇱", "jp": "🇯🇵", "in": "🇮🇳", "ch": "🇨🇭", "de": "🇩🇪",
}


def _fmt_ci_ru(obj: dict | None, pct: bool = False) -> str:
    if not obj or obj.get("lo") is None or obj.get("hi") is None:
        return ""
    lo, hi = obj["lo"], obj["hi"]
    if pct:
        return f"{lo * 100:.1f}% – {hi * 100:.1f}%".replace(".", ",")
    return f"{lo:.1f} – {hi:.1f}".replace(".", ",")


def write_sheet_csv(models: list[dict], result: dict) -> None:
    """Компактный каталог (~200–280 актуальных моделей) для IMPORTDATA в Google Таблицу."""
    built_iso = result.get("built") or ""
    built_day = built_iso[:10]
    cutoff = (dt.date.fromisoformat(built_day) - dt.timedelta(days=550)).isoformat() if len(built_day) == 10 else ""
    top_ids: set[str] = set()
    for sec in ("text", "ru", "web", "web_react", "vision", "vision_hw"):
        ranked = sorted((m for m in models if (m.get("arena") or {}).get(sec)), key=lambda m: -m["arena"][sec]["elo"])
        top_ids.update(m["id"] for m in ranked[:40])
    top_eci = sorted((m for m in models if m.get("eci")), key=lambda m: -m["eci"]["v"])
    top_ids.update(m["id"] for m in top_eci[:40])

    selected = []
    for m in models:
        ar = m.get("arena") or {}
        has_special = bool(ar.get("agent") or m.get("contra") or m.get("code_video") or (m.get("own") or {}).get("ege"))
        confirmed = m.get("dsrc") in ("epoch", "epoch_benchmark") and bool(m.get("date"))
        is_recent = confirmed and (not cutoff or m["date"] >= cutoff) and bool(ar or m.get("eci") or m.get("price"))
        if has_special or is_recent or m["id"] in top_ids:
            selected.append(m)

    selected.sort(key=lambda m: (
        -((m.get("arena") or {}).get("agent") or {}).get("elo", 0),
        -((m.get("arena") or {}).get("text") or {}).get("elo", 0),
        -(m.get("eci") or {}).get("v", 0),
        m["name"],
    ))

    fx_rate = (result.get("fx") or {}).get("usd_rub") or ""
    arena_pub = ((result.get("sources") or {}).get("arena") or {}).get("published") or ""
    arena_pub_ru = ".".join(reversed(arena_pub.split("-"))) if len(arena_pub) == 10 else arena_pub
    built_ru = f"{built_day[8:10]}.{built_day[5:7]}.{built_day[0:4]} {built_iso[11:16]}" if len(built_iso) >= 16 else built_iso
    meta_dates = f"{built_ru} МСК · Arena {arena_pub_ru}" if arena_pub_ru else built_ru

    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow([
        "id", "name", "org", "flag_org", "open", "date",
        "agent", "agent_ci", "agent_mode", "agent_sessions", "cost_p50",
        "agent_work", "agent_work_mode", "agent_code", "agent_code_mode", "agent_outcome", "agent_outcome_mode",
        "text", "text_mode", "ru", "ru_mode", "math", "math_mode",
        "web", "web_mode", "vision", "vision_mode", "vision_hw", "vision_hw_mode",
        "contra", "contra_win", "ege", "ege_n",
        "eci", "physics", "mathx", "facts", "bench_mode",
        "price_in", "price_out", "price_blend", "ctx", "usd_rub", "meta_dates",
        "web_react", "web_react_mode", "code_video", "code_video_win", "code_video_cost", "code_video_mode",
    ])
    for m in selected:
        ar = m.get("arena") or {}
        ag = ar.get("agent") or {}
        b = m.get("bench") or {}
        c = m.get("contra") or {}
        cv = m.get("code_video") or {}
        ege = (m.get("own") or {}).get("ege") or {}
        p = m.get("price") or {}
        pin, pout = p.get("in"), p.get("out")
        pblend = round((3 * pin + pout) / 4, 4) if pin is not None and pout is not None else ""
        flag = FLAGS_BY_CC.get(m.get("cc") or "", "")
        flag_org = f"{flag} {m.get('org') or ''}".strip()
        confirmed_date = m["date"] if m.get("dsrc") in ("epoch", "epoch_benchmark") and m.get("date") else ""
        bmode = next((b[k].get("mode") for k in ("mathx", "facts", "physics", "science") if b.get(k) and b[k].get("mode")), "")
        w.writerow([
            m["id"], m["name"], m.get("org") or "", flag_org,
            "Да" if m.get("open") is True else ("Нет" if m.get("open") is False else ""),
            confirmed_date,
            ag.get("elo", ""), _fmt_ci_ru(ag), ag.get("mode") or "", ag.get("votes") or "",
            ag.get("cost_p50") if ag.get("cost_p50") is not None else "",
            (ar.get("agent_work") or {}).get("elo", ""), (ar.get("agent_work") or {}).get("mode") or "",
            (ar.get("agent_code") or {}).get("elo", ""), (ar.get("agent_code") or {}).get("mode") or "",
            (ar.get("agent_outcome") or {}).get("elo", ""), (ar.get("agent_outcome") or {}).get("mode") or "",
            (ar.get("text") or {}).get("elo", ""), (ar.get("text") or {}).get("mode") or "",
            (ar.get("ru") or {}).get("elo", ""), (ar.get("ru") or {}).get("mode") or "",
            (ar.get("math") or {}).get("elo", ""), (ar.get("math") or {}).get("mode") or "",
            (ar.get("web") or {}).get("elo", ""), (ar.get("web") or {}).get("mode") or "",
            (ar.get("vision") or {}).get("elo", ""), (ar.get("vision") or {}).get("mode") or "",
            (ar.get("vision_hw") or {}).get("elo", ""), (ar.get("vision_hw") or {}).get("mode") or "",
            c.get("elo") if c.get("elo") is not None else "",
            c.get("win_rate") if c.get("win_rate") is not None else "",
            ege.get("v") if ege.get("v") is not None else "",
            ege.get("n") if ege.get("n") is not None else "",
            (m.get("eci") or {}).get("v", ""),
            (b.get("physics") or {}).get("v", ""),
            (b.get("mathx") or {}).get("v", ""),
            (b.get("facts") or {}).get("v", ""),
            bmode,
            pin if pin is not None else "", pout if pout is not None else "", pblend,
            m.get("ctx") or "", fx_rate, meta_dates,
            (ar.get("web_react") or {}).get("elo", ""), (ar.get("web_react") or {}).get("mode") or "",
            cv.get("elo") if cv.get("elo") is not None else "",
            cv.get("win_rate") if cv.get("win_rate") is not None else "",
            cv.get("cost") if cv.get("cost") is not None else "",
            cv.get("mode") or "",
        ])
    temp = (OUT / "sheet_catalog.csv").with_suffix(".tmp")
    temp.write_text(buf.getvalue(), encoding="utf-8")
    temp.replace(OUT / "sheet_catalog.csv")


def write_agent_csv(models: list[dict], published: str | None) -> None:
    """Компактный CSV по Agent Arena для прямого импорта в Google Таблицу (IMPORTDATA)."""
    rows = [m for m in models if (m.get("arena") or {}).get("agent")]
    rows.sort(key=lambda m: (-(m["arena"]["agent"]["elo"]), m["name"]))
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["rank", "model", "mode", "org", "cc", "agent", "lo", "hi", "agent_work", "agent_code", "agent_outcome", "cost_p50", "tokens_p50", "sessions", "published"])
    for idx, m in enumerate(rows, 1):
        ar = m["arena"]
        ag = ar["agent"]
        w.writerow([
            idx, m["name"], ag.get("mode") or "", m.get("org") or "", m.get("cc") or "",
            ag["elo"], ag.get("lo") if ag.get("lo") is not None else "", ag.get("hi") if ag.get("hi") is not None else "",
            (ar.get("agent_work") or {}).get("elo", ""),
            (ar.get("agent_code") or {}).get("elo", ""),
            (ar.get("agent_outcome") or {}).get("elo", ""),
            ag.get("cost_p50") if ag.get("cost_p50") is not None else "",
            ag.get("tokens_p50") if ag.get("tokens_p50") is not None else "",
            ag.get("votes") or "",
            published or "",
        ])
    temp = (OUT / "agent_arena.csv").with_suffix(".tmp")
    temp.write_text(buf.getvalue(), encoding="utf-8")
    temp.replace(OUT / "agent_arena.csv")


def write_history(models: list[dict], day: str, arena_snaps: dict, arena_day: str | None) -> None:
    """Снимок ECI датирован днём сборки, а места Arena — днём публикации рейтинга."""
    path = OUT / "history.json"
    hist = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if arena_snaps:
        since = min(arena_snaps)
        for d, snap in hist.items():
            if d >= since and d not in arena_snaps:
                hist[d] = {k: v for k, v in snap.items() if k == "eci"}
    for d, snap in arena_snaps.items():
        hist.setdefault(d, {}).update(snap)
    for metric in ("agent", "eci", "text", "ru", "math", "web", "vision"):
        capture_day = day if metric == "eci" else arena_day
        if not capture_day or (capture_day in arena_snaps and metric in arena_snaps[capture_day]):
            continue
        val = (lambda r: (r["eci"] or {}).get("v")) if metric == "eci" else (lambda r, s=metric: (r["arena"].get(s) or {}).get("elo"))
        ranked = sorted((r for r in models if val(r) is not None), key=val, reverse=True)[:50]
        hist.setdefault(capture_day, {})[metric] = [r["id"] for r in ranked]
    cutoff = (dt.date.fromisoformat(day) - dt.timedelta(days=60)).isoformat()
    hist = {d: {sid: list(dict.fromkeys(key(k) for k in ids)) for sid, ids in v.items()}
            for d, v in sorted(hist.items()) if d >= cutoff}
    save_json(path, hist)


if __name__ == "__main__":
    st = None if "--offline" in sys.argv else fetch_all()
    res = merge(st)
    bad = [s for s, v in res["status"].items() if not v.get("ok")]
    # Падаем, только если не обновился ни один источник: тогда в Actions будет красный крестик.
    sys.exit(1 if st is not None and len(bad) == len(FETCHERS) else 0)
