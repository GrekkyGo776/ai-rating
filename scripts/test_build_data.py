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

    def test_arena_agent_sections_keep_modes_and_task_costs(self):
        fake_tables = {
            "agent": [
                {"model_name": "Claude Opus 5.5 (Max)", "organization": "anthropic", "license": "proprietary",
                 "score": 0.19, "score_ci_lower": 0.17, "score_ci_upper": 0.21, "session_count": 15162,
                 "rank": 2, "category": "overall", "leaderboard_publish_date": "2026-11-22",
                 "cost_per_task_p50": 5.791, "output_tokens_per_task_p50": 42100.4},
                {"model_name": "Claude Opus 5.5 (High)", "organization": "anthropic", "license": "proprietary",
                 "score": 0.14, "score_ci_lower": 0.13, "score_ci_upper": 0.15, "session_count": 24506,
                 "rank": 8, "category": "overall", "leaderboard_publish_date": "2026-11-22",
                 "cost_per_task_p50": 1.934, "output_tokens_per_task_p50": 14800.0},
            ],
            "agent_capability": [
                {"model_name": "Claude Opus 5.5 (Max)", "organization": "anthropic", "license": "proprietary",
                 "index_score": 1342.07, "index_score_ci_lower": 1315.37, "index_score_ci_upper": 1368.77,
                 "session_count": 9709, "rank": 2, "category": "overall", "leaderboard_publish_date": "2026-11-22"},
                {"model_name": "Claude Opus 5.5 (High)", "organization": "anthropic", "license": "proprietary",
                 "index_score": 1275.25, "index_score_ci_lower": 1261.52, "index_score_ci_upper": 1288.98,
                 "session_count": 18541, "rank": 7, "category": "overall", "leaderboard_publish_date": "2026-11-22"},
            ],
            "vision": [
                {"model_name": "Claude Opus 5.5 (High)", "organization": "anthropic", "license": "proprietary",
                 "rating": 1362.79, "rating_lower": 1341.39, "rating_upper": 1384.20,
                 "vote_count": 842, "rank": 1, "category": "homework", "leaderboard_publish_date": "2026-11-19"},
            ],
            "webdev": [
                {"model_name": "Claude Opus 5.5 (Max)", "organization": "anthropic", "license": "proprietary",
                 "rating": 1873.3, "rating_lower": 1859.7, "rating_upper": 1886.8,
                 "vote_count": 3445, "rank": 2, "category": "webdev-react", "leaderboard_publish_date": "2026-11-22"},
            ],
        }
        sections = [("agent", "agent_capability", "overall"), ("vision_hw", "vision", "homework"), ("web_react", "webdev", "webdev-react")]
        with patch.dict("sys.modules", {"pyarrow": object()}), \
             patch.object(build, "ARENA_SECTIONS", sections), \
             patch.object(build, "_arena_rows_parquet", side_effect=lambda sub: fake_tables[sub]):
            arena = build.fetch_arena()
        self.assertEqual(arena["published"], "2026-11-22")
        self.assertEqual(arena["sections"]["agent"][0]["cost_p50"], 5.79)
        self.assertEqual(arena["sections"]["agent"][0]["tokens_p50"], 42100)
        self.assertEqual(arena["sections"]["agent"][1]["cost_p50"], 1.93)
        self.assertEqual(arena["sections"]["vision_hw"][0]["elo"], 1362.8)
        self.assertEqual(arena["sections"]["web_react"][0]["elo"], 1873.3)

        designarena = {"models": [
            {"id": "claude-opus-5-5", "elo": 1324.0, "win_rate": 0.728, "battles": 578, "cost": 2.38, "rank": 3},
            {"id": "grogu", "elo": 1134.0, "win_rate": 0.45, "battles": 493, "cost": 1.0, "rank": 23},
        ]}
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder) / "cache"
            out = Path(folder) / "out"
            cache.mkdir()
            for name, payload in {
                "arena": arena,
                "arena_history": {"first_seen": {}, "snaps": {}},
                "epoch": {"models": [], "bench": {}},
                "openrouter": {"models": []},
                "designarena": designarena,
            }.items():
                build.save_json(cache / f"{name}.json", payload)
            with patch.multiple(build, CACHE=cache, OUT=out, OWN=Path(folder) / "own.json"):
                rows = {row["name"]: row for row in build.merge()["models"]}
            csv_lines = (out / "agent_arena.csv").read_text(encoding="utf-8").splitlines()
            sheet_lines = (out / "sheet_catalog.csv").read_text(encoding="utf-8").splitlines()
        opus = rows["Claude Opus 5.5"]
        self.assertNotIn("grogu", rows)
        self.assertEqual(opus["arena"]["agent"]["mode"], "Max")
        self.assertEqual(opus["arena"]["agent"]["cost_p50"], 5.79)
        self.assertEqual([v["mode"] for v in opus["arena"]["agent"]["variants"]], ["Max", "High"])
        self.assertEqual([v["cost_p50"] for v in opus["arena"]["agent"]["variants"]], [5.79, 1.93])
        self.assertEqual(opus["arena"]["vision_hw"]["elo"], 1362.8)
        self.assertEqual(opus["arena"]["web_react"]["elo"], 1873.3)
        self.assertEqual(opus["code_video"]["elo"], 1324.0)
        self.assertEqual(opus["code_video"]["cost"], 2.38)
        self.assertTrue(csv_lines[0].startswith("rank,model,mode,org,cc,agent,"))
        self.assertIn("Claude Opus 5.5,Max,Anthropic,us,1342.1,", csv_lines[1])
        self.assertIn(",5.79,42100,9709,2026-11-22", csv_lines[1])
        self.assertTrue(sheet_lines[0].endswith(",web_react,web_react_mode,code_video,code_video_win,code_video_cost,code_video_mode"))
        self.assertIn(",1873.3,Max,1324.0,0.728,2.38,", sheet_lines[1])

    def test_own_benchmarks_preserve_reasoning_mode(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder) / "cache"
            out = Path(folder) / "out"
            own = Path(folder) / "own.json"
            cache.mkdir()
            for name, payload in {
                "arena": {"published": "2026-11-22", "sections": {}},
                "arena_history": {"first_seen": {}, "snaps": {}},
                "epoch": {"models": [], "bench": {}},
                "openrouter": {"models": []},
            }.items():
                build.save_json(cache / f"{name}.json", payload)
            build.save_json(own, {
                "ege": {
                    "title": "Проверка ЕГЭ",
                    "results": [
                        {"model": "Claude Opus 5.5", "mode": "high", "n": 120, "exact": 97},
                        {"model": "NoMode Model", "n": 120, "exact": 80},
                    ],
                }
            })
            with patch.multiple(build, CACHE=cache, OUT=out, OWN=own):
                rows = {row["name"]: row for row in build.merge()["models"]}
            self.assertEqual(rows["Claude Opus 5.5"]["own"]["ege"]["mode"], "high")
            self.assertEqual(rows["NoMode Model"]["own"]["ege"]["mode"], "")


if __name__ == "__main__":
    unittest.main()
