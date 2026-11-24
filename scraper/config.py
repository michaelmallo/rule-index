"""Configuration constants for the RuleIndex scraper and distillation pipeline."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
DEFAULT_DB_PATH = DATA_DIR / "rules.db"
DEFAULT_DATA_JSON_PATH = DATA_DIR / "rules.json"
DEFAULT_WEB_JSON_PATH = ROOT_DIR / "web" / "public" / "data" / "rules.json"

ALL_AGENTS = [
    "Universal",
    "Claude",
    "Cursor",
    "Codex",
    "Cline",
    "Copilot",
    "Windsurf",
    "Gemini",
]

ALL_CATEGORIES = [
    "Code Style & Architecture",
    "Testing & Verification",
    "Git & Workflow",
    "Security & Secrets",
    "Tooling & Dependencies",
    "Communication & Planning",
    "Error Handling",
]


@dataclass(frozen=True)
class TargetFileSpec:
    """Specification for a GitHub Code Search target file."""

    query: str
    filename_label: str
    agents: tuple[str, ...]
    max_pages: int = 3


TARGET_FILES: tuple[TargetFileSpec, ...] = (
    TargetFileSpec(
        query="filename:AGENTS.md",
        filename_label="AGENTS.md",
        agents=("Universal", "Codex"),
    ),
    TargetFileSpec(
        query="filename:CLAUDE.md",
        filename_label="CLAUDE.md",
        agents=("Claude",),
    ),
    TargetFileSpec(
        query="filename:.cursorrules",
        filename_label=".cursorrules",
        agents=("Cursor",),
    ),
    TargetFileSpec(
        query="path:.cursor/rules extension:mdc",
        filename_label=".cursor/rules/*.mdc",
        agents=("Cursor",),
    ),
    TargetFileSpec(
        query="filename:.windsurfrules",
        filename_label=".windsurfrules",
        agents=("Windsurf",),
    ),
    TargetFileSpec(
        query="filename:.clinerules",
        filename_label=".clinerules",
        agents=("Cline",),
    ),
    TargetFileSpec(
        query="path:.github filename:copilot-instructions.md",
        filename_label=".github/copilot-instructions.md",
        agents=("Copilot",),
    ),
    TargetFileSpec(
        query="filename:GEMINI.md",
        filename_label="GEMINI.md",
        agents=("Gemini",),
    ),
    TargetFileSpec(
        query="filename:SKILL.md",
        filename_label="SKILL.md",
        agents=("Universal",),
    ),
)

CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "Security & Secrets": (
        "secret",
        "api key",
        "apikey",
        "credential",
        "token",
        "password",
        ".env",
        "hardcode",
        "sanitize",
        "xss",
        "sql injection",
        "csrf",
        "auth",
        "vulnerability",
        "encrypt",
        "pii",
        "permission",
        "least privilege",
        "input validation",
    ),
    "Testing & Verification": (
        "test",
        "unit test",
        "integration test",
        "e2e",
        "pytest",
        "jest",
        "vitest",
        "lint",
        "typecheck",
        "type-check",
        "verify",
        "ci",
        "coverage",
        "regression",
        "mock",
        "assert",
        "build passes",
        "green build",
    ),
    "Git & Workflow": (
        "commit",
        "branch",
        "pull request",
        "pr ",
        "merge",
        "rebase",
        "force push",
        "git ",
        "conventional commit",
        "atomic commit",
        "diff",
        "stash",
        "changelog",
        "feature branch",
        "main branch",
    ),
    "Error Handling": (
        "error",
        "exception",
        "try/catch",
        "try-catch",
        "swallow",
        "fallback",
        "retry",
        "timeout",
        "fail fast",
        "stack trace",
        "graceful",
        "edge case",
        "null",
        "undefined",
        "logging",
        "log ",
    ),
    "Tooling & Dependencies": (
        "dependency",
        "dependencies",
        "package",
        "npm",
        "pnpm",
        "yarn",
        "pip",
        "uv ",
        "poetry",
        "lockfile",
        "docker",
        "version",
        "library",
        "install",
        "cli",
        "formatter",
        "prettier",
        "eslint",
        "ruff",
    ),
    "Communication & Planning": (
        "plan",
        "ask",
        "clarify",
        "explain",
        "concise",
        "assumption",
        "step-by-step",
        "summarize",
        "confirm",
        "before editing",
        "read before",
        "understand",
        "discuss",
        "ambiguity",
        "scope",
        "minimal change",
    ),
    "Code Style & Architecture": (
        "type",
        "typescript",
        "strict",
        "function",
        "module",
        "component",
        "refactor",
        "clean",
        "naming",
        "comment",
        "docstring",
        "immutab",
        "pure",
        "modular",
        "solid",
        "dry",
        "readab",
        "convention",
        "pattern",
        "import",
        "architecture",
    ),
}

DEFAULT_EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
DEFAULT_SIMILARITY_THRESHOLD = 0.72
MAX_EXAMPLES_PER_RULE = 5
