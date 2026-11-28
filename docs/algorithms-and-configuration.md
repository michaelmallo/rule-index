# Algorithms, Scraping & Configuration

This document explains the engineering decisions, rate-limit math, parsing heuristics, English normalization pipeline, semantic clustering algorithm, and ranking formulas powering RuleIndex.

---

## Table of Contents

- [Overview & Quick Start](../README.md) — High-level overview of RuleIndex and a quick guide to using the web application.
- [Web App User Guide](user-guide.md) — Detailed walkthrough of searching, filtering, sorting, copying rules, inspecting real-world examples, sharing links, and customizing themes.
- [REST API Reference](api.md) — Complete reference and usage examples for the RuleIndex RESTful API, static GitHub Pages JSON endpoints, and web page URL automation.
- [Architecture & Codebase Reference](architecture.md) — Complete repository layout, file-by-file breakdown, database schema, JSON dataset format, and frontend component overview.
- **Algorithms, Scraping & Configuration** *(current page)* — Deep-dive into GitHub discovery, language sharding, revisit windows, rule parsing, English normalization, semantic clustering, and ranking math.
- [Development, Setup & Deployment](development-and-deployment.md) — Instructions for running the scraper and frontend locally, configuring GitHub Pages, managing optional API secrets, and maintaining the pipeline.

---

## 1. Target File Discovery & Agent Mapping

`scraper/config.py` defines 9 GitHub Code Search targets mapped to the 8 agent systems:

| Target Query | File Pattern | Assigned Agent(s) |
| :--- | :--- | :--- |
| `filename:AGENTS.md` | `AGENTS.md` | `Universal`, `Codex` |
| `filename:CLAUDE.md` | `CLAUDE.md` | `Claude` |
| `filename:.cursorrules` | `.cursorrules` | `Cursor` |
| `path:.cursor/rules extension:mdc` | `.cursor/rules/*.mdc` | `Cursor` |
| `filename:.windsurfrules` | `.windsurfrules` | `Windsurf` |
| `filename:.clinerules` | `.clinerules` | `Cline` |
| `path:.github filename:copilot-instructions.md` | `.github/copilot-instructions.md` | `Copilot` |
| `filename:GEMINI.md` | `GEMINI.md` | `Gemini` |
| `filename:SKILL.md` | `SKILL.md` | `Universal` |

Forks and private repositories are excluded automatically.

---

## 2. Scaling Discovery: Hourly Sharding, `per_page=100` & Skip Window (`N = 168`)

GitHub's Code Search API enforces two hard constraints:
- **1,000 results max per query** (`page * per_page <= 1000`).
- **10 Code Search requests/minute** and **1,000 REST requests/hour** for `GITHUB_TOKEN` in GitHub Actions.

To continuously discover thousands of unique repositories without hitting API limits or endlessly re-scraping the same top results, RuleIndex combines four mechanisms:

1. **Hourly Execution (`cron: '37 * * * *'`)**: Runs 24 times/day (168 times/week) at an off-peak minute (`:37`) to avoid top-of-hour GitHub Actions queue spikes, with a 45-minute job timeout.
2. **Rotating Language Shards (`LANGUAGE_SHARDS`, 12 shards)**:
   - Shards: `""` (general baseline), `typescript`, `python`, `javascript`, `rust`, `golang`, `java`, `csharp`, `cpp`, `ruby`, `php`, `swift`.
   - **Why content terms instead of `language:`?** In GitHub Code Search, `language:Python` filters by the *file's own language*. Because `AGENTS.md` and `CLAUDE.md` are Markdown files, `filename:AGENTS.md language:Python` returns zero matches. Appending the language ecosystem keyword (`filename:AGENTS.md python`) matches agent rule files that actually discuss Python tooling/conventions.
   - Each hourly run selects `LANGUAGE_SHARDS[(execution_count - 1) % 12]`, completing a full rotation across all 12 ecosystems every **12 hours** (2 full rotations per day).
3. **Max Page Size & Safe REST Budget**:
   - `DEFAULT_PER_PAGE = 100` and `max_pages = 10` allow each shard-target query to scan up to GitHub's 1,000-result ceiling.
   - `DEFAULT_MAX_REPOS_PER_TARGET = 25` caps newly fetched files at `9 × 25 = 225` per hourly run (~450 REST calls for file contents + star lookups, well under the 1,000 REST calls/hour ceiling).
   - Proactive `6.2s` spacing between `/search/code` requests respects the 10 req/min Code Search limit before triggering 403/429 backoff.
4. **Skip Recently Scraped Repos (`DEFAULT_SKIP_WITHIN_EXECUTIONS = 168`)**:
   - Every `live` run increments `execution_count` in SQLite and records `last_scraped_execution` on every fetched repository (even if a file yields 0 extractable rules, preventing wasted re-fetches of boilerplate files).
   - Repositories where `(current_execution - last_scraped_execution) < 168` are skipped *before* making any Contents or Repo API calls and do not count against `max_repos_per_target`.
   - **Why `N = 168`?** At hourly cadence, `168` executions equals **7 days** (**14 full 12-hour shard rotations**). During those 14 rotations, skipping already-seen repos pushes pagination deeper into pages `2..10` to uncover brand-new repositories rapidly; after 7 days, repos become eligible again so updated rules and star counts are refreshed weekly.

---

## 3. Rule Parsing & Noise Filtering (`scraper/parser.py`)

Raw agent files contain a mix of useful behavioral directives and repository-specific boilerplate. `extract_rules()` isolates atomic directives by:
1. Stripping YAML frontmatter (`--- ... ---`), HTML comments, and fenced code blocks (`` ```...``` ``).
2. Ignoring boilerplate sections such as `Directory Structure`, `Project Structure`, `Table of Contents`, and `License`.
3. Dropping ASCII directory trees (`├──`, `└──`), Markdown tables, bare URLs, shell command lines (`$ npm run ...`), lines shorter than 20 or longer than 280 characters, and lines dominated by project-specific file paths (e.g., `src/components/Foo.tsx`).
4. Splitting bullet items (`-`, `*`, `+`, `1.`) and dense paragraphs into individual candidate sentences.
5. Retaining only candidates containing imperative/behavioral cues (`always`, `never`, `do not`, `must`, `should`, `prefer`, `avoid`, `ensure`, `verify`, `test`, `commit`, etc.) and deduplicating identical directives per file.

---

## 4. English Language Normalization (`scraper/translator.py`)

To prevent mixed-language clutter in the database and UI, every candidate rule passes through `EnglishNormalizer`:
1. **Typography normalization**: Converts smart quotes and fullwidth CJK punctuation (`：；，。`) to clean ASCII.
2. **English detection (`is_english`)**:
   - Strips inline `` `code` `` spans so code identifiers don't skew detection.
   - Immediately flags non-Latin scripts (CJK, Hangul, Cyrillic, Arabic, Hebrew, Devanagari, Thai) as non-English.
   - Flags common non-English Latin-script stopwords (German, Portuguese, Spanish, French, Italian, Dutch).
   - Runs deterministic `langdetect` (`DetectorFactory.seed = 0`) on prose ≥ 24 characters.
3. **Cached Translation**:
   - Non-English rules are looked up in SQLite's `translation_cache`.
   - On cache miss, inline `` `code` `` spans are stashed behind `__CODE_i__` placeholders, the prose is translated via rate-limited `GoogleTranslator(source="auto", target="en")` (`0.25s` spacing), and code spans are restored.
   - A circuit breaker trips after 3 consecutive transient failures (e.g., HTTP 429) without poisoning `translation_cache` with `NULL`. Rules that cannot be normalized to English are excluded rather than inserted in a non-English language.

---

## 5. Semantic Embedding, Clustering & Canonicalization (`scraper/distiller.py`)

1. **Embeddings (`SemanticEmbedder`)**:
   - Primary backend (used in GitHub Actions): `sentence-transformers/all-MiniLM-L6-v2` producing L2-normalized 384-dimensional dense embeddings (`DEFAULT_SIMILARITY_THRESHOLD = 0.72`).
   - Lightweight fallback (when `sentence-transformers` is not installed locally): combined word (1–2 grams) + character (`char_wb` 3–5 grams) TF-IDF vectors with a calibrated threshold (`0.15`).
2. **Clustering (`cluster_embeddings`)**:
   - Uses `scikit-learn`'s `AgglomerativeClustering(n_clusters=None, metric="cosine", linkage="average", distance_threshold=1 - threshold)` (with a greedy centroid fallback if `scikit-learn` is absent).
3. **Medoid Selection & Optional LLM Canonicalization**:
   - For each cluster, the rule closest to the L2-normalized cluster centroid (the **medoid**) becomes the default canonical title and summary.
   - When `--llm-canonicalize` is enabled and `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` is set, the pipeline requests a crisp English canonical title, 1–2 sentence summary, and category from the configured LLM, falling back to the medoid on any error.
4. **Category Classification (`classify_category`)**:
   - Scores each cluster's text against keyword sets for the 7 categories (`Security & Secrets`, `Testing & Verification`, `Git & Workflow`, `Error Handling`, `Tooling & Dependencies`, `Communication & Planning`, `Code Style & Architecture`).

---

## 6. Ranking & Scoring Formulas

For each canonical rule cluster:
- **Adoption Count**: Count of unique repositories (`repo_full_name`) containing at least one rule in the cluster.
- **Star-Weighted Score**:
  $$\text{weighted\_score} = \sum_{r \in \text{repos}} \left(1 + \log_{10}(1 + \text{stars}_r)\right)$$
  Rounded to 1 decimal place. The logarithmic transform rewards adoption by high-star repositories (e.g., a 100k-star repo contributes `6.0` vs. `1.0` for a 0-star repo) without allowing a single repository to outweigh broad ecosystem adoption.
- **Examples**: Up to `5` distinct repositories per cluster, ordered by descending star count.
- **Timestamps**: `first_seen` is preserved across upserts (`min(existing, new)`), enabling the **Trending / Recent** leaderboard sort; `last_updated` reflects the most recent observation.
