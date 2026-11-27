# AGENTS.md

Authoritative engineering rules and behavioral guidelines for AI coding agents contributing to the **RuleIndex** repository. Follow these standards for code quality, testing, version control, security, dependency management, communication, and error handling across all tasks in this project.

---

## Code Style & Architecture

- **Keep changes minimal, focused, and strictly scoped to the request.** Avoid unrelated refactoring, formatting churn, or speculative abstractions outside the task boundary.
- **Use strict static typing and avoid `any` or unsafe type casts.** Preserve TypeScript `strict: true` in `web/` (use `unknown` with narrowing rather than `any` or `@ts-ignore`) and include complete type annotations in `scraper/`.
- **Keep functions small, focused, and easy to reason about.** Favor early returns and cohesive single-responsibility helpers over deeply nested conditionals.
- **Write comments explaining *why*, not restating *what* the code does.** Reserve comments for non-obvious invariants, API constraints (such as GitHub Code Search rate limits), and trade-offs.
- **Use semantic HTML, keyboard navigation, and WCAG-compliant contrast.** Prefer native `<button>`, `<dialog>`, and `popover` elements with accessible names and visible focus rings across all four themes.
- **Prefer immutable updates over mutating shared state in place.** Never mutate React state or function arguments directly; return new objects or arrays.
- **Use Tailwind CSS utilities over custom CSS for simple styling.** Reserve `web/src/styles/themes.css` for theme custom properties, native `<dialog>`/`[popover]` states, and Markdown help prose.
- **Use English for all code, rules, and documentation.** Ensure scraped/indexed rules remain normalized to English.

## Testing & Verification

- **Run tests, linter, and type-checker before marking a task complete.**
  - Frontend / docs changes: run `cd web && npm run build` (`tsc -b && vite build`) and confirm zero errors (note that `README.md` and `docs/*.md` are bundled into the in-app Help system).
  - Scraper changes: run `python scraper/run.py --mode sample --db sample.tmp.db --json-out sample.tmp.json` (and remove temp files afterward) to verify parsing, English normalization, clustering, and JSON export end-to-end.
- **Write unit and regression tests for every new feature and bug fix.** Follow the Arrange-Act-Assert pattern and use `pytest` when adding Python tests.
- **Maintain strong test coverage across happy paths, failure paths, and edge cases.** Never skip, delete, or weaken checks to force a passing build.
- **Update documentation when adding or changing features.** Keep `README.md` and `docs/` in sync with code changes.
- **Read `AGENTS.md` first; treat it as authoritative** for repository conventions.

## Git & Workflow

- **Write concise, atomic commits following Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `style:`, `revert:`).
- **Never force-push, rewrite shared history, or run destructive git commands** (`git reset --hard`, `git push --force`) without explicit user confirmation. Always work on a feature branch rather than pushing directly to `main`.
- **Inspect the full `git diff` / `git diff --staged` before committing or opening a PR.** Strip debug logs and temporary artifacts (`*.tmp.db`, `*.tmp.json`) before staging.
- **Document breaking changes** clearly in commit messages and pull request descriptions.

## Security & Secrets

- **Never commit secrets, API keys, tokens, or credentials to version control.** Keep `GITHUB_TOKEN`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY` strictly in environment variables or GitHub Actions Secrets.
- **Validate and sanitize all external inputs at system boundaries.** Validate URL query parameters in `web/src/App.tsx`, untrusted GitHub API responses in `scraper/github_client.py`, and scraped Markdown content in `scraper/parser.py`.
- **Never log PII, session tokens, or raw credentials** in scraper logs or error messages.
- **Avoid magic numbers and define named constants** in `scraper/config.py` and `web/src/types.ts`.
- **Require explicit user confirmation before irreversible data or infrastructure deletions** (such as wiping `data/rules.db` or dropping tables).

## Tooling & Dependencies

- **Do not add new third-party dependencies without justification or approval.** Prefer Python/Web standard library APIs and existing workspace packages first.
- **Use the repository's configured package manager and virtual environment.** Use `scraper/.venv` with `scraper/requirements.txt` for Python (never global `pip install`) and `npm` with `web/package-lock.json` for the frontend.
- **Pin GitHub Actions versions and runtime versions** in `.github/workflows/update-and-deploy.yml` for reproducible CI builds.
- **Load specialized `SKILL.md` workflows before improvising domain tasks** when an applicable skill is available.

## Communication & Planning

- **Read and understand existing code and conventions before editing.** Inspect adjacent modules and configuration before introducing changes.
- **Clarify ambiguous requirements instead of making silent assumptions.** Call out meaningful trade-offs concisely before implementing.
- **Never fabricate file paths, APIs, or symbol names without verifying** they exist in the repository or official documentation.
- **Update `README.md` and `docs/` whenever public APIs, CLI flags, or user-facing behavior change.**
- **Be concise in explanations** — focus on decisions, trade-offs, and verification rather than narrating obvious details.
- **Batch independent file reads and searches in parallel** to reduce round-trip latency.

## Error Handling

- **Never silently swallow exceptions; handle or propagate errors explicitly.** Avoid empty `except:` or `catch {}` blocks without a clear, documented fallback.
- **Always configure timeouts, retries, and backoff on external I/O.** Enforce request timeouts, rate-limit pacing, and exponential backoff on GitHub API, translation, and optional LLM HTTP requests.
- **Fail fast at startup when required configuration or environment variables are missing or invalid.**
- **Use clear verb-prefixed names for boolean variables and flags** (e.g., `isCopied`, `hasActiveFilters`, `use_llm`).
