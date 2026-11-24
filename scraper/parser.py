"""Parse agent rule markdown files into discrete, atomic behavioral directives."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from translator import is_english, normalize_typography

if TYPE_CHECKING:
    from translator import EnglishNormalizer

# Patterns to strip before extracting directives
FRONTMATTER_RE = re.compile(r"\A---\s*\n.*?\n---\s*\n", re.DOTALL)
FENCED_CODE_RE = re.compile(r"```.*?```", re.DOTALL)
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
TREE_LINE_RE = re.compile(r"[├└│─]{2,}")
MARKDOWN_TABLE_RE = re.compile(r"^\s*\|.*\|\s*$")
HEADING_RE = re.compile(r"^\s*#{1,6}\s+")
BULLET_RE = re.compile(r"^\s*(?:[-*+•]|\d+[.)])\s+(.*)")
LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
BARE_URL_RE = re.compile(r"https?://\S+")
PROJECT_PATH_RE = re.compile(
    r"(?:^|\s)(?:\./|\../|/)?(?:src|app|lib|pkg|cmd|internal|packages|apps|components|pages|routes|api|config|scripts|tests?)/[\w./-]+"
)

# Behavioral directive cue words that distinguish real rules from descriptions
DIRECTIVE_CUES = (
    "always",
    "never",
    "do not",
    "don't",
    "dont",
    "must",
    "should",
    "prefer",
    "avoid",
    "ensure",
    "use ",
    "run ",
    "write ",
    "keep ",
    "verify",
    "check ",
    "test ",
    "commit",
    "follow ",
    "maintain",
    "handle ",
    "validate",
    "sanitize",
    "ask ",
    "explain",
    "plan ",
    "read ",
    "limit ",
    "minimize",
    "require",
    "enforce",
    "document",
    "refactor",
    "split ",
    "separate",
    "return ",
    "throw ",
    "catch ",
    "log ",
    "format ",
    "lint ",
    "typecheck",
    "preserve",
    "respect",
    "favor",
    "stick to",
    "make sure",
    "be sure",
    "no ",
)

# Boilerplate headings whose immediate prose is usually repo description, not rules
IGNORED_SECTION_KEYWORDS = (
    "directory structure",
    "folder structure",
    "project structure",
    "file structure",
    "repo layout",
    "repository layout",
    "table of contents",
    "license",
    "acknowledgments",
    "contributors",
)


def _clean_markdown(text: str) -> str:
    """Normalize markdown emphasis, links, and whitespace into clean plain text."""
    text = LINK_RE.sub(r"\1", text)
    text = BARE_URL_RE.sub("", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"__([^_]+)__", r"\1", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"`\1`", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text.rstrip(" ;")


def _is_noise(text: str) -> bool:
    """Return True if a candidate line is boilerplate, too short/long, or repo-specific."""
    if len(text) < 20 or len(text) > 280:
        return True
    if TREE_LINE_RE.search(text):
        return True
    if MARKDOWN_TABLE_RE.match(text):
        return True
    # Drop lines dominated by project-specific file paths
    path_matches = PROJECT_PATH_RE.findall(text)
    if len(path_matches) >= 2:
        return True
    if path_matches and len(text) < 60:
        return True
    # Drop shell command invocations like "$ npm run dev"
    if text.startswith(("$ ", "> ", "npm ", "pnpm ", "yarn ", "pip ", "uv ", "python ", "git ")):
        return True
    # Must contain alphabetic characters
    alpha_count = sum(1 for ch in text if ch.isalpha())
    if alpha_count < 15:
        return True
    return False


def _has_directive_intent(text: str) -> bool:
    """Check whether the text expresses a reusable behavioral instruction."""
    lower = text.lower()
    return any(cue in lower for cue in DIRECTIVE_CUES)


def extract_rules(
    markdown_content: str,
    normalizer: EnglishNormalizer | None = None,
) -> list[str]:
    """Split a markdown/rule document into clean, discrete English behavioral directives."""
    if not markdown_content or not markdown_content.strip():
        return []

    cleaned = FRONTMATTER_RE.sub("", markdown_content)
    cleaned = HTML_COMMENT_RE.sub("", cleaned)
    cleaned = FENCED_CODE_RE.sub("\n", cleaned)

    rules: list[str] = []
    seen_normalized: set[str] = set()
    in_ignored_section = False

    for raw_line in cleaned.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        if HEADING_RE.match(line):
            heading_text = HEADING_RE.sub("", line).strip().lower()
            in_ignored_section = any(k in heading_text for k in IGNORED_SECTION_KEYWORDS)
            continue

        if in_ignored_section:
            continue

        if TREE_LINE_RE.search(line) or MARKDOWN_TABLE_RE.match(line):
            continue

        bullet_match = BULLET_RE.match(line)
        candidates: list[str] = []
        if bullet_match:
            candidates.append(bullet_match.group(1))
        else:
            # Split dense paragraphs into individual sentences
            sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z])", line)
            candidates.extend(sentences)

        for candidate in candidates:
            normalized = normalize_typography(_clean_markdown(candidate))
            if _is_noise(normalized):
                continue

            # Normalize non-English candidates to English before checking directive cues
            if not is_english(normalized):
                if normalizer is None:
                    continue
                translated = normalizer.normalize(normalized)
                if not translated or _is_noise(translated):
                    continue
                normalized = translated

            if not _has_directive_intent(normalized):
                continue

            # Ensure clean sentence capitalization and terminal punctuation
            if normalized and normalized[0].islower():
                normalized = normalized[0].upper() + normalized[1:]
            if normalized and normalized[-1] not in ".!?":
                normalized += "."

            dedup_key = re.sub(r"[^a-z0-9]+", " ", normalized.lower()).strip()
            if dedup_key not in seen_normalized:
                seen_normalized.add(dedup_key)
                rules.append(normalized)

    return rules
