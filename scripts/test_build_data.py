import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import build_data as build


class CatalogTest(unittest.TestCase):
    def test_epoch_scores_without_display_names_keep_source_versions(self):
        with zipfile.ZipFile(io.BytesIO(), "w") as archive:
            archive.writestr("model_metadata.csv",
                             "model_version,model_group,display_name\n"
                             "sample-base,Sample,\nsample-it_high,Sample,\n")
            archive.writestr("gpqa_diamond.csv",
                             "Model version,Best score (across scorers),Release date\n"
                             "sample-it_high,0.81,2026-04-01\n")
            row = build.epoch_benchmarks(archive)["science"][0]
        self.assertEqual((row["name"], row["mode"]), ("sample-it", "high"))
        self.assertEqual((row["source_label"], row["source_id"]), ("sample-it_high", "sample-it_high"))

    def test_sources_keep_versions_and_modes(self):
        self.assertNotEqual(build.key("Qwen3.8 Max (0902)"), build.key("Qwen 3.8 Max"))
        self.assertEqual(build.key("Gemma 4 31B"), build.key("Gemma 4 31B IT"))
        self.assertEqual(build.bench_identity("Qwen3.8 Max (0902) (xhigh)"), ("Qwen3.8 Max (0902)", "xhigh"))
        self.assertEqual(build.bench_identity("Doubao (Nov 2026, high)"), ("Doubao (Nov 2026)", "high"))

    def test_catalog_preserves_measured_rows_without_inventing_release_dates(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder) / "cache"
            out = Path(folder) / "out"
            cache.mkdir()
            data = {
                "arena": {"published": "2026-11-19", "sections": {"text": [{
                    "name": "Snapshot (2025-04-14)", "org": "Lab", "license": "",
                    "elo": 1234, "lo": 1200, "hi": 1250, "rank": 460, "votes": 100,
                }]}},
                "arena_history": {"first_seen": {build.key("Snapshot (2025-04-14)"): "2026-10-19"}, "snaps": {}},
                "epoch": {"models": [], "bench": {"science": [
                    {"name": "Standalone (max)", "v": 0.90, "se": 0.01, "date": "2026-09-01"},
                    {"name": "Standalone (with fallback, max)", "v": 0.94, "se": 0.01, "date": "2026-09-01"},
                ]}},
                "openrouter": {"models": []},
                "contra": {"models": [{"name": "Design only", "org": "Lab", "elo": 1800, "source_label": "Design only"}]},
            }
            for name, contents in data.items():
                build.save_json(cache / (name + ".json"), contents)
            with patch.multiple(build, CACHE=cache, OUT=out, OWN=Path(folder)/"own.json"):
                rows = {row["name"]: row for row in build.merge()["models"]}
            snapshot = rows["Snapshot (2025-04-14)"]
            self.assertIsNone(snapshot["date"])
            self.assertEqual(snapshot["version_date"], "2025-04-14")
            self.assertEqual(snapshot["first_seen"], "2026-10-19")
            standalone = rows["Standalone"]
            self.assertEqual((standalone["date"], standalone["dsrc"]), ("2026-09-01", "epoch_benchmark"))
            science = standalone["bench"]["science"]
            self.assertEqual(science["mode"], "with fallback, max")
            self.assertEqual([s["v"] for s in science["variants"]], [0.90, 0.94])
            self.assertEqual(rows["Design only"]["contra"]["elo"], 1800)

    def test_openrouter_preserves_tiers_zero_prices_and_missing_limits(self):
        model = {"id": "vendor/alpha", "name": "Vendor: Alpha", "pricing": {
            "prompt": "0.000008", "completion": "0.00004", "input_cache_read": "0",
            "overrides": [{"min_prompt_tokens": 272000, "prompt": "0.000016", "completion": "0.00006"}],
        }, "architecture": {"input_modalities": ["text", "image"]}, "context_length": 1050000}
        results = [{"data": [model], "links": {"next": "/api/v1/models?cursor=2"}},
                   {"data": [{**model, "id": "vendor/second"}], "links": {"next": None}}]
        with patch.object(build, "http_get", side_effect=[json.dumps(r).encode() for r in results]):
            rows = build.fetch_openrouter()["models"]
        self.assertEqual(len(rows), 2)
        first = rows[0]
        self.assertEqual(first["tiers"], [{"min_prompt_tokens": 272000, "in": 16.0, "out": 60.0}])
        self.assertEqual(first["cache_read"], 0)
        self.assertIsNone(first["cache_write"])
        self.assertIsNone(first["max_output"])
        self.assertEqual(first["input_modalities"], ["text", "image"])


if __name__ == "__main__":
    unittest.main()
