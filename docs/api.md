# REST API Reference

RuleIndex exposes a **RESTful HTTP API** (plus lightweight static JSON endpoints on GitHub Pages and deep-linkable web page URLs) so external tools, CI pipelines, scripts, and AI coding agents can query ranked rules, apply filters and sorting, generate generic Markdown rules files, and open pre-configured views of the web page.

---

## Table of Contents

- [Overview & Quick Start](../README.md) — High-level overview of RuleIndex and a quick guide to using the web application.
- [Web App User Guide](user-guide.md) — Detailed walkthrough of searching, filtering, sorting, copying rules, inspecting real-world examples, sharing links, and customizing themes.
- **REST API Reference** *(current page)* — Complete reference and usage examples for the RuleIndex RESTful API, static GitHub Pages JSON endpoints, and web page URL automation.
- [Architecture & Codebase Reference](architecture.md) — Complete repository layout, file-by-file breakdown, database schema, JSON dataset format, and frontend component overview.
- [Algorithms, Scraping & Configuration](algorithms-and-configuration.md) — Deep-dive into GitHub discovery, language sharding, revisit windows, rule parsing, English normalization, semantic clustering, and ranking math.
- [Development, Setup & Deployment](development-and-deployment.md) — Instructions for running the scraper and frontend locally, configuring GitHub Pages, managing optional API secrets, and maintaining the pipeline.

---

## Starting the REST API Server

The REST API server in `api/server.py` uses **only the Python standard library** (zero extra dependencies) and reads directly from `data/rules.db`, automatically reloading whenever the database updates.

```bash
python api/server.py --host 127.0.0.1 --port 8000
```

| Flag | Default | Description |
| :--- | :--- | :--- |
| `--host` | `127.0.0.1` | Bind address (use `0.0.0.0` when hosting in a container or server) |
| `--port` | `8000` | Listening port |
| `--db` | `data/rules.db` | Path to the RuleIndex SQLite database |
| `--web-base-url` | `https://michaelmallo.github.io/rule-index/` | Base URL used by `/api/v1/page-url` |

All endpoints include permissive CORS headers (`Access-Control-Allow-Origin: *`) and return structured JSON errors (`400 Bad Request`, `404 Not Found`, `405 Method Not Allowed`) on invalid input.

---

## Endpoint Summary

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Liveness check, API version, and dataset timestamp |
| `GET` | `/api/v1/stats` | Dataset counts (`total_rules`, `total_repos_indexed`), agents, and categories |
| `GET` | `/api/v1/categories` | All 7 rule categories with exact rule counts |
| `GET` | `/api/v1/agents` | All 8 target agent systems with exact rule counts |
| `GET` | `/api/v1/rules` | Paginated, filtered, and sorted canonical rules |
| `GET` | `/api/v1/rules/{id}` | Full details and verbatim repository examples for a single rule |
| `GET` | `/api/v1/rules-file` | Generate a generic Markdown rules file via query parameters |
| `POST` | `/api/v1/rules-file` | Generate a generic Markdown rules file via JSON request body |
| `GET` | `/api/v1/page-url` | Build a validated deep-link URL to open the web page with filters/generator state |
| `GET` | `/api/v1/openapi.json` | Machine-readable OpenAPI 3.1.0 specification |

---

## Endpoint Details & Examples

### 1. Query, Filter & Sort Rankings (`GET /api/v1/rules`)

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `q` | `string` | `""` | Keyword search across title, summary, category, agents, examples, and repos |
| `agents` | `csv string` | *(all)* | Comma-separated agents (`Universal`, `Claude`, `Cursor`, `Codex`, `Cline`, `Copilot`, `Windsurf`, `Gemini`) |
| `categories` | `csv string` | *(all)* | Comma-separated categories (e.g., `Security & Secrets,Testing & Verification`) |
| `min_adoption` | `integer` | `0` | Minimum number of unique repositories adopting the rule (`min` alias supported) |
| `sort` | `enum` | `repos` | Ranking order: `repos` (Most Repos), `weighted` (Star-Weighted), or `trending` (Recently Added) |
| `limit` | `integer` | `50` | Page size (`1–500`) |
| `offset` | `integer` | `0` | Pagination offset |
| `include_examples` | `boolean` | `true` | Set `false` to omit verbatim examples for a lighter payload |

#### `curl` Example
```bash
curl "http://127.0.0.1:8000/api/v1/rules?agents=Claude,Universal&min_adoption=25&sort=weighted&limit=5&include_examples=false"
```

#### Response Example
```json
{
  "total": 24,
  "limit": 5,
  "offset": 0,
  "has_more": true,
  "sort": "weighted",
  "filters": {
    "q": "",
    "agents": ["Claude", "Universal"],
    "categories": [],
    "min_adoption": 25
  },
  "items": [
    {
      "rank": 1,
      "id": "never-commit-secrets-or-credentials-a1b2c3d4",
      "title": "Never commit secrets, API keys, or credentials to version control",
      "summary": "Keep all API keys, tokens, passwords, and private certificates in environment variables...",
      "category": "Security & Secrets",
      "agents": ["Claude", "Cline", "Codex", "Copilot", "Cursor", "Gemini", "Universal", "Windsurf"],
      "adoption_count": 318,
      "weighted_score": 1294.6,
      "first_seen": "2025-09-14T00:00:00Z",
      "last_updated": "2026-11-28T15:37:00Z",
      "example_count": 4
    }
  ]
}
```

---

### 2. Retrieve a Single Rule (`GET /api/v1/rules/{id}`)

```bash
curl "http://127.0.0.1:8000/api/v1/rules/never-commit-secrets-or-credentials-a1b2c3d4"
```

Returns `200 OK` with the full rule object (including `examples`) or `404 Not Found`.

---

### 3. Generate a Rules File (`GET` or `POST /api/v1/rules-file`)

Generates a clean, generic Markdown rules file grouped by category from:
- **`top_n`** (`1–25`) rules per selected **`categories`** (respecting `q`, `agents`, `min_adoption`, and `sort`),
- explicit **`rule_ids`**, or
- **both combined** (automatically deduplicated).

Set `format=markdown` (default, `Content-Type: text/markdown`) to receive raw Markdown directly, or `format=json` (or `Accept: application/json`) for a JSON envelope containing `markdown`, `rule_count`, `category_count`, `categories`, `missing_rule_ids`, and `rules`.

#### `curl` Example (`GET` → save directly to `AGENTS.md`)
```bash
curl -s "http://127.0.0.1:8000/api/v1/rules-file?top_n=5&agents=Universal,Claude&sort=weighted" -o AGENTS.md
```

#### `curl` Example (`POST` with JSON body → JSON response)
```bash
curl -X POST "http://127.0.0.1:8000/api/v1/rules-file" \
  -H "Content-Type: application/json" \
  -d '{
    "categories": ["Security & Secrets", "Testing & Verification", "Git & Workflow"],
    "top_n": 3,
    "sort": "weighted",
    "include_summaries": true,
    "format": "json"
  }'
```

#### Python Example
```python
import requests

resp = requests.post(
    "http://127.0.0.1:8000/api/v1/rules-file",
    json={
        "categories": ["Code Style & Architecture", "Security & Secrets"],
        "top_n": 5,
        "agents": ["Universal", "Cursor"],
        "sort": "repos",
        "include_summaries": True,
        "format": "markdown",
    },
    timeout=10,
)
resp.raise_for_status()
with open("AGENTS.md", "w", encoding="utf-8") as f:
    f.write(resp.text)
```

#### JavaScript (`fetch`) Example
```javascript
const res = await fetch("http://127.0.0.1:8000/api/v1/rules-file", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    top_n: 4,
    categories: ["Testing & Verification", "Error Handling"],
    format: "json",
  }),
});
const { markdown, rule_count } = await res.json();
console.log(`Generated ${rule_count} rules:\n`, markdown);
```

---

### 4. Interact with the Web Page via Deep-Link URLs (`GET /api/v1/page-url`)

External actors can programmatically open the **RuleIndex** web page with pre-applied filters, sorting, and an auto-opened Rules File Generator modal.

#### Build a Validated URL via the API
```bash
curl "http://127.0.0.1:8000/api/v1/page-url?q=secrets&agents=Claude,Universal&min_adoption=25&sort=weighted&generate=true&top_n=5"
```

```json
{
  "url": "https://michaelmallo.github.io/rule-index/?q=secrets&agents=Claude%2CUniversal&min=25&sort=weighted&generate=1&top_n=5",
  "params": {
    "q": "secrets",
    "agents": "Claude,Universal",
    "min": "25",
    "sort": "weighted",
    "generate": "1",
    "top_n": "5"
  }
}
```

#### Supported Web Page Query Parameters
- `q` — Pre-fill keyword search
- `agents` — Comma-separated Target Agent filters
- `categories` — Comma-separated Rule Category filters
- `min` — Minimum adoption threshold (`5`, `25`, or `100`)
- `sort` — Sort order (`repos`, `weighted`, or `trending`)
- `generate=1` — Automatically open the **Generate Rules File** modal on load
- `top_n` — Pre-fill Top `N` per category (`1–25`) when `generate=1`
- `include_summaries` — `1` or `0` to toggle summaries when `generate=1`

---

## Static Read-Only JSON Endpoints on GitHub Pages

Because GitHub Pages hosts static files without requiring a running API server, every hourly scrape also publishes lightweight static JSON endpoints directly alongside the web app:

| Static URL | Contents |
| :--- | :--- |
| `https://michaelmallo.github.io/rule-index/api/v1/stats.json` | Live summary counts, agents, categories, and `generated_at` timestamp |
| `https://michaelmallo.github.io/rule-index/api/v1/top-rules.json` | Top 100 overall rules + Top 10 rules per category (compact payload) |
| `https://michaelmallo.github.io/rule-index/data/rules.json` | Complete minified dataset of all canonical rules |

```bash
# Fetch summary stats directly from GitHub Pages (no API server required)
curl -s "https://michaelmallo.github.io/rule-index/api/v1/stats.json"
```
