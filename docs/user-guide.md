# Web App User Guide

This guide covers every interactive feature available on the **RuleIndex** web application, whether you are exploring best practices for your first `AGENTS.md` file or auditing conventions across a specific AI coding tool.

---

## Table of Contents

- [Overview & Quick Start](../README.md) — High-level overview of RuleIndex and a quick guide to using the web application.
- **Web App User Guide** *(current page)* — Detailed walkthrough of searching, filtering, sorting, copying rules, inspecting real-world examples, sharing links, and customizing themes.
- [Architecture & Codebase Reference](architecture.md) — Complete repository layout, file-by-file breakdown, database schema, JSON dataset format, and frontend component overview.
- [Algorithms, Scraping & Configuration](algorithms-and-configuration.md) — Deep-dive into GitHub discovery, language sharding, revisit windows, rule parsing, English normalization, semantic clustering, and ranking math.
- [Development, Setup & Deployment](development-and-deployment.md) — Instructions for running the scraper and frontend locally, configuring GitHub Pages, managing optional API secrets, and maintaining the pipeline.

---

## Header & Summary Strip

At the top of the page you will find:
- **RuleIndex Title & Share Button**: Clicking the share icon directly to the right of the title opens the **Share RuleIndex** modal.
- **Theme Switcher** (top-right): Instantly switches between **Light** (default), **Dark**, **Solarized**, and **High-Contrast Terminal** modes.
- **Filters Button** (mobile/tablet only, directly below the title): Opens the slide-over filter drawer and shows a badge count whenever filters are active.
- **Dataset Summary Strip**: Displays four live metrics from the current dataset:
  - **Canonical Rules**: Total number of deduplicated English rules in the leaderboard.
  - **Repos Indexed**: Exact count of distinct GitHub repositories analyzed across runs.
  - **Agent Systems**: Number of supported AI coding agent ecosystems (`8`).
  - **Last Updated**: Exact UTC date and timestamp of the most recent dataset export.

---

## Searching, Filtering & Sorting

### Sorting Modes
Use the segmented sort bar above the leaderboard to reorder matching rules:
- **Most Repos**: Ranks rules by the number of unique repositories adopting them (tie-broken by star-weighted score).
- **Star-Weighted**: Ranks rules by a star-weighted adoption score that rewards adoption in popular repositories without letting a single mega-repo dominate.
- **Trending / Recent**: Surfaces the most recently discovered canonical rules first.

### Filtering Controls
On desktop, filters live in a sticky sidebar on the left; on mobile/tablet, tap **Filters** below the title to open the drawer:
- **Minimum Adoption**: Filter to `All rules`, `5+ repos`, `25+ repos`, or `100+ repos`.
- **Target Agent / System** (multi-select): Filter by one or more agent ecosystems (`Universal (AGENTS.md)`, `Claude`, `Cursor`, `Codex`, `Cline`, `Copilot`, `Windsurf`, `Gemini`). You can also click any agent badge directly on a rule card to toggle that filter.
- **Rule Category** (multi-select): Narrow results to any combination of the 7 categories (`Code Style & Architecture`, `Testing & Verification`, `Git & Workflow`, `Security & Secrets`, `Tooling & Dependencies`, `Communication & Planning`, `Error Handling`).
- **Instant Keyword Search**: Matches across canonical rule titles, summaries, categories, agent names, verbatim example text, and source repository names.

Active filters appear as removable pills above the leaderboard alongside a live result count (`Showing X of Y distilled rules`) and a one-click **Reset Filters** button.

---

## Ranked Rules Scrollbox

The ranked leaderboard is rendered inside a dedicated scrollable container sized to fit your viewport height or display at least 10 full rules (whichever is larger). You can scroll smoothly through the entire ranked list while subtle edge shadows indicate when more rules are available above or below.

Each rule card displays:
- **Rank `#`** (top 3 highlighted)
- **Category badge**, **Repo count**, and **Star-weighted score**
- **Canonical Rule title** and **summary**
- **Target Agent badges** (clickable to filter)
- **Copy Rule** button: Copies `- **<Title>**: <Summary>` to your clipboard with a non-intrusive toast confirmation.
- **Examples (N)** button: Opens the rule detail modal.

---

## Real-World Examples Modal

Clicking **Examples** on any rule opens a modal dialog containing:
- The rule's rank, category, full summary, repo adoption count, star-weighted score, and first-seen date.
- A **Copy Markdown Rule** button.
- Every target agent where the rule was observed.
- Up to **5 real-world verbatim examples** from public repositories, each with a direct link to the source file on GitHub, the agent type, and the repository's star count.

Dismiss the modal by clicking the close button, pressing `Esc`, or clicking outside the modal.

---

## Sharing Links & Persistent Preferences

### Sharing
Clicking the **Share** button next to the `RuleIndex` title opens the **Share RuleIndex** modal:
- **Shareable Link**: Copy the URL with one click. If you currently have search terms, filters, or a custom sort order active, check **Include active filters** to embed them as URL query parameters (`q`, `agents`, `categories`, `min`, `sort`) so recipients land on the exact same view.
- **Social, Email & Text**: Launch pre-filled share intents for **X (Twitter)**, **LinkedIn**, **Reddit**, **Hacker News**, **Bluesky**, **WhatsApp**, **Telegram**, **Email**, **Text / SMS**, or your device's native share sheet (when supported).

### Automatic Persistence
Your selected **theme**, **active filters**, and **sort order** are automatically saved in `localStorage` and synchronized across open browser tabs, so your preferred view restores on your next visit.
