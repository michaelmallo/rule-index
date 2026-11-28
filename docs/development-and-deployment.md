# Development, Setup & Deployment

This document covers local development for both the Python scraper and the Vite/React frontend, GitHub Pages setup, automated GitHub Actions CI/CD, optional LLM secrets, and routine maintenance.

---

## Table of Contents

- [Overview & Quick Start](../README.md) — High-level overview of RuleIndex and a quick guide to using the web application.
- [Web App User Guide](user-guide.md) — Detailed walkthrough of searching, filtering, sorting, copying rules, inspecting real-world examples, sharing links, and customizing themes.
- [REST API Reference](api.md) — Complete reference and usage examples for the RuleIndex RESTful API, static GitHub Pages JSON endpoints, and web page URL automation.
- [Architecture & Codebase Reference](architecture.md) — Complete repository layout, file-by-file breakdown, database schema, JSON dataset format, and frontend component overview.
- [Algorithms, Scraping & Configuration](algorithms-and-configuration.md) — Deep-dive into GitHub discovery, language sharding, revisit windows, rule parsing, English normalization, semantic clustering, and ranking math.
- **Development, Setup & Deployment** *(current page)* — Instructions for running the scraper and frontend locally, configuring GitHub Pages, managing optional API secrets, and maintaining the pipeline.

---

## Prerequisites

- **Python 3.12+** (for `/scraper`)
- **Node.js 22+** and **npm** (for `/web`)
- A **GitHub Personal Access Token** (`GITHUB_TOKEN`) if running `--mode live` locally (GitHub Code Search requires authentication).

> **Contributing & AI Agent Rules**: Before making code or documentation changes, read [`AGENTS.md`](../AGENTS.md) at the repository root. It defines the authoritative engineering standards for code style, testing, git workflow, security, dependencies, and error handling in this repository.

---

## 1. Running the Python Scraper Locally (`/scraper`)

Create and activate an isolated virtual environment inside `scraper/.venv`:

```bash
python -m venv scraper/.venv

# Windows (PowerShell):
scraper\.venv\Scripts\Activate.ps1

# macOS / Linux:
source scraper/.venv/bin/activate

pip install -r scraper/requirements.txt
```

> **Tip**: Installing `sentence-transformers` pulls PyTorch (~2 GB). For fast local testing without PyTorch, you can install just `requests numpy scikit-learn langdetect deep-translator`—the distiller automatically falls back to TF-IDF embeddings locally while GitHub Actions uses `sentence-transformers`.

### Pipeline Modes

Run `scraper/run.py` from the repository root:

```bash
# 1. Seed mode — initialize/refresh the 28-rule baseline dataset
python scraper/run.py --mode seed

# 2. Sample mode — run full parse -> English normalize -> cluster -> SQLite -> JSON on built-in sample files (no token required)
python scraper/run.py --mode sample --db sample.tmp.db --json-out sample.tmp.json

# 3. Normalize mode — normalize any existing non-English rows in data/rules.db and re-export JSON
python scraper/run.py --mode normalize

# 4. Live mode — run a real GitHub Code Search scrape (auto-rotates language shard & skips recent repos)
GITHUB_TOKEN=ghp_your_token python scraper/run.py --mode live
```

### Key CLI Flags

| Flag | Default | Description |
| :--- | :--- | :--- |
| `--mode` | `live` | `live`, `seed`, `sample`, or `normalize` |
| `--db` | `data/rules.db` | Path to SQLite database |
| `--json-out` | `data/rules.json` & `web/public/data/rules.json` | Output JSON path (repeatable) |
| `--max-repos-per-target` | `25` | Max newly fetched files per target filename in `live` mode |
| `--per-page` | `100` | GitHub Code Search results per page (1–100) |
| `--skip-within-executions` | `168` | Skip repos scraped within the last `N` executions (7 days at hourly cadence) |
| `--language-shard` | *(rotating)* | Explicit shard override (e.g., `python`, `typescript`, or `""` for general) |
| `--similarity-threshold` | `0.72` | Cosine similarity threshold for semantic clustering (0.0–1.0) |
| `--llm-canonicalize` | `false` | Refine cluster titles/summaries using an optional LLM API key |

---

## 2. Running the Frontend Locally (`/web`)

```bash
cd web
npm install
npm run dev
```

Vite serves the app locally at `http://localhost:5173/rule-index/` and loads `web/public/data/rules.json`.

To verify TypeScript types and build the production bundle:

```bash
cd web
npm run build      # runs `tsc -b && vite build` -> outputs to web/dist/
npm run preview    # previews the production build locally
```

---

## 3. GitHub Pages Setup

1. Open the repository on GitHub and go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Ensure `web/vite.config.ts` has `base: '/rule-index/'` matching your repository name (update `base` if you fork under a different repo name).
4. Push to `main` or manually trigger **Actions → Update Rules & Deploy RuleIndex → Run workflow**.
5. Once the workflow succeeds, the site will be live at `https://<your-username>.github.io/rule-index/`.

---

## 4. Automated CI/CD Workflow (`update-and-deploy.yml`)

`.github/workflows/update-and-deploy.yml` runs automatically:
- **Hourly** via `cron: '37 * * * *'` (off-peak minute to avoid top-of-hour runner contention)
- On **push to `main`**
- Manually via **`workflow_dispatch`**

### Workflow Stages
1. **`scrape-and-build` job** (`timeout-minutes: 45`, `permissions: contents: write, pages: write, id-token: write`):
   - Checks out full git history (`fetch-depth: 0`) and installs cached Python dependencies.
   - Runs `python scraper/run.py --mode live` (automatically appending `--llm-canonicalize` if any LLM API key secret is configured).
   - Stages `data/rules.db`, `data/rules.json`, and `web/public/data/rules.json`, committing and pushing **only** if `git diff --cached --quiet` detects changes.
   - Installs Node 22 dependencies (`npm ci`), builds `web/dist`, and uploads the Pages artifact via `actions/upload-pages-artifact@v3`.
2. **`deploy` job**:
   - Deploys `web/dist` to the `github-pages` environment using `actions/deploy-pages@v4`.

---

## 5. Optional Secrets

The pipeline runs **100% free** using GitHub's built-in `GITHUB_TOKEN` and local `sentence-transformers` embeddings.

To enable LLM-polished canonical rule titles and summaries during clustering, add **any one** of the following secrets under **Settings → Secrets and variables → Actions**:

| Secret | Provider & Model | Priority |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Google Gemini (`gemini-2.0-flash`) | 1st (checked first) |
| `OPENAI_API_KEY` | OpenAI (`gpt-4o-mini`) | 2nd (if Gemini unset) |
| `ANTHROPIC_API_KEY` | Anthropic (`claude-3-5-haiku-latest`) | 3rd (if Gemini & OpenAI unset) |

---

## 6. Maintenance & Troubleshooting

- **Cleaning historical non-English entries**: Run `python scraper/run.py --mode normalize` to normalize any non-English rows in `data/rules.db` and re-export both JSON files.
- **Adjusting discovery speed vs. rate limits**: Tune `DEFAULT_MAX_REPOS_PER_TARGET` and `DEFAULT_SKIP_WITHIN_EXECUTIONS` in `scraper/config.py`. Keep `9 × max_repos_per_target × 2` safely under GitHub Actions' 1,000 REST requests/hour limit.
- **Inspecting SQLite state**:
  ```bash
  sqlite3 data/rules.db "SELECT * FROM pipeline_state; SELECT COUNT(*) FROM repos; SELECT COUNT(*) FROM canonical_rules;"
  ```
- **Adding a new target agent file or language shard**: Add a `TargetFileSpec` to `TARGET_FILES` or a keyword to `LANGUAGE_SHARDS` in `scraper/config.py`. If adding a brand-new agent name, also add it to `ALL_AGENTS` in `scraper/config.py` and `web/src/types.ts`.
