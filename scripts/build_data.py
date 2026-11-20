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
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "cache"
OUT = ROOT / "site" / "data"
ALIASES = ROOT / "config" / "aliases.json"
UA = "ai-rating-site/1.0 (+https://ai.fizmat.guru)"

HF_DATASET = "lmarena-ai/leaderboard-dataset"
# Разделы Arena, которые показываем: (id на сайте, подмножество набора, категория)
ARENA_SECTIONS = [
    ("text", "text_style_control", "overall"),
    ("ru", "text_style_control", "russian"),
    ("math", "text_style_control", "math"),
    ("code", "text_style_control", "coding"),
    ("creative", "text_style_control", "creative_writing"),
    ("hard", "text_style_control", "hard_prompts"),
    ("web", "webdev", "overall"),
    ("vision", "vision", "overall"),
]
EPOCH_ZIP = "https://epoch.ai/data/benchmark_data.zip"
OPENROUTER = "https://openrouter.ai/api/v1/models"

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


def fetch_arena() -> dict:
    try:
        import pyarrow  # noqa: F401
        use_parquet = True
    except ImportError:
        use_parquet = False
    by_subset: dict[str, list[dict]] = {}
    sections = {}
    published = None
    for sid, subset, category in ARENA_SECTIONS:
        if use_parquet:
            if subset not in by_subset:
                by_subset[subset] = _arena_rows_parquet(subset)
            rows = [r for r in by_subset[subset] if r.get("category") == category]
        else:
            rows = _arena_rows_json(subset, category)
        if not rows:
            raise RuntimeError(f"Arena: пустой раздел {subset}/{category}")
        published = max(published or "", max(str(r["leaderboard_publish_date"]) for r in rows))
        sections[sid] = [
            {
                "name": r["model_name"],
                "org": r.get("organization") or "",
                "license": r.get("license") or "",
                "elo": round(float(r["rating"]), 1),
                "lo": round(float(r["rating_lower"]), 1),
                "hi": round(float(r["rating_upper"]), 1),
                "votes": int(r["vote_count"] or 0),
                "rank": int(r["rank"]),
            }
            for r in rows
        ]
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
            "eci": round(eci, 1),
            "lo": round(float(r["eci_ci_low"]), 1) if r.get("eci_ci_low") else None,
            "hi": round(float(r["eci_ci_high"]), 1) if r.get("eci_ci_high") else None,
            "date": r.get("date") or None,
            "org": r.get("Organization") or "",
            "country": r.get("Country (of organization)") or "",
            "open": {"Open weights": True, "Closed weights": False}.get(r.get("Accessibility group")),
        })
    return {"latest_model_date": max((m["date"] or "") for m in models), "models": models}


# ───────────────────────── OpenRouter ─────────────────────────

def fetch_openrouter() -> dict:
    data = json.loads(http_get(OPENROUTER))["data"]
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
        models.append({
            "id": mid,
            "name": name.split(": ", 1)[-1],
            "in": round(pin * 1e6, 4),
            "out": round(pout * 1e6, 4),
            "context": m.get("context_length"),
            "created": dt.datetime.fromtimestamp(m["created"], dt.timezone.utc).date().isoformat() if m.get("created") else None,
        })
    return {"models": models}


# Полная история Arena: когда модель впервые появилась (дата для моделей, которых нет в Epoch и OpenRouter)
# и места за последние 60 дней (стрелки ▲▼). Файл text_style_control — около 60 МБ, читаем только нужные колонки.
HIST_SECTIONS = [("text", "text_style_control", "overall"), ("ru", "text_style_control", "russian"),
                 ("math", "text_style_control", "math"), ("web", "webdev", "overall"), ("vision", "vision", "overall")]


def fetch_arena_history() -> dict:
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    first: dict[str, str] = {}
    snaps: dict[str, dict] = {}
    tables = {}
    for _, subset, _ in HIST_SECTIONS:
        if subset in tables:
            continue
        url = f"https://huggingface.co/datasets/{HF_DATASET}/resolve/main/{subset}/full-00000-of-00001.parquet"
        tables[subset] = pq.read_table(io.BytesIO(http_get(url, timeout=300)),
                                       columns=["model_name", "category", "leaderboard_publish_date", "rating"])
    latest = max(str(d) for tb in tables.values() for d in pc.unique(tb["leaderboard_publish_date"]).to_pylist())
    since = (dt.date.fromisoformat(latest[:10]) - dt.timedelta(days=60)).isoformat()
    for sid, subset, category in HIST_SECTIONS:
        tb = tables[subset]
        rows = tb.filter(pc.equal(tb["category"], category)).to_pylist()
        best: dict[str, dict[str, float]] = {}
        for r in rows:
            d = str(r["leaderboard_publish_date"])[:10]
            k = key(r["model_name"])
            if k not in first or d < first[k]:
                first[k] = d
            if d >= since:
                day = best.setdefault(d, {})
                if r["rating"] > day.get(k, -1e9):
                    day[k] = r["rating"]
        for d, day in best.items():
            snaps.setdefault(d, {})[sid] = [k for k, _ in sorted(day.items(), key=lambda kv: -kv[1])[:50]]
    return {"latest": latest, "first_seen": first, "snaps": snaps}


FETCHERS = {"arena": fetch_arena, "arena_history": fetch_arena_history, "epoch": fetch_epoch, "openrouter": fetch_openrouter}


def fetch_all() -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    status = {}
    now = dt.datetime.now(MSK).isoformat(timespec="minutes")
    for src, fn in FETCHERS.items():
        path = CACHE / f"{src}.json"
        try:
            payload = fn()
            payload["fetched"] = now
            path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            status[src] = {"ok": True, "fetched": now}
            print(f"✓ {src}")
        except Exception as e:  # noqa: BLE001
            old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
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


def norm(name: str) -> str:
    base, _ = strip_mode(name.split(": ", 1)[-1])
    base = base.lower().replace("‑", "-")
    return re.sub(r"[\s\-_.:/]+", "", base)


ORG_NAMES = {
    "openai": "OpenAI", "google": "Google", "google deepmind": "Google", "google deepmind,google": "Google",
    "anthropic": "Anthropic", "meta": "Meta", "meta ai": "Meta", "xai": "xAI", "spacexai": "xAI",
    "deepseek": "DeepSeek", "deepseek,peking university": "DeepSeek", "alibaba": "Alibaba", "moonshot": "Moonshot AI",
    "moonshot ai": "Moonshot AI", "kimi": "Moonshot AI", "z.ai (zhipu ai)": "Z.ai", "zhipu": "Z.ai", "zai": "Z.ai",
    "z.ai": "Z.ai", "mistral": "Mistral", "mistral ai": "Mistral", "minimax": "MiniMax", "nvidia": "NVIDIA",
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


def arena_date(name: str, first_seen: str | None) -> str | None:
    """Дата для модели, которая есть только в Arena: день первого появления там, но если в названии
    зашита более ранняя дата (GPT-5.2 Chat (20260210)) — она: модель могли переименовать позже выхода."""
    m = re.search(r"(20\d{2})(\d{2})(\d{2})", name)
    named = None
    if m:
        try:
            named = dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
        except ValueError:
            named = None
    cands = [d for d in (first_seen, named) if d]
    return min(cands) if cands else None


def merge(status: dict | None = None) -> dict:
    arena = json.loads((CACHE / "arena.json").read_text(encoding="utf-8"))
    epoch = json.loads((CACHE / "epoch.json").read_text(encoding="utf-8"))
    orouter = json.loads((CACHE / "openrouter.json").read_text(encoding="utf-8"))
    hist_path = CACHE / "arena_history.json"
    ahist = json.loads(hist_path.read_text(encoding="utf-8")) if hist_path.exists() else {"first_seen": {}, "snaps": {}}

    models: dict[str, dict] = {}

    def get(k: str) -> dict:
        return models.setdefault(k, {"arena": {}})

    # Arena: лучший режим модели в каждом разделе
    for sid, rows in arena["sections"].items():
        for r in rows:
            k = key(r["name"])
            m = get(k)
            cur = m["arena"].get(sid)
            if cur is None or r["elo"] > cur["elo"]:
                base, mode = strip_mode(r["name"])
                m["arena"][sid] = {"elo": r["elo"], "lo": r["lo"], "hi": r["hi"], "votes": r["votes"],
                                   "rank": r["rank"], "mode": mode}
                if sid == "text" or "aname" not in m:
                    m["aname"] = base
                m.setdefault("org", org_name(r["org"]))
                if r["license"]:
                    m.setdefault("open", r["license"].lower() != "proprietary")

    for e in epoch["models"]:
        m = get(key(e["name"]))
        if "eci" in m and m["eci"]["v"] >= e["eci"]:
            continue
        m["eci"] = {"v": e["eci"], "lo": e["lo"], "hi": e["hi"]}
        m["ename"] = strip_mode(e["name"])[0]
        if e["org"]:
            m["org"] = org_name(e["org"].split(",")[0]) if "," in e["org"] and "google" not in e["org"].lower() else org_name(e["org"])
        if e["country"]:
            m["cc"] = COUNTRY_CODES.get(e["country"], "")
        if e["open"] is not None:
            m["open"] = e["open"]
        if e["date"]:
            m["date"] = e["date"]

    prices = {}
    for p in orouter["models"]:
        prices.setdefault(key(p["name"]), p)
        prices.setdefault(key(p["id"].split("/", 1)[-1]), p)

    out = []
    for k, m in models.items():
        a = m["arena"]
        keep = ("eci" in m and (m.get("date") or "") >= "2025-01-01") \
            or (a.get("text", {}).get("rank", 999) <= 220) \
            or any(a.get(s, {}).get("rank", 999) <= 90 for s in ("web", "vision"))
        if not keep:
            continue
        p = prices.get(k)
        rec = {
            "id": k,
            "name": m.get("ename") or m.get("aname") or k,
            "org": m.get("org") or "",
            "cc": m.get("cc") or ORG_COUNTRY.get(m.get("org", ""), ""),
            "open": m.get("open"),
            "date": m.get("date") or (p or {}).get("created") or arena_date(m.get("aname") or k, ahist["first_seen"].get(k)),
            "dsrc": "epoch" if m.get("date") else "openrouter" if (p or {}).get("created") else "arena" if ahist["first_seen"].get(k) else None,
            "eci": m.get("eci"),
            "arena": a,
            "price": {"in": p["in"], "out": p["out"]} if p else None,
            "ctx": (p or {}).get("context"),
            "or": (p or {}).get("id"),
        }
        out.append(rec)

    out.sort(key=lambda r: (-(r["eci"] or {}).get("v", 0), -(r["arena"].get("text") or {}).get("elo", 0)))
    now = dt.datetime.now(MSK)
    status = status or {s: {"ok": True, "fetched": json.loads((CACHE / f"{s}.json").read_text("utf-8")).get("fetched")}
                        for s in FETCHERS if (CACHE / f"{s}.json").exists()}
    result = {
        "built": now.isoformat(timespec="minutes"),
        "status": status,
        "sources": {
            "arena": {"published": arena.get("published"), "url": f"https://huggingface.co/datasets/{HF_DATASET}"},
            "epoch": {"latest_model": epoch.get("latest_model_date"), "url": "https://epoch.ai/benchmarks"},
            "openrouter": {"url": "https://openrouter.ai/models"},
        },
        "models": out,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "models.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    write_history(out, now.date().isoformat(), ahist.get("snaps", {}))
    matched = sum(1 for r in out if r["eci"] and r["arena"].get("text"))
    print(f"моделей на сайте: {len(out)}; с индексом Epoch и Arena: {matched}; с ценой: {sum(1 for r in out if r['price'])}")
    return result


def write_history(models: list[dict], day: str, arena_snaps: dict) -> None:
    """Места моделей по дням (для стрелок ▲▼): прошлые публикации Arena плюс сегодняшний снимок,
    где есть и индекс Epoch. Храним 60 дней."""
    path = OUT / "history.json"
    hist = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for d, snap in arena_snaps.items():
        hist.setdefault(d, {}).update(snap)
    snap = {}
    for metric in ("eci", "text", "ru", "math", "web", "vision"):
        val = (lambda r: (r["eci"] or {}).get("v")) if metric == "eci" else (lambda r, s=metric: (r["arena"].get(s) or {}).get("elo"))
        ranked = sorted((r for r in models if val(r) is not None), key=val, reverse=True)[:50]
        snap[metric] = [r["id"] for r in ranked]
    hist[day] = snap
    cutoff = (dt.date.fromisoformat(day) - dt.timedelta(days=60)).isoformat()
    hist = {d: v for d, v in sorted(hist.items()) if d >= cutoff}
    path.write_text(json.dumps(hist, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    st = None if "--offline" in sys.argv else fetch_all()
    res = merge(st)
    bad = [s for s, v in res["status"].items() if not v.get("ok")]
    # Падаем, только если не обновился ни один источник: тогда в Actions будет красный крестик.
    sys.exit(1 if st is not None and len(bad) == len(FETCHERS) else 0)
