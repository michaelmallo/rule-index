# Architecture & Codebase Reference

RuleIndex is structured as a modular monorepo combining a Python ETL/distillation pipeline (`/scraper`), persistent SQLite and static JSON storage (`/data`), a static Vite + React + TypeScript frontend (`/web`), and an automated GitHub Actions deployment workflow (`/.github/workflows`).

---

## Table of Contents

- [Overview & Quick Start](../README.md) — High-level overview of RuleIndex and a quick guide to using the web application.
- [Web App User Guide](user-guide.md) — Detailed walkthrough of searching, filtering, sorting, copying rules, inspecting real-world examples, sharing links, and customizing themes.
- **Architecture & Codebase Reference** *(current page)* — Complete repository layout, file-by-file breakdown, database schema, JSON dataset format, and frontend component overview.
- [Algorithms, Scraping & Configuration](algorithms-and-configuration.md) — Deep-dive into GitHub discovery, language sharding, revisit windows, rule parsing, English normalization, semantic clustering, and ranking math.
- [Development, Setup & Deployment](development-and-deployment.md) — Instructions for running the scraper and frontend locally, configuring GitHub Pages, managing optional API secrets, and maintaining the pipeline.

---

## Repository Layout

```text
rule-index/
├── .github/
│   └── workflows/
│       └── update-and-deploy.yml   # Hourly scrape, commit, build & GitHub Pages deployment
├── data/
│   ├── rules.db                    # Persistent SQLite database (state, deduplication, cache)
│   └── rules.json                  # Canonical dataset snapshot committed to the repo
├── docs/
│   ├── user-guide.md               # End-user guide for the RuleIndex web app
│   ├── architecture.md             # This document
│   ├── algorithms-and-configuration.md # Scraping, normalization, clustering & scoring details
│   └── development-and-deployment.md   # Local setup, CI/CD, secrets & maintenance
├── scraper/
│   ├── config.py                   # Target files, language shards, categories, defaults
│   ├── github_client.py            # GitHub Code Search & Contents API client
│   ├── parser.py                   # Markdown/rule parser into atomic behavioral directives
│   ├── translator.py               # Language detection & cached English normalization
│   ├── distiller.py                # Embeddings, cosine clustering, scoring, optional LLM hook
│   ├── database.py                 # SQLite schema, migrations, upserts, JSON exporter
│   ├── seed_data.py                # Initial seed dataset & offline sample files
│   ├── run.py                      # CLI entrypoint (--mode live|seed|sample|normalize)
│   └── requirements.txt            # Python dependencies
├── web/
│   ├── public/
│   │   ├── favicon.svg             # Matching brand tab icon
│   │   └── data/
│   │       └── rules.json          # Static dataset served by Vite / GitHub Pages
│   ├── src/
│   │   ├── components/
│   │   │   ├── FilterPanel.tsx     # Reusable Minimum Adoption, Agent & Category filter UI
│   │   │   ├── HelpPage.tsx        # Lazy-loaded in-app Help mirroring README & docs
│   │   │   ├── RuleCard.tsx        # Memoized leaderboard rule card with selection checkbox
│   │   │   ├── RuleDetailDialog.tsx# Native <dialog> modal for rule details & examples
│   │   │   ├── RuleGeneratorDialog.tsx # Native <dialog> modal for generating Markdown rules files
│   │   │   ├── ShareDialog.tsx     # Native <dialog> modal for social/email/SMS/link sharing
│   │   │   ├── ThemeSwitcher.tsx   # 4-theme header switcher
│   │   │   └── ToastRegion.tsx     # Accessible popover="manual" toast notification region
│   │   ├── hooks/
│   │   │   └── useLocalStorage.ts  # Cross-tab synced localStorage persistence hook
│   │   ├── utils/
│   │   │   └── ruleGenerator.ts    # Pure Top-N selection, deduplication & Markdown formatter
│   │   ├── styles/
│   │   │   └── themes.css          # Tailwind v4 + 4 theme palettes, dialog & scrollbox CSS
│   │   ├── App.tsx                 # Main leaderboard layout, URL hydration, scrollbox logic
│   │   ├── main.tsx                # React root mount
│   │   ├── types.ts                # Shared TypeScript interfaces & constants
│   │   └── vite-env.d.ts           # Vite client type definitions
│   ├── index.html                  # Document shell + synchronous FOUC-prevention script
│   ├── package.json                # Frontend scripts & dependencies
│   ├── tsconfig.json               # Strict TypeScript configuration
│   └── vite.config.ts              # Vite build config (base: '/rule-index/')
├── AGENTS.md                       # Authoritative engineering rules for AI coding agents
└── README.md                       # High-level overview & quick start
```

---

## Backend Pipeline Modules (`/scraper`)

| File | Responsibility |
| :--- | :--- |
| `scraper/config.py` | Defines paths (`rules.db`, `data/rules.json`, `web/public/data/rules.json`), the 9 `TARGET_FILES` specifications, the 12 `LANGUAGE_SHARDS`, the 8 `ALL_AGENTS`, the 7 `ALL_CATEGORIES` with keyword maps, and tuning constants (`DEFAULT_PER_PAGE`, `DEFAULT_MAX_REPOS_PER_TARGET`, `DEFAULT_SKIP_WITHIN_EXECUTIONS`, `DEFAULT_EMBEDDING_MODEL`, `DEFAULT_SIMILARITY_THRESHOLD`). |
| `scraper/github_client.py` | Implements `GitHubRuleScraper` and the `ScrapedFile` dataclass. Queries `/search/code` with pagination, proactive rate-limit spacing, exponential backoff on 403/429/5xx, repo skip filtering, raw file fetching via `/repos/{owner}/{repo}/contents/{path}`, and cached star lookups. |
| `scraper/parser.py` | Implements `extract_rules()`. Strips YAML frontmatter, HTML comments, fenced code blocks, directory trees, Markdown tables, and project-specific paths; splits bullet points and sentences; normalizes non-English candidates to English; filters for behavioral directive cues; and deduplicates within a file. |
| `scraper/translator.py` | Implements `is_english()`, `normalize_typography()`, and `EnglishNormalizer`. Combines script detection, Latin-language stopword checks, `langdetect`, rate-limited `deep-translator` translation (preserving `` `code` `` spans), a transient-error circuit breaker, and persistent SQLite caching (`translation_cache`). |
| `scraper/distiller.py` | Implements `SemanticEmbedder`, `cluster_embeddings()`, `classify_category()`, `compute_weighted_score()`, `canonicalize_with_llm()`, and `distill_observations()`. Turns raw observations into ranked `CanonicalRule` clusters with up to 5 real-world examples. |
| `scraper/database.py` | Implements `RuleDatabase`. Manages SQLite schema creation and migrations, tracks cumulative `execution_count` and per-repo `last_scraped_execution`, upserts raw and canonical rules while preserving `first_seen`, normalizes existing non-English records, and exports the static `rules.json` payload. |
| `scraper/seed_data.py` | Provides 28 curated initial `CanonicalRule` records (`build_seed_rules()`) and 4 multi-agent/multi-language sample rule files (`SAMPLE_SCRAPED_FILES`) for offline end-to-end testing. |
| `scraper/run.py` | CLI entrypoint orchestrating `--mode live`, `seed`, `sample`, and `normalize`, connecting `RuleDatabase`, `EnglishNormalizer`, `GitHubRuleScraper`, `extract_rules()`, and `distill_observations()`. |

---

## SQLite Database Schema (`/data/rules.db`)

`rules.db` maintains six tables:

1. **`pipeline_state`** (`key TEXT PRIMARY KEY, value TEXT NOT NULL`) — Stores persistent pipeline metadata such as `execution_count` (incremented on every `live` run to drive shard rotation and repo skip windows).
2. **`repos`** (`full_name PRIMARY KEY, url, stars, last_scraped, last_scraped_execution`) — Tracks every scraped repository, its highest observed star count, last scrape timestamp, and the execution number when it was last inspected.
3. **`raw_rules`** (`id, repo_full_name, file_path, file_url, agents_json, text, observed_at`, `UNIQUE(repo_full_name, file_path, text)`) — Deduplicated store of every extracted English rule observation across all runs.
4. **`canonical_rules`** (`id PRIMARY KEY, title, summary, category, agents_json, adoption_count, weighted_score, first_seen, last_updated`) — Distilled rule clusters exported to the frontend.
5. **`rule_examples`** (`id, rule_id FK -> canonical_rules.id ON DELETE CASCADE, text, repo, repo_url, file_path, file_url, stars, agent`) — Up to 5 highest-star real-world verbatim examples per canonical rule.
6. **`translation_cache`** (`source_text PRIMARY KEY, english_text`) — Caches translated non-English strings so repeated runs never re-translate the same text.

---

## Static JSON Dataset Format (`rules.json`)

Exported identically to `data/rules.json` and `web/public/data/rules.json`:

```json
{
  "generated_at": "2026-11-25T12:00:00Z",
  "stats": {
    "total_rules": 3547,
    "total_repos_indexed": 460,
    "agents_covered": ["Universal", "Claude", "Cursor", "Codex", "Cline", "Copilot", "Windsurf", "Gemini"],
    "categories": ["Code Style & Architecture", "Testing & Verification", "..."]
  },
  "rules": [
    {
      "id": "never-commit-secrets-or-credentials-a1b2c3d4",
      "title": "Never commit secrets, API keys, or credentials to version control",
      "summary": "...",
      "category": "Security & Secrets",
      "agents": ["Claude", "Codex", "Cursor", "Universal"],
      "adoption_count": 318,
      "weighted_score": 1294.6,
      "first_seen": "2025-09-14T00:00:00Z",
      "last_updated": "2026-11-25T12:00:00Z",
      "examples": [
        {
          "text": "...",
          "repo": "vercel/next.js",
          "repo_url": "https://github.com/vercel/next.js",
          "file_path": "AGENTS.md",
          "file_url": "https://github.com/vercel/next.js/blob/HEAD/AGENTS.md",
          "stars": 131400,
          "agent": "Universal"
        }
      ]
    }
  ]
}
```

---

## Frontend Application Architecture (`/web`)

Built with **Vite 6**, **React 19**, **TypeScript 5 (strict)**, **Tailwind CSS v4**, and **Lucide React**:

- **Zero-FOUC Multi-Theme System**: `web/index.html` runs a tiny synchronous script before first paint to read `ruleindex:theme` from `localStorage`, set `document.documentElement.dataset.theme`, and update `<meta name="color-scheme">`. `web/src/styles/themes.css` maps `<meta name="color-scheme">` back to CSS `color-scheme` and defines semantic CSS custom properties (`--bg-page`, `--bg-surface`, `--accent`, `--scrollbar-thumb`, etc.) for all 4 themes.
- **Native Top-Layer Overlays**: Both `RuleDetailDialog.tsx` and `ShareDialog.tsx` (as well as the mobile filter drawer in `App.tsx`) use native `<dialog>` elements opened via `showModal()` with `overscroll-behavior: contain` scroll containment and a `pointerdown`/`pointerup` light-dismiss fallback for browsers lacking `closedby="any"`. Copy notifications use `ToastRegion.tsx` with `popover="manual"` and an ARIA live-region fallback.
- **Responsive Ranked Scrollbox**: `App.tsx` measures the rendered height of the first 10 rule cards via `ResizeObserver` and sizes `.rules-scrollbox` to `max(calc(100dvh - 13rem), var(--ten-rules-height))`. Each card uses `content-visibility: auto; contain-intrinsic-size: auto 184px` so scrolling through thousands of rules remains smooth.
- **URL & `localStorage` Sync**: `useLocalStorage.ts` persists theme, filter, and sort state across tabs; `App.tsx` also hydrates `q`, `agents`, `categories`, `min`, and `sort` URL parameters so links generated by `ShareDialog.tsx` restore exact filtered views.
