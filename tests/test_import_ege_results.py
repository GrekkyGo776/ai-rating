import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "import_ege_results.py"
sys.path.insert(0, str(SCRIPT.parent))
from import_ege_results import candidate, save_new


class AggregateImport(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.dir = Path(temp.name)
        self.base = self.dir / "base.json"
        self.manifest = self.dir / "manifest.json"
        self.log_a, self.log_b = self.dir / "a.jsonl", self.dir / "b.jsonl"
        self.pilot = {"title": "ЕГЭ", "updated": "2026-11-20", "results": [{"model": "Prior pilot"}]}
        self.base.write_text(json.dumps({"ege": self.pilot, "other": {"results": []}}))
        self.cohort = [{"id": f"private-{i}", "expert": n, "max": 3} for i, n in enumerate([1, 2, 3])]
        self.lines(self.dir / "cohort.jsonl", self.cohort)
        self.runs = [
            {"model": "A", "runner_model": "a-v1", "results": "a.jsonl", "effort": "high"},
            {"model": "B", "runner_model": "b-v2", "results": "b.jsonl", "model_version": "2"},
        ]
        self.meta = dict(updated="2026-11-21", set="Three sample works", method="Frozen rubric",
                         caveat="Synthetic fixture", cohort="cohort.jsonl", expected_n=3, models=self.runs)
        self.manifest.write_text(json.dumps(self.meta))
        self.a = [dict(item, model="a-v1", effort="high", ok=True, points=score, cost=9.99,
                       summary="PRIVATE ANSWER") for item, score in zip(self.cohort, [1, 0, 3])]
        self.a.insert(0, dict(self.a[0], ok=False, points=None))
        self.b = [dict(item, model="b-v2", model_version="2", ok=True, points=score)
                  for item, score in zip(self.cohort, [2, 2, 2])]
        self.lines(self.log_a, self.a)
        self.lines(self.log_b, self.b)

    @staticmethod
    def lines(path, items):
        path.write_text("".join(json.dumps(obj) + "\n" for obj in items))

    def test_aggregates_are_private_and_complete(self):
        data = candidate(self.manifest, self.base)
        a, b = data["ege"]["results"]
        self.assertEqual(a, dict(model="A", n=3, exact=2, pm1=2, stricter=1, softer=0, sum_ai=4, sum_exp=6))
        self.assertEqual([b[k] for k in ("exact","pm1","stricter","softer","sum_ai")], [1,3,1,1,6])
        self.assertEqual(data["_ege_history"], [self.pilot])
        self.assertEqual(data["other"], {"results": []})
        self.assertEqual(json.loads(self.base.read_text())["ege"], self.pilot)
        public = json.dumps(data)
        for sensitive in ("private-0", "PRIVATE ANSWER", ".jsonl", "9.99"):
            self.assertNotIn(sensitive, public)

    def test_invalid_runs(self):
        for name, rows in {
            "incomplete": self.b[:-1],
            "extra work": self.b + [dict(self.b[0], id="other")],
            "duplicate completion": self.b + [self.b[0]],
            "wrong expert": [dict(self.b[0], expert=2)] + self.b[1:],
            "wrong max": [dict(self.b[0], max=4)] + self.b[1:],
            "wrong version": [dict(self.b[0], model_version="3")] + self.b[1:],
            "wrong model": [dict(self.b[0], model="b-v3")] + self.b[1:],
            "mixed effort": [dict(self.b[0], effort="high"), dict(self.b[1], effort="low"), self.b[2]],
            "unscored success": self.b[:2] + [dict(self.b[2], ok=True, points=None)],
            "bool score": [dict(self.b[0], points=True)] + self.b[1:],
            "out of range": [dict(self.b[0], points=4)] + self.b[1:],
        }.items():
            with self.subTest(name=name):
                self.lines(self.log_b, rows)
                with self.assertRaises(ValueError):
                    candidate(self.manifest, self.base)
        # Even two equally incomplete runs cannot define their own cohort.
        self.lines(self.log_a, self.a[:-1])
        self.lines(self.log_b, self.b[:-1])
        with self.assertRaises(ValueError):
            candidate(self.manifest, self.base)

    def test_duplicate_model_and_unexpected_effort(self):
        self.runs[0]["effort"] = "low"
        self.manifest.write_text(json.dumps(self.meta))
        with self.assertRaises(ValueError):
            candidate(self.manifest, self.base)
        self.runs[0]["effort"] = "high"
        self.runs[1]["model"] = self.runs[0]["model"]
        self.manifest.write_text(json.dumps(self.meta))
        with self.assertRaises(ValueError):
            candidate(self.manifest, self.base)

    def test_cost_requires_separately_reconciled_full_log(self):
        billing = self.dir / "bill.json"
        entry = dict(source="provider_bill", reference="private-receipt",
                     results_sha256=hashlib.sha256(self.log_a.read_bytes()).hexdigest(),
                     logged_attempts=len(self.a), amount_rub="10.33")

        def settle(row, scope="all_provider_charges_including_retries"):
            billing.write_text(json.dumps({"scope": scope, "models": {"A": row}}))
            return candidate(self.manifest, self.base, billing)

        data = settle(entry)
        self.assertEqual(data["ege"]["results"][0]["cost_rub_per_100"], 344.33)
        self.assertNotIn("cost_rub_per_100", data["ege"]["results"][1])
        self.assertNotIn("private-receipt", json.dumps(data))
        for patch in ({"logged_attempts": len(self.a)-1}, {"results_sha256": "wrong"},
                      {"amount_rub":"NaN"}, {"amount_rub": -1}, {"source":"runner_estimate"}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                settle(dict(entry, **patch))
        with self.assertRaises(ValueError):
            settle(entry, "completed_only")

    def test_cli_dry_run_and_no_clobber(self):
        args = [sys.executable, str(SCRIPT), str(self.manifest), "--base", str(self.base)]
        before = set(self.dir.iterdir())
        out = subprocess.run(args, check=True, capture_output=True, text=True)
        self.assertIn("Dry run", out.stdout)
        self.assertEqual(before, set(self.dir.iterdir()))
        path = self.dir / "candidate.json"
        data = candidate(self.manifest, self.base)
        save_new(path, data)
        with self.assertRaises(FileExistsError):
            save_new(path, {"unexpected": True})
        self.assertEqual(json.loads(path.read_text()), data)
        self.assertEqual(candidate(self.manifest, path), data)


if __name__ == "__main__":
    unittest.main()
