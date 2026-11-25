# RuleIndex

**RuleIndex** is a continuously updated, open-source leaderboard of the most widely adopted AI coding agent rules across public GitHub repositories.

Software teams increasingly configure AI coding assistants using instruction files such as `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `GEMINI.md`, `SKILL.md`, and GitHub Copilot instructions. Because hundreds of repositories express the same engineering standards in slightly different words (for example, *"Never commit secrets"* vs. *"Do not hardcode API keys"*), RuleIndex automatically collects public rule files every hour, normalizes them to English, groups semantically equivalent rules together, and ranks them by real-world adoption.

---

## Table of Contents

- **Overview & Quick Start** *(current page)* — High-level overview of RuleIndex and a quick guide to using the web application.
- [Web App User Guide](docs/user-guide.md) — Detailed walkthrough of searching, filtering, sorting, copying rules, inspecting real-world examples, sharing links, and customizing themes.
- [Architecture & Codebase Reference](docs/architecture.md) — Complete repository layout, file-by-file breakdown, database schema, JSON dataset format, and frontend component overview.
- [Algorithms, Scraping & Configuration](docs/algorithms-and-configuration.md) — Deep-dive into GitHub discovery, language sharding, revisit windows, rule parsing, English normalization, semantic clustering, and ranking math.
- [Development, Setup & Deployment](docs/development-and-deployment.md) — Instructions for running the scraper and frontend locally, configuring GitHub Pages, managing optional API secrets, and maintaining the pipeline.

---

## What RuleIndex Does

- **Discovers real-world agent instructions** across 8 major AI coding agent ecosystems (`Universal / AGENTS.md`, `Claude`, `Cursor`, `Codex`, `Cline`, `Copilot`, `Windsurf`, and `Gemini`).
- **Eliminates duplicate wording** by clustering semantically equivalent rules into a single canonical directive while preserving real-world phrasing examples and direct links to source repositories.
- **Normalizes all rules to English** so the leaderboard stays clean, searchable, and consistent.
- **Ranks rules transparently** by repository adoption count, star-weighted score, and recency, updating automatically on an hourly schedule.

---

## Quick How-To for Visitors

1. **Browse & Sort the Leaderboard**: Open the [RuleIndex web page](https://michaelmallo.github.io/rule-index/) to view ranked rules inside the scrollable leaderboard. Switch between **Most Repos**, **Star-Weighted**, and **Trending / Recent** using the sort bar above the list.
2. **Search & Filter**:
   - Type any keyword (such as `secrets`, `TypeScript`, or `pytest`) into the search bar for instant filtering.
   - Use the **Filters** sidebar (or tap **Filters** below the title on mobile) to narrow results by **Minimum Adoption** (`5+`, `25+`, `100+` repos), **Target Agent / System**, or **Rule Category**.
   - Click any active filter pill to remove it, or click **Reset Filters** to clear all filters at once.
3. **Copy a Rule**: Click **Copy Rule** on any card to copy a clean Markdown bullet directive directly to your clipboard, ready to paste into your own `AGENTS.md`, `CLAUDE.md`, or `.cursorrules` file.
4. **Inspect Real-World Examples**: Click **Examples** on a rule card to open a modal showing verbatim phrasing variations from public repositories along with direct links to the source files on GitHub.
5. **Share & Personalize**:
   - Click the **Share** icon next to the `RuleIndex` title to copy a shareable link (optionally preserving your active filters) or share via social media, email, or messaging apps.
   - Use the theme switcher in the top-right corner to toggle between **Light**, **Dark**, **Solarized**, and **High-Contrast Terminal** themes. Your theme, filters, and sort order are saved automatically in your browser.
