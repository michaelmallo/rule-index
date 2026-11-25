"""SQLite persistence and static JSON dataset export for RuleIndex."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from config import ALL_AGENTS, ALL_CATEGORIES
from distiller import CanonicalRule, RawRuleObservation, RuleExample
from translator import EnglishNormalizer, is_english


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS pipeline_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repos (
    full_name TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    stars INTEGER NOT NULL DEFAULT 0,
    last_scraped TEXT NOT NULL,
    last_scraped_execution INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS raw_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_full_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_url TEXT NOT NULL,
    agents_json TEXT NOT NULL,
    text TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    UNIQUE(repo_full_name, file_path, text)
);

CREATE TABLE IF NOT EXISTS canonical_rules (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    category TEXT NOT NULL,
    agents_json TEXT NOT NULL,
    adoption_count INTEGER NOT NULL,
    weighted_score REAL NOT NULL,
    first_seen TEXT NOT NULL,
    last_updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rule_examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id TEXT NOT NULL,
    text TEXT NOT NULL,
    repo TEXT NOT NULL,
    repo_url TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_url TEXT NOT NULL,
    stars INTEGER NOT NULL DEFAULT 0,
    agent TEXT NOT NULL,
    FOREIGN KEY(rule_id) REFERENCES canonical_rules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rule_examples_rule_id ON rule_examples(rule_id);
"""


class RuleDatabase:
    """Manages SQLite state, deduplication, and JSON export for RuleIndex."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON;")
        self.conn.executescript(SCHEMA_SQL)
        # Migrate pre-existing repos tables that lack last_scraped_execution
        repo_cols = {
            row["name"] for row in self.conn.execute("PRAGMA table_info(repos)").fetchall()
        }
        if "last_scraped_execution" not in repo_cols:
            self.conn.execute(
                "ALTER TABLE repos ADD COLUMN last_scraped_execution INTEGER NOT NULL DEFAULT 0"
            )
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> RuleDatabase:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def get_execution_count(self) -> int:
        """Return the current cumulative live execution counter."""
        row = self.conn.execute(
            "SELECT value FROM pipeline_state WHERE key = 'execution_count'"
        ).fetchone()
        return int(row["value"]) if row else 0

    def increment_execution_count(self) -> int:
        """Atomically increment and return the cumulative live execution counter."""
        next_count = self.get_execution_count() + 1
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO pipeline_state (key, value)
                VALUES ('execution_count', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (str(next_count),),
            )
        return next_count

    def get_recently_scraped_repos(
        self,
        current_execution: int,
        skip_within_executions: int,
    ) -> set[str]:
        """Return repo full_names scraped within the last `skip_within_executions` runs."""
        if skip_within_executions <= 0:
            return set()
        cutoff = current_execution - skip_within_executions
        rows = self.conn.execute(
            """
            SELECT full_name FROM repos
            WHERE last_scraped_execution > 0 AND last_scraped_execution > ?
            """,
            (cutoff,),
        ).fetchall()
        return {row["full_name"] for row in rows}

    def get_cached_repo_stars(self) -> dict[str, int]:
        """Return cached star counts for previously scraped repositories."""
        rows = self.conn.execute("SELECT full_name, stars FROM repos").fetchall()
        return {row["full_name"]: int(row["stars"]) for row in rows}

    def mark_repos_scraped(
        self,
        repos: Iterable[tuple[str, str, int]],
        execution_number: int,
    ) -> None:
        """Record that a set of (full_name, url, stars) repos were checked in `execution_number`."""
        now_iso = datetime.now(timezone.utc).isoformat()
        with self.conn:
            for full_name, url, stars in repos:
                self.conn.execute(
                    """
                    INSERT INTO repos (full_name, url, stars, last_scraped, last_scraped_execution)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(full_name) DO UPDATE SET
                        url = excluded.url,
                        stars = MAX(repos.stars, excluded.stars),
                        last_scraped = excluded.last_scraped,
                        last_scraped_execution = MAX(
                            repos.last_scraped_execution,
                            excluded.last_scraped_execution
                        )
                    """,
                    (full_name, url, stars, now_iso, execution_number),
                )

    def upsert_observations(
        self,
        observations: Iterable[RawRuleObservation],
        execution_number: int = 0,
    ) -> int:
        """Persist raw scraped rule observations and repository metadata."""
        inserted = 0
        now_iso = datetime.now(timezone.utc).isoformat()
        with self.conn:
            for obs in observations:
                self.conn.execute(
                    """
                    INSERT INTO repos (full_name, url, stars, last_scraped, last_scraped_execution)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(full_name) DO UPDATE SET
                        url = excluded.url,
                        stars = MAX(repos.stars, excluded.stars),
                        last_scraped = excluded.last_scraped,
                        last_scraped_execution = MAX(
                            repos.last_scraped_execution,
                            excluded.last_scraped_execution
                        )
                    """,
                    (obs.repo_full_name, obs.repo_url, obs.stars, now_iso, execution_number),
                )
                cur = self.conn.execute(
                    """
                    INSERT OR IGNORE INTO raw_rules
                        (repo_full_name, file_path, file_url, agents_json, text, observed_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        obs.repo_full_name,
                        obs.file_path,
                        obs.file_url,
                        json.dumps(list(obs.agents)),
                        obs.text,
                        obs.observed_at,
                    ),
                )
                inserted += cur.rowcount
        return inserted

    def load_all_observations(self) -> list[RawRuleObservation]:
        """Load all stored raw observations joined with repository star counts."""
        rows = self.conn.execute(
            """
            SELECT r.text, r.repo_full_name, repos.url AS repo_url, repos.stars,
                   r.file_path, r.file_url, r.agents_json, r.observed_at
            FROM raw_rules r
            JOIN repos ON repos.full_name = r.repo_full_name
            ORDER BY r.id ASC
            """
        ).fetchall()

        return [
            RawRuleObservation(
                text=row["text"],
                repo_full_name=row["repo_full_name"],
                repo_url=row["repo_url"],
                stars=int(row["stars"]),
                file_path=row["file_path"],
                file_url=row["file_url"],
                agents=tuple(json.loads(row["agents_json"])),
                observed_at=row["observed_at"],
            )
            for row in rows
        ]

    def upsert_canonical_rules(self, rules: Iterable[CanonicalRule]) -> None:
        """Upsert canonical rules while preserving earlier first_seen timestamps."""
        with self.conn:
            for rule in rules:
                existing = self.conn.execute(
                    "SELECT first_seen, adoption_count, weighted_score, agents_json "
                    "FROM canonical_rules WHERE id = ?",
                    (rule.id,),
                ).fetchone()

                if existing:
                    first_seen = min(existing["first_seen"], rule.first_seen)
                    merged_agents = sorted(
                        set(json.loads(existing["agents_json"])) | set(rule.agents)
                    )
                    adoption_count = max(int(existing["adoption_count"]), rule.adoption_count)
                    weighted_score = max(float(existing["weighted_score"]), rule.weighted_score)
                else:
                    first_seen = rule.first_seen
                    merged_agents = sorted(set(rule.agents))
                    adoption_count = rule.adoption_count
                    weighted_score = rule.weighted_score

                self.conn.execute(
                    """
                    INSERT INTO canonical_rules
                        (id, title, summary, category, agents_json,
                         adoption_count, weighted_score, first_seen, last_updated)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title = excluded.title,
                        summary = excluded.summary,
                        category = excluded.category,
                        agents_json = excluded.agents_json,
                        adoption_count = excluded.adoption_count,
                        weighted_score = excluded.weighted_score,
                        first_seen = excluded.first_seen,
                        last_updated = excluded.last_updated
                    """,
                    (
                        rule.id,
                        rule.title,
                        rule.summary,
                        rule.category,
                        json.dumps(merged_agents),
                        adoption_count,
                        weighted_score,
                        first_seen,
                        rule.last_updated,
                    ),
                )

                if rule.examples:
                    self.conn.execute("DELETE FROM rule_examples WHERE rule_id = ?", (rule.id,))
                    for ex in rule.examples[:5]:
                        self.conn.execute(
                            """
                            INSERT INTO rule_examples
                                (rule_id, text, repo, repo_url, file_path, file_url, stars, agent)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                rule.id,
                                ex.text,
                                ex.repo,
                                ex.repo_url,
                                ex.file_path,
                                ex.file_url,
                                ex.stars,
                                ex.agent,
                            ),
                        )

    def fetch_canonical_rules(self) -> list[CanonicalRule]:
        """Read all canonical rules with their examples, sorted by adoption and weighted score."""
        rows = self.conn.execute(
            """
            SELECT id, title, summary, category, agents_json,
                   adoption_count, weighted_score, first_seen, last_updated
            FROM canonical_rules
            ORDER BY adoption_count DESC, weighted_score DESC, title ASC
            """
        ).fetchall()

        rules: list[CanonicalRule] = []
        for row in rows:
            ex_rows = self.conn.execute(
                """
                SELECT text, repo, repo_url, file_path, file_url, stars, agent
                FROM rule_examples
                WHERE rule_id = ?
                ORDER BY stars DESC
                LIMIT 5
                """,
                (row["id"],),
            ).fetchall()
            examples = [
                RuleExample(
                    text=ex["text"],
                    repo=ex["repo"],
                    repo_url=ex["repo_url"],
                    file_path=ex["file_path"],
                    file_url=ex["file_url"],
                    stars=int(ex["stars"]),
                    agent=ex["agent"],
                )
                for ex in ex_rows
            ]
            rules.append(
                CanonicalRule(
                    id=row["id"],
                    title=row["title"],
                    summary=row["summary"],
                    category=row["category"],
                    agents=json.loads(row["agents_json"]),
                    adoption_count=int(row["adoption_count"]),
                    weighted_score=float(row["weighted_score"]),
                    examples=examples,
                    first_seen=row["first_seen"],
                    last_updated=row["last_updated"],
                )
            )
        return rules

    def normalize_existing_records(self, normalizer: EnglishNormalizer) -> dict[str, int]:
        """Normalize all existing raw_rules, canonical_rules, and rule_examples to English."""
        stats = {
            "raw_translated": 0,
            "raw_removed": 0,
            "canonical_translated": 0,
            "canonical_removed": 0,
            "examples_translated": 0,
            "examples_removed": 0,
        }

        with self.conn:
            # 1. Normalize raw_rules
            raw_rows = self.conn.execute("SELECT id, text FROM raw_rules").fetchall()
            for row in raw_rows:
                text = row["text"]
                if is_english(text):
                    continue
                translated = normalizer.normalize(text)
                if not translated:
                    self.conn.execute("DELETE FROM raw_rules WHERE id = ?", (row["id"],))
                    stats["raw_removed"] += 1
                    continue
                try:
                    self.conn.execute(
                        "UPDATE raw_rules SET text = ? WHERE id = ?",
                        (translated, row["id"]),
                    )
                    stats["raw_translated"] += 1
                except sqlite3.IntegrityError:
                    # Translated rule already exists for this repo+file; drop duplicate
                    self.conn.execute("DELETE FROM raw_rules WHERE id = ?", (row["id"],))
                    stats["raw_removed"] += 1

            # 2. Normalize canonical_rules
            canonical_rows = self.conn.execute(
                "SELECT id, title, summary FROM canonical_rules"
            ).fetchall()
            for row in canonical_rows:
                title, summary = row["title"], row["summary"]
                if is_english(title) and is_english(summary):
                    continue
                new_title = title if is_english(title) else normalizer.normalize(title)
                new_summary = summary if is_english(summary) else normalizer.normalize(summary)
                if not new_title or not new_summary:
                    self.conn.execute("DELETE FROM canonical_rules WHERE id = ?", (row["id"],))
                    stats["canonical_removed"] += 1
                    continue
                self.conn.execute(
                    "UPDATE canonical_rules SET title = ?, summary = ? WHERE id = ?",
                    (new_title.rstrip("."), new_summary, row["id"]),
                )
                stats["canonical_translated"] += 1

            # 3. Normalize rule_examples
            example_rows = self.conn.execute("SELECT id, text FROM rule_examples").fetchall()
            for row in example_rows:
                text = row["text"]
                if is_english(text):
                    continue
                translated = normalizer.normalize(text)
                if not translated:
                    self.conn.execute("DELETE FROM rule_examples WHERE id = ?", (row["id"],))
                    stats["examples_removed"] += 1
                    continue
                self.conn.execute(
                    "UPDATE rule_examples SET text = ? WHERE id = ?",
                    (translated, row["id"]),
                )
                stats["examples_translated"] += 1

        return stats

    def export_json(self, output_paths: Iterable[Path]) -> dict:
        """Export the canonical rules dataset to one or more JSON files."""
        rules = self.fetch_canonical_rules()
        repo_count_row = self.conn.execute(
            """
            SELECT COUNT(*) AS cnt FROM (
                SELECT full_name FROM repos
                UNION
                SELECT DISTINCT repo FROM rule_examples
            )
            """
        ).fetchone()
        indexed_repos = int(repo_count_row["cnt"]) if repo_count_row else 0

        payload = {
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "stats": {
                "total_rules": len(rules),
                "total_repos_indexed": indexed_repos,
                "agents_covered": ALL_AGENTS,
                "categories": ALL_CATEGORIES,
            },
            "rules": [
                {
                    "id": r.id,
                    "title": r.title,
                    "summary": r.summary,
                    "category": r.category,
                    "agents": r.agents,
                    "adoption_count": r.adoption_count,
                    "weighted_score": r.weighted_score,
                    "first_seen": r.first_seen,
                    "last_updated": r.last_updated,
                    "examples": [
                        {
                            "text": ex.text,
                            "repo": ex.repo,
                            "repo_url": ex.repo_url,
                            "file_path": ex.file_path,
                            "file_url": ex.file_url,
                            "stars": ex.stars,
                            "agent": ex.agent,
                        }
                        for ex in r.examples
                    ],
                }
                for r in rules
            ],
        }

        serialized = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
        for path in output_paths:
            path = Path(path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(serialized, encoding="utf-8")

        return payload
