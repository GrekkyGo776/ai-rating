#!/usr/bin/env python3
"""Build a public EGE aggregate from private, matched Tetrad grading runs.

The manifest has public strings updated (ISO date), set, method, caveat, a
private cohort path (Tetrad requests.jsonl), expected_n, and a models list.
Each model needs model (public name), runner_model and results (JSONL path).
Optional model_version and effort check the corresponding fields when logged.
Paths are relative to the manifest. With no --output this only validates.

Optional --billing is a separate private JSON with scope
"all_provider_charges_including_retries" and a models object keyed by public
model name. Each entry requires source ("provider_bill" or "settlement"),
reference, results_sha256, logged_attempts, and the reconciled amount_rub for
the entire run. Source and receipt references remain private. No invoice or
currency conversion is inferred. The runner's own cost is a tariff estimate.
"""
import argparse
import hashlib
import json
import os
import sys
import tempfile
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from pathlib import Path


DEFAULT_BASE = Path(__file__).resolve().parents[1] / "config" / "own_benchmarks.json"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def label(value, name):
    require(isinstance(value, str) and bool(value.strip()), f"Missing or invalid {name}")
    return value.strip()


def integer(value):
    return type(value) is int


def file_json(path):
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    require(isinstance(value, dict), f"{path.name} must contain a JSON object")
    return value


def rows(path, digest=None):
    with path.open("rb") as handle:
        for line_number, raw in enumerate(handle, 1):
            if digest is not None:
                digest.update(raw)
            if not raw.strip():
                continue
            try:
                row = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                raise ValueError(f"Invalid JSONL at line {line_number}") from None
            require(isinstance(row, dict), f"Expected an object at line {line_number}")
            yield row


def cohort_truth(path, expected):
    require(integer(expected) and expected > 0, "expected_n must be a positive integer")
    truth = {}
    for row in rows(path):
        key = label(row.get("id"), "cohort id")
        expert, maximum = row.get("expert"), row.get("max")
        require(key not in truth, "Duplicate work in the expected cohort")
        require(integer(expert) and integer(maximum) and 0 <= expert <= maximum and maximum > 0,
                "Invalid expert score or maximum in cohort")
        truth[key] = (expert, maximum)
    require(len(truth) == expected, "Cohort size disagrees with expected_n")
    return truth


def summarize(model, directory, truth):
    public = label(model.get("model"), "public model name")
    expected_model = label(model.get("runner_model"), "runner_model")
    path = directory / label(model.get("results"), "results path")
    for field in ("model_version", "effort"):
        if field in model:
            label(model[field], field)
    digest = hashlib.sha256()
    graded = {}
    observed = {}
    attempts = 0
    for row in rows(path, digest):
        attempts += 1
        key = label(row.get("id"), "result id")
        require(key in truth, f"{public}: result outside the fixed cohort")
        expert, maximum = truth[key]
        require(integer(row.get("expert")) and row["expert"] == expert,
                f"{public}: expert score differs from cohort")
        if "max" in row:
            require(integer(row["max"]) and row["max"] == maximum, f"{public}: maximum differs from cohort")
        if "model" in row:
            require(row["model"] == expected_model, f"{public}: different runner model in log")
        for field in ("model_version", "effort"):
            if row.get(field) is not None:
                value = label(row[field], field)
                require(value == observed.setdefault(field, value), f"{public}: mixed {field} in log")
                if field in model:
                    require(value == model[field], f"{public}: unexpected {field}")
        require(type(row.get("ok")) is bool, f"{public}: missing boolean completion status")
        if not row["ok"] or row.get("points") is None:
            continue
        points = row["points"]
        require(integer(points) and 0 <= points <= maximum, f"{public}: invalid awarded score")
        require(key not in graded, f"{public}: multiple completed scores for one work")
        graded[key] = points
    require(len(graded) == len(truth),
            f"{public}: completed {len(graded)} of {len(truth)} expected works")
    deltas = [graded[key] - values[0] for key, values in truth.items()]
    result = {
        "model": public, "n": len(deltas), "exact": deltas.count(0),
        "pm1": sum(abs(d) <= 1 for d in deltas), "stricter": sum(d < 0 for d in deltas),
        "softer": sum(d > 0 for d in deltas), "sum_ai": sum(graded.values()),
        "sum_exp": sum(values[0] for values in truth.values()),
    }
    config = (expected_model, observed.get("model_version"), observed.get("effort"))
    return result, digest.hexdigest(), attempts, config


def billed_per_hundred(entry, digest, attempts, count):
    require(isinstance(entry, dict) and entry.get("source") in ("provider_bill", "settlement"),
            "Billing entry must identify a provider bill or settlement")
    label(entry.get("reference"), "private billing reference")
    require(entry.get("results_sha256") == digest, "Billing entry refers to a different results log")
    require(integer(entry.get("logged_attempts")) and entry["logged_attempts"] == attempts,
            "Billing attempt count disagrees with the complete log")
    try:
        amount = Decimal(str(entry.get("amount_rub")))
        require(amount.is_finite() and amount >= 0, "Invalid billed ruble amount")
        with localcontext() as ctx:
            ctx.prec = 40
            return float((amount * 100 / count).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    except InvalidOperation:
        raise ValueError("Invalid billed ruble amount") from None


def candidate(manifest_path, base_path, billing_path=None):
    manifest, base = file_json(manifest_path), file_json(base_path)
    old = base.get("ege")
    require(isinstance(old, dict) and isinstance(old.get("results"), list), "Missing existing EGE section")
    public = {field: label(manifest.get(field), field) for field in ("updated", "set", "method", "caveat")}
    require(date.fromisoformat(public["updated"]).isoformat() == public["updated"], "Use date YYYY-MM-DD")
    if old.get("updated"):
        require(public["updated"] >= old["updated"], "Candidate predates current public benchmark")
    directory = manifest_path.parent
    truth = cohort_truth(directory / label(manifest.get("cohort"), "cohort path"), manifest.get("expected_n"))
    models = manifest.get("models")
    require(isinstance(models, list) and len(models) >= 2, "A comparison needs at least two model runs")
    billing = {}
    if billing_path:
        doc = file_json(billing_path)
        require(doc.get("scope") == "all_provider_charges_including_retries" and
                isinstance(doc.get("models"), dict) and doc["models"],
                "Billing must cover all provider charges including retries for each declared run")
        billing = dict(doc["models"])

    seen, configs, logs, results = set(), set(), set(), []
    for model in models:
        require(isinstance(model, dict), "Invalid model entry")
        result, digest, attempts, config = summarize(model, directory, truth)
        name = result["model"]
        require(name.casefold() not in seen and digest not in logs and config not in configs,
                "Repeated model, runner configuration or result log")
        seen.add(name.casefold())
        configs.add(config)
        logs.add(digest)
        if name in billing:
            result["cost_rub_per_100"] = billed_per_hundred(billing.pop(name), digest, attempts, len(truth))
        results.append(result)
    require(not billing, "Billing includes an unrecognized model")
    new = {**old, **public, "results": results}
    if new != old:
        archive = base.setdefault("_ege_history", [])
        require(isinstance(archive, list), "Unexpected EGE history format")
        if old not in archive:
            archive.append(old)
        base["ege"] = new
    return base


def save_new(path, data):
    # Publish a fully written file or leave the destination untouched.
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as out:
            tmp = Path(out.name)
            json.dump(data, out, ensure_ascii=False, indent=2, allow_nan=False)
            out.write("\n")
        os.link(tmp, path)
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("manifest", type=Path, help="private run manifest")
    parser.add_argument("--base", type=Path, default=DEFAULT_BASE, help="existing public config")
    parser.add_argument("--billing", type=Path, help="optional private, reconciled billing manifest")
    parser.add_argument("--output", type=Path, help="new candidate config path (must not exist)")
    args = parser.parse_args()
    try:
        data = candidate(args.manifest, args.base, args.billing)
        if args.output:
            save_new(args.output, data)
    except (ValueError, OSError) as exc:
        print(f"Import stopped: {exc}", file=sys.stderr)
        return 1
    for row in data["ege"]["results"]:
        cost = f"{row['cost_rub_per_100']:.2f} RUB/100" if "cost_rub_per_100" in row else "no settled RUB bill"
        print(f"{row['model']} · {row['exact']}/{row['n']} exact · {cost}")
    print("Validated candidate written." if args.output else "Dry run. No files written.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
