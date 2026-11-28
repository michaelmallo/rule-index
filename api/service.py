"""Core query, filtering, rules-file generation, and OpenAPI logic for the RuleIndex REST API."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = ROOT_DIR / "data" / "rules.db"
DEFAULT_WEB_BASE_URL = "https://michaelmallo.github.io/rule-index/"

ALL_AGENTS: tuple[str, ...] = (
    "Universal",
    "Claude",
    "Cursor",
    "Codex",
    "Cline",
    "Copilot",
    "Windsurf",
    "Gemini",
)

ALL_CATEGORIES: tuple[str, ...] = (
    "Code Style & Architecture",
    "Testing & Verification",
    "Git & Workflow",
    "Security & Secrets",
    "Tooling & Dependencies",
    "Communication & Planning",
    "Error Handling",
)

VALID_SORTS: tuple[str, ...] = ("repos", "weighted", "trending")
DEFAULT_LIMIT = 50
MAX_LIMIT = 500
DEFAULT_TOP_N = 5
MAX_TOP_N = 25


class APIValidationError(ValueError):
    """Raised when an external caller supplies invalid query or body parameters."""


@dataclass(frozen=True)
class RuleQuery:
    """Validated query parameters for filtering and sorting ranked rules."""

    query: str = ""
    agents: tuple[str, ...] = ()
    categories: tuple[str, ...] = ()
    min_adoption: int = 0
    sort: str = "repos"
    limit: int = DEFAULT_LIMIT
    offset: int = 0
    include_examples: bool = True


def _parse_csv_values(raw: str | list[str] | None) -> list[str]:
    if raw is None:
        return []
    items = raw if isinstance(raw, list) else [raw]
    out: list[str] = []
    for item in items:
        for part in str(item).split(","):
            trimmed = part.strip()
            if trimmed and trimmed not in out:
                out.append(trimmed)
    return out


def _validate_agents(values: list[str]) -> tuple[str, ...]:
    lookup = {a.lower(): a for a in ALL_AGENTS}
    resolved: list[str] = []
    for value in values:
        canonical = lookup.get(value.lower())
        if canonical is None:
            raise APIValidationError(
                f"Invalid agent '{value}'. Valid values: {', '.join(ALL_AGENTS)}."
            )
        if canonical not in resolved:
            resolved.append(canonical)
    return tuple(resolved)


def _validate_categories(values: list[str]) -> tuple[str, ...]:
    lookup = {c.lower(): c for c in ALL_CATEGORIES}
    resolved: list[str] = []
    for value in values:
        canonical = lookup.get(value.lower())
        if canonical is None:
            raise APIValidationError(
                f"Invalid category '{value}'. Valid values: {', '.join(ALL_CATEGORIES)}."
            )
        if canonical not in resolved:
            resolved.append(canonical)
    return tuple(resolved)


def parse_bool_param(value: Any, default: bool) -> bool:
    """Parse a boolean query or JSON parameter strictly."""
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    lowered = str(value).strip().lower()
    if lowered in ("1", "true", "yes", "on"):
        return True
    if lowered in ("0", "false", "no", "off"):
        return False
    raise APIValidationError(f"Invalid boolean value '{value}'. Expected true or false.")


def parse_int_param(
    value: Any,
    name: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    """Parse and range-check an integer parameter."""
    if value is None or value == "":
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise APIValidationError(f"Parameter '{name}' must be an integer.") from exc
    if parsed < minimum or parsed > maximum:
        raise APIValidationError(
            f"Parameter '{name}' must be between {minimum} and {maximum}."
        )
    return parsed


def validate_rule_query(params: dict[str, list[str]]) -> RuleQuery:
    """Validate URL query parameters for `/api/v1/rules`."""
    q = (params.get("q") or [""])[0].strip()
    agents = _validate_agents(_parse_csv_values(params.get("agents")))
    categories = _validate_categories(_parse_csv_values(params.get("categories")))
    min_raw = (params.get("min_adoption") or params.get("min") or [None])[0]
    min_adoption = parse_int_param(min_raw, "min_adoption", default=0, minimum=0, maximum=1_000_000)

    sort = ((params.get("sort") or ["repos"])[0] or "repos").strip().lower()
    if sort not in VALID_SORTS:
        raise APIValidationError(
            f"Invalid sort '{sort}'. Valid values: {', '.join(VALID_SORTS)}."
        )

    limit = parse_int_param(
        (params.get("limit") or [None])[0],
        "limit",
        default=DEFAULT_LIMIT,
        minimum=1,
        maximum=MAX_LIMIT,
    )
    offset = parse_int_param(
        (params.get("offset") or [None])[0],
        "offset",
        default=0,
        minimum=0,
        maximum=1_000_000,
    )
    include_examples = parse_bool_param(
        (params.get("include_examples") or [None])[0],
        default=True,
    )

    return RuleQuery(
        query=q,
        agents=agents,
        categories=categories,
        min_adoption=min_adoption,
        sort=sort,
        limit=limit,
        offset=offset,
        include_examples=include_examples,
    )


def format_rules_markdown(
    rules: list[dict[str, Any]],
    include_summaries: bool = True,
) -> str:
    """Format canonical rules into a clean, generic Markdown rules file."""
    by_category: dict[str, list[dict[str, Any]]] = {}
    for rule in rules:
        by_category.setdefault(str(rule["category"]), []).append(rule)

    lines: list[str] = [
        "# AI Coding Agent Rules",
        "",
        "Engineering guidelines and behavioral directives for AI coding agents working in this repository.",
    ]

    ordered_categories = [c for c in ALL_CATEGORIES if c in by_category] + [
        c for c in by_category if c not in ALL_CATEGORIES
    ]

    for category in ordered_categories:
        cat_rules = by_category[category]
        if not cat_rules:
            continue
        lines.extend(["", f"## {category}", ""])
        for rule in cat_rules:
            clean_title = str(rule["title"]).strip().rstrip(".")
            clean_summary = str(rule.get("summary", "")).strip()
            is_distinct = (
                bool(clean_summary)
                and clean_summary.rstrip(".").lower() != clean_title.lower()
            )
            if include_summaries and is_distinct:
                lines.append(f"- **{clean_title}.** {clean_summary}")
            else:
                lines.append(f"- **{clean_title}.**")

    lines.append("")
    return "\n".join(lines)


class RuleIndexService:
    """Read-only query and generator service backed by `data/rules.db`."""

    def __init__(
        self,
        db_path: Path = DEFAULT_DB_PATH,
        web_base_url: str = DEFAULT_WEB_BASE_URL,
    ) -> None:
        self.db_path = Path(db_path)
        self.web_base_url = web_base_url.rstrip("/") + "/"
        self._cached_mtime: float = -1.0
        self._rules: list[dict[str, Any]] = []
        self._rules_by_id: dict[str, dict[str, Any]] = {}
        self._search_index: dict[str, str] = {}
        self._total_repos_indexed: int = 0
        self._generated_at: str = ""

    def _reload_if_changed(self) -> None:
        if not self.db_path.exists():
            raise FileNotFoundError(f"RuleIndex database not found at {self.db_path}")

        mtime = self.db_path.stat().st_mtime
        if mtime == self._cached_mtime and self._rules:
            return

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            rule_rows = conn.execute(
                """
                SELECT id, title, summary, category, agents_json,
                       adoption_count, weighted_score, first_seen, last_updated
                FROM canonical_rules
                ORDER BY adoption_count DESC, weighted_score DESC, title ASC
                """
            ).fetchall()

            example_rows = conn.execute(
                """
                SELECT rule_id, text, repo, repo_url, file_path, file_url, stars, agent
                FROM rule_examples
                ORDER BY stars DESC
                """
            ).fetchall()

            examples_by_rule: dict[str, list[dict[str, Any]]] = {}
            for ex in example_rows:
                bucket = examples_by_rule.setdefault(ex["rule_id"], [])
                if len(bucket) < 5:
                    bucket.append(
                        {
                            "text": ex["text"],
                            "repo": ex["repo"],
                            "repo_url": ex["repo_url"],
                            "file_path": ex["file_path"],
                            "file_url": ex["file_url"],
                            "stars": int(ex["stars"]),
                            "agent": ex["agent"],
                        }
                    )

            repo_count_row = conn.execute(
                """
                SELECT COUNT(*) AS cnt FROM (
                    SELECT full_name FROM repos
                    UNION
                    SELECT DISTINCT repo FROM rule_examples
                )
                """
            ).fetchone()
            self._total_repos_indexed = int(repo_count_row["cnt"]) if repo_count_row else 0
        finally:
            conn.close()

        loaded: list[dict[str, Any]] = []
        by_id: dict[str, dict[str, Any]] = {}
        search_idx: dict[str, str] = {}

        for row in rule_rows:
            agents = json.loads(row["agents_json"])
            examples = examples_by_rule.get(row["id"], [])
            entry = {
                "id": row["id"],
                "title": row["title"],
                "summary": row["summary"],
                "category": row["category"],
                "agents": agents,
                "adoption_count": int(row["adoption_count"]),
                "weighted_score": float(row["weighted_score"]),
                "first_seen": row["first_seen"],
                "last_updated": row["last_updated"],
                "examples": examples,
            }
            loaded.append(entry)
            by_id[entry["id"]] = entry
            ex_text = " ".join(f"{e['text']} {e['repo']}" for e in examples)
            search_idx[entry["id"]] = (
                f"{entry['title']} {entry['summary']} {entry['category']} "
                f"{' '.join(agents)} {ex_text}"
            ).lower()

        self._rules = loaded
        self._rules_by_id = by_id
        self._search_index = search_idx
        self._generated_at = datetime.fromtimestamp(mtime, tz=timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
        self._cached_mtime = mtime

    def get_stats(self) -> dict[str, Any]:
        self._reload_if_changed()
        return {
            "generated_at": self._generated_at,
            "total_rules": len(self._rules),
            "total_repos_indexed": self._total_repos_indexed,
            "agents_covered": list(ALL_AGENTS),
            "categories": list(ALL_CATEGORIES),
        }

    def get_categories(self) -> list[dict[str, Any]]:
        self._reload_if_changed()
        counts = {cat: 0 for cat in ALL_CATEGORIES}
        for rule in self._rules:
            cat = rule["category"]
            counts[cat] = counts.get(cat, 0) + 1
        return [{"name": cat, "rule_count": counts[cat]} for cat in ALL_CATEGORIES]

    def get_agents(self) -> list[dict[str, Any]]:
        self._reload_if_changed()
        counts = {agent: 0 for agent in ALL_AGENTS}
        for rule in self._rules:
            for agent in rule["agents"]:
                counts[agent] = counts.get(agent, 0) + 1
        return [{"name": agent, "rule_count": counts[agent]} for agent in ALL_AGENTS]

    def _filter_and_sort(self, query: RuleQuery) -> list[dict[str, Any]]:
        self._reload_if_changed()
        q_lower = query.query.lower()
        agent_set = set(query.agents)
        cat_set = set(query.categories)

        matched: list[dict[str, Any]] = []
        for rule in self._rules:
            if rule["adoption_count"] < query.min_adoption:
                continue
            if agent_set and not any(a in agent_set for a in rule["agents"]):
                continue
            if cat_set and rule["category"] not in cat_set:
                continue
            if q_lower and q_lower not in self._search_index[rule["id"]]:
                continue
            matched.append(rule)

        if query.sort == "weighted":
            matched.sort(
                key=lambda r: (r["weighted_score"], r["adoption_count"]),
                reverse=True,
            )
        elif query.sort == "trending":
            matched.sort(
                key=lambda r: (r["first_seen"], r["weighted_score"]),
                reverse=True,
            )
        else:
            matched.sort(
                key=lambda r: (r["adoption_count"], r["weighted_score"]),
                reverse=True,
            )

        return matched

    def query_rules(self, query: RuleQuery) -> dict[str, Any]:
        matched = self._filter_and_sort(query)
        total = len(matched)
        page_slice = matched[query.offset : query.offset + query.limit]

        items: list[dict[str, Any]] = []
        for idx, rule in enumerate(page_slice):
            rank = query.offset + idx + 1
            if query.include_examples:
                items.append({"rank": rank, **rule})
            else:
                without_examples = {k: v for k, v in rule.items() if k != "examples"}
                without_examples["example_count"] = len(rule["examples"])
                items.append({"rank": rank, **without_examples})

        return {
            "total": total,
            "limit": query.limit,
            "offset": query.offset,
            "has_more": (query.offset + len(items)) < total,
            "sort": query.sort,
            "filters": {
                "q": query.query,
                "agents": list(query.agents),
                "categories": list(query.categories),
                "min_adoption": query.min_adoption,
            },
            "items": items,
        }

    def get_rule_by_id(self, rule_id: str) -> dict[str, Any] | None:
        self._reload_if_changed()
        rule = self._rules_by_id.get(rule_id)
        if rule is None:
            return None
        return dict(rule)

    def generate_rules_file(
        self,
        *,
        rule_ids: list[str] | None = None,
        categories: list[str] | None = None,
        top_n: int | None = None,
        query: str = "",
        agents: list[str] | None = None,
        min_adoption: int = 0,
        sort: str = "repos",
        include_summaries: bool = True,
    ) -> dict[str, Any]:
        """Generate a generic Markdown rules file from explicit IDs and/or top N per category."""
        self._reload_if_changed()

        if sort not in VALID_SORTS:
            raise APIValidationError(
                f"Invalid sort '{sort}'. Valid values: {', '.join(VALID_SORTS)}."
            )

        valid_agents = _validate_agents(agents or [])
        valid_categories = _validate_categories(categories or [])

        if top_n is not None:
            top_n = parse_int_param(top_n, "top_n", default=DEFAULT_TOP_N, minimum=1, maximum=MAX_TOP_N)

        explicit_ids = [rid.strip() for rid in (rule_ids or []) if rid and rid.strip()]
        if not explicit_ids and top_n is None:
            # Default to top 5 across selected (or all) categories
            top_n = DEFAULT_TOP_N

        selected: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        missing_ids: list[str] = []

        for rid in explicit_ids:
            found = self._rules_by_id.get(rid)
            if found is None:
                missing_ids.append(rid)
                continue
            if rid not in seen_ids:
                seen_ids.add(rid)
                selected.append(found)

        if top_n is not None:
            target_cats = valid_categories if valid_categories else ALL_CATEGORIES
            pool = self._filter_and_sort(
                RuleQuery(
                    query=query.strip(),
                    agents=valid_agents,
                    categories=target_cats,
                    min_adoption=min_adoption,
                    sort=sort,
                )
            )
            buckets: dict[str, list[dict[str, Any]]] = {cat: [] for cat in target_cats}
            filled = 0
            for rule in pool:
                cat = rule["category"]
                bucket = buckets.get(cat)
                if bucket is None or len(bucket) >= top_n:
                    continue
                bucket.append(rule)
                if len(bucket) == top_n:
                    filled += 1
                    if filled >= len(target_cats):
                        break
            for cat in ALL_CATEGORIES:
                for rule in buckets.get(cat, []):
                    if rule["id"] not in seen_ids:
                        seen_ids.add(rule["id"])
                        selected.append(rule)

        # Group deterministically by canonical category order
        grouped: list[dict[str, Any]] = []
        for cat in ALL_CATEGORIES:
            grouped.extend(r for r in selected if r["category"] == cat)
        grouped.extend(r for r in selected if r["category"] not in ALL_CATEGORIES)

        markdown = format_rules_markdown(grouped, include_summaries=include_summaries)
        categories_included = [
            cat for cat in ALL_CATEGORIES if any(r["category"] == cat for r in grouped)
        ]

        return {
            "rule_count": len(grouped),
            "category_count": len(categories_included),
            "categories": categories_included,
            "missing_rule_ids": missing_ids,
            "include_summaries": include_summaries,
            "markdown": markdown,
            "rules": [
                {
                    "id": r["id"],
                    "title": r["title"],
                    "summary": r["summary"],
                    "category": r["category"],
                    "adoption_count": r["adoption_count"],
                    "weighted_score": r["weighted_score"],
                }
                for r in grouped
            ],
        }

    def build_page_url(
        self,
        *,
        query: str = "",
        agents: list[str] | None = None,
        categories: list[str] | None = None,
        min_adoption: int = 0,
        sort: str = "repos",
        generate: bool = False,
        top_n: int | None = None,
        include_summaries: bool = True,
    ) -> dict[str, Any]:
        """Build a validated deep-link URL to interact with the RuleIndex web page."""
        valid_agents = _validate_agents(agents or [])
        valid_categories = _validate_categories(categories or [])
        if sort not in VALID_SORTS:
            raise APIValidationError(
                f"Invalid sort '{sort}'. Valid values: {', '.join(VALID_SORTS)}."
            )
        if min_adoption not in (0, 5, 25, 100):
            raise APIValidationError(
                "Web page 'min_adoption' must be one of: 0, 5, 25, 100."
            )

        qs: dict[str, str] = {}
        if query.strip():
            qs["q"] = query.strip()
        if valid_agents:
            qs["agents"] = ",".join(valid_agents)
        if valid_categories:
            qs["categories"] = ",".join(valid_categories)
        if min_adoption > 0:
            qs["min"] = str(min_adoption)
        if sort != "repos":
            qs["sort"] = sort
        if generate:
            qs["generate"] = "1"
            if top_n is not None:
                valid_top_n = parse_int_param(
                    top_n, "top_n", default=DEFAULT_TOP_N, minimum=1, maximum=MAX_TOP_N
                )
                qs["top_n"] = str(valid_top_n)
            if not include_summaries:
                qs["include_summaries"] = "0"

        url = f"{self.web_base_url}?{urlencode(qs)}" if qs else self.web_base_url
        return {"url": url, "params": qs}


def build_openapi_spec(server_url: str = "http://localhost:8000") -> dict[str, Any]:
    """Return an OpenAPI 3.1.0 specification for the RuleIndex REST API."""
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "RuleIndex REST API",
            "version": "1.0.0",
            "description": (
                "RESTful API for querying ranked AI coding agent rules, applying filters "
                "and sorting, generating generic Markdown rules files, and constructing "
                "deep-linked RuleIndex web page URLs."
            ),
        },
        "servers": [{"url": server_url}],
        "paths": {
            "/api/v1/health": {
                "get": {
                    "summary": "Health check",
                    "responses": {"200": {"description": "Service status and dataset timestamp"}},
                }
            },
            "/api/v1/stats": {
                "get": {
                    "summary": "Dataset summary statistics",
                    "responses": {"200": {"description": "Rule counts, repo count, agents, categories"}},
                }
            },
            "/api/v1/categories": {
                "get": {
                    "summary": "List categories with rule counts",
                    "responses": {"200": {"description": "Category counts"}},
                }
            },
            "/api/v1/agents": {
                "get": {
                    "summary": "List target agents with rule counts",
                    "responses": {"200": {"description": "Agent counts"}},
                }
            },
            "/api/v1/rules": {
                "get": {
                    "summary": "Query, filter, and sort ranked rules",
                    "parameters": [
                        {"name": "q", "in": "query", "schema": {"type": "string"}},
                        {"name": "agents", "in": "query", "schema": {"type": "string"}},
                        {"name": "categories", "in": "query", "schema": {"type": "string"}},
                        {"name": "min_adoption", "in": "query", "schema": {"type": "integer", "minimum": 0}},
                        {"name": "sort", "in": "query", "schema": {"type": "string", "enum": list(VALID_SORTS)}},
                        {"name": "limit", "in": "query", "schema": {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT}},
                        {"name": "offset", "in": "query", "schema": {"type": "integer", "minimum": 0}},
                        {"name": "include_examples", "in": "query", "schema": {"type": "boolean"}},
                    ],
                    "responses": {
                        "200": {"description": "Paginated ranked rules"},
                        "400": {"description": "Invalid query parameter"},
                    },
                }
            },
            "/api/v1/rules/{id}": {
                "get": {
                    "summary": "Retrieve a single canonical rule by ID",
                    "parameters": [
                        {"name": "id", "in": "path", "required": True, "schema": {"type": "string"}}
                    ],
                    "responses": {
                        "200": {"description": "Canonical rule details"},
                        "404": {"description": "Rule not found"},
                    },
                }
            },
            "/api/v1/rules-file": {
                "get": {
                    "summary": "Generate a Markdown rules file via query parameters",
                    "parameters": [
                        {"name": "rule_ids", "in": "query", "schema": {"type": "string"}},
                        {"name": "categories", "in": "query", "schema": {"type": "string"}},
                        {"name": "top_n", "in": "query", "schema": {"type": "integer", "minimum": 1, "maximum": MAX_TOP_N}},
                        {"name": "q", "in": "query", "schema": {"type": "string"}},
                        {"name": "agents", "in": "query", "schema": {"type": "string"}},
                        {"name": "min_adoption", "in": "query", "schema": {"type": "integer", "minimum": 0}},
                        {"name": "sort", "in": "query", "schema": {"type": "string", "enum": list(VALID_SORTS)}},
                        {"name": "include_summaries", "in": "query", "schema": {"type": "boolean"}},
                        {"name": "format", "in": "query", "schema": {"type": "string", "enum": ["markdown", "json"]}},
                    ],
                    "responses": {
                        "200": {"description": "Generated Markdown rules file or JSON envelope"},
                        "400": {"description": "Invalid request parameters"},
                    },
                },
                "post": {
                    "summary": "Generate a Markdown rules file from JSON payload",
                    "responses": {
                        "200": {"description": "Generated Markdown rules file or JSON envelope"},
                        "400": {"description": "Invalid JSON body or parameters"},
                    },
                },
            },
            "/api/v1/page-url": {
                "get": {
                    "summary": "Build a deep-link URL to the RuleIndex web app with filters/generator state",
                    "responses": {
                        "200": {"description": "Validated deep-link URL"},
                        "400": {"description": "Invalid web page parameter"},
                    },
                }
            },
            "/api/v1/openapi.json": {
                "get": {
                    "summary": "OpenAPI 3.1 specification",
                    "responses": {"200": {"description": "OpenAPI JSON schema"}},
                }
            },
        },
    }
