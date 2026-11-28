"""Unit and HTTP integration tests for the RuleIndex RESTful API."""

from __future__ import annotations

import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "scraper"))
sys.path.insert(0, str(ROOT_DIR / "api"))

from database import RuleDatabase
from seed_data import build_seed_rules
from server import RuleIndexHTTPServer
from service import RuleIndexService


class RuleIndexAPITestCase(unittest.TestCase):
    """End-to-end tests against a live local ThreadingHTTPServer + seeded SQLite DB."""

    @classmethod
    def setUpClass(cls) -> None:
        cls._tmpdir = tempfile.TemporaryDirectory()
        cls.db_path = Path(cls._tmpdir.name) / "test_rules.db"
        with RuleDatabase(cls.db_path) as db:
            db.upsert_canonical_rules(build_seed_rules())

        service = RuleIndexService(db_path=cls.db_path)
        cls.httpd = RuleIndexHTTPServer(("127.0.0.1", 0), service=service)
        cls.port = cls.httpd.server_port
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls._tmpdir.cleanup()

    def _get(self, path: str, headers: dict[str, str] | None = None) -> tuple[int, str, str]:
        req = Request(f"{self.base_url}{path}", headers=headers or {})
        try:
            with urlopen(req, timeout=5) as resp:
                return resp.status, resp.headers.get("Content-Type", ""), resp.read().decode("utf-8")
        except HTTPError as err:
            return err.code, err.headers.get("Content-Type", ""), err.read().decode("utf-8")

    def _post(
        self,
        path: str,
        payload: dict,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, str, str]:
        req_headers = {"Content-Type": "application/json", **(headers or {})}
        data = json.dumps(payload).encode("utf-8")
        req = Request(f"{self.base_url}{path}", data=data, headers=req_headers, method="POST")
        try:
            with urlopen(req, timeout=5) as resp:
                return resp.status, resp.headers.get("Content-Type", ""), resp.read().decode("utf-8")
        except HTTPError as err:
            return err.code, err.headers.get("Content-Type", ""), err.read().decode("utf-8")

    def test_health_and_stats(self) -> None:
        status, _, body = self._get("/api/v1/health")
        self.assertEqual(status, 200)
        health = json.loads(body)
        self.assertEqual(health["status"], "ok")
        self.assertGreaterEqual(health["total_rules"], 25)

        status, _, stats_body = self._get("/api/v1/stats")
        self.assertEqual(status, 200)
        stats = json.loads(stats_body)
        self.assertEqual(stats["total_rules"], health["total_rules"])
        self.assertIn("Security & Secrets", stats["categories"])
        self.assertIn("Claude", stats["agents_covered"])

    def test_categories_and_agents(self) -> None:
        status, _, body = self._get("/api/v1/categories")
        self.assertEqual(status, 200)
        cats = json.loads(body)["categories"]
        self.assertEqual(len(cats), 7)
        self.assertTrue(all(c["rule_count"] > 0 for c in cats))

        status, _, body = self._get("/api/v1/agents")
        self.assertEqual(status, 200)
        agents = json.loads(body)["agents"]
        self.assertEqual(len(agents), 8)

    def test_rules_filter_sort_and_pagination(self) -> None:
        status, _, body = self._get(
            "/api/v1/rules?agents=Claude&min_adoption=100&sort=weighted&limit=5&offset=0&include_examples=false"
        )
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data["sort"], "weighted")
        self.assertEqual(len(data["items"]), 5)
        self.assertNotIn("examples", data["items"][0])
        self.assertIn("example_count", data["items"][0])
        scores = [item["weighted_score"] for item in data["items"]]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertTrue(all(item["adoption_count"] >= 100 for item in data["items"]))
        self.assertTrue(all("Claude" in item["agents"] for item in data["items"]))

    def test_rule_by_id_found_and_not_found(self) -> None:
        _, _, list_body = self._get("/api/v1/rules?limit=1")
        rule_id = json.loads(list_body)["items"][0]["id"]

        status, _, body = self._get(f"/api/v1/rules/{rule_id}")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["id"], rule_id)

        status_404, _, _ = self._get("/api/v1/rules/does-not-exist-0000")
        self.assertEqual(status_404, 404)

    def test_generate_rules_file_get_and_post(self) -> None:
        status, ctype, md_body = self._get(
            "/api/v1/rules-file?categories=Security+%26+Secrets,Testing+%26+Verification&top_n=2&format=markdown"
        )
        self.assertEqual(status, 200)
        self.assertIn("text/markdown", ctype)
        self.assertIn("# AI Coding Agent Rules", md_body)
        self.assertIn("## Security & Secrets", md_body)
        self.assertIn("## Testing & Verification", md_body)

        status, ctype, json_body = self._post(
            "/api/v1/rules-file",
            {
                "categories": ["Git & Workflow"],
                "top_n": 2,
                "include_summaries": False,
                "format": "json",
            },
        )
        self.assertEqual(status, 200)
        self.assertIn("application/json", ctype)
        payload = json.loads(json_body)
        self.assertEqual(payload["rule_count"], 2)
        self.assertEqual(payload["categories"], ["Git & Workflow"])
        self.assertIn("## Git & Workflow", payload["markdown"])

    def test_page_url_and_openapi(self) -> None:
        status, _, body = self._get(
            "/api/v1/page-url?q=secrets&agents=Claude,Universal&min_adoption=25&sort=weighted&generate=true&top_n=3"
        )
        self.assertEqual(status, 200)
        url = json.loads(body)["url"]
        self.assertIn("q=secrets", url)
        self.assertIn("generate=1", url)
        self.assertIn("top_n=3", url)

        status, _, spec_body = self._get("/api/v1/openapi.json")
        self.assertEqual(status, 200)
        spec = json.loads(spec_body)
        self.assertEqual(spec["openapi"], "3.1.0")
        self.assertIn("/api/v1/rules-file", spec["paths"])

    def test_invalid_parameters_return_400(self) -> None:
        status, _, _ = self._get("/api/v1/rules?sort=invalid_sort")
        self.assertEqual(status, 400)

        status, _, _ = self._get("/api/v1/rules?agents=UnknownAgent")
        self.assertEqual(status, 400)

        status, _, _ = self._post("/api/v1/rules-file", {"top_n": 999})
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()
