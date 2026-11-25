"""CLI entrypoint for the RuleIndex scraper and semantic distillation pipeline."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from config import (
    DEFAULT_DATA_JSON_PATH,
    DEFAULT_DB_PATH,
    DEFAULT_MAX_REPOS_PER_TARGET,
    DEFAULT_PER_PAGE,
    DEFAULT_SIMILARITY_THRESHOLD,
    DEFAULT_SKIP_WITHIN_EXECUTIONS,
    DEFAULT_WEB_JSON_PATH,
    LANGUAGE_SHARDS,
)
from database import RuleDatabase
from distiller import RawRuleObservation, SemanticEmbedder, distill_observations
from github_client import GitHubRuleScraper, ScrapedFile
from parser import extract_rules
from seed_data import SAMPLE_SCRAPED_FILES, build_seed_rules
from translator import EnglishNormalizer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("rule-index.scraper")


def files_to_observations(
    files: list[ScrapedFile],
    normalizer: EnglishNormalizer | None = None,
) -> list[RawRuleObservation]:
    """Parse scraped agent files into English-normalized raw rule observations."""
    observations: list[RawRuleObservation] = []
    for scraped in files:
        extracted = extract_rules(scraped.content, normalizer=normalizer)
        for text in extracted:
            observations.append(
                RawRuleObservation(
                    text=text,
                    repo_full_name=scraped.repo_full_name,
                    repo_url=scraped.repo_url,
                    stars=scraped.stars,
                    file_path=scraped.file_path,
                    file_url=scraped.file_url,
                    agents=scraped.agents,
                )
            )
    return observations


def run_pipeline(
    mode: str,
    db_path: Path,
    json_outputs: list[Path],
    max_repos_per_target: int = DEFAULT_MAX_REPOS_PER_TARGET,
    per_page: int = DEFAULT_PER_PAGE,
    skip_within_executions: int = DEFAULT_SKIP_WITHIN_EXECUTIONS,
    language_shard: str | None = None,
    similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
    use_llm: bool = False,
) -> dict:
    """Execute the requested scraper/distillation mode and export JSON."""
    with RuleDatabase(db_path) as db:
        normalizer = EnglishNormalizer(conn=db.conn)
        try:
            if mode == "seed":
                seed_rules = build_seed_rules()
                logger.info("Seeding database with %d canonical rules...", len(seed_rules))
                db.upsert_canonical_rules(seed_rules)
            elif mode == "normalize":
                logger.info("Normalizing all existing database records to English...")
                norm_stats = db.normalize_existing_records(normalizer)
                logger.info("English normalization complete: %s", norm_stats)
            elif mode == "sample":
                logger.info(
                    "Running end-to-end pipeline on %d sample agent files...",
                    len(SAMPLE_SCRAPED_FILES),
                )
                observations = files_to_observations(SAMPLE_SCRAPED_FILES, normalizer=normalizer)
                logger.info("Extracted %d English-normalized rule directives.", len(observations))
                inserted = db.upsert_observations(observations)
                logger.info("Stored %d new raw rule observations in SQLite.", inserted)

                embedder = SemanticEmbedder()
                canonical = distill_observations(
                    observations,
                    similarity_threshold=similarity_threshold,
                    use_llm=use_llm,
                    embedder=embedder,
                )
                logger.info(
                    "Distilled %d observations into %d canonical clusters (backend=%s).",
                    len(observations),
                    len(canonical),
                    embedder.backend,
                )
                db.upsert_canonical_rules(canonical)
            elif mode == "live":
                # Ensure seed baseline exists on first run if database is empty
                if not db.fetch_canonical_rules():
                    logger.info("Empty database detected; initializing with seed dataset first.")
                    db.upsert_canonical_rules(build_seed_rules())

                # Ensure any historical non-English rows are normalized to English
                norm_stats = db.normalize_existing_records(normalizer)
                if any(norm_stats.values()):
                    logger.info("Normalized existing non-English records: %s", norm_stats)

                execution_num = db.increment_execution_count()
                selected_shard = (
                    language_shard
                    if language_shard is not None
                    else LANGUAGE_SHARDS[(execution_num - 1) % len(LANGUAGE_SHARDS)]
                )
                skip_repos = db.get_recently_scraped_repos(
                    current_execution=execution_num,
                    skip_within_executions=skip_within_executions,
                )
                star_cache = db.get_cached_repo_stars()

                logger.info(
                    "Starting live execution #%d (shard=%s, per_page=%d, max_per_target=%d, skipping %d repos scraped within last %d runs)",
                    execution_num,
                    selected_shard or "general",
                    per_page,
                    max_repos_per_target,
                    len(skip_repos),
                    skip_within_executions,
                )

                scraper = GitHubRuleScraper(
                    per_page=per_page,
                    max_repos_per_target=max_repos_per_target,
                    skip_repos=skip_repos,
                    initial_star_cache=star_cache,
                )
                scraped_files = scraper.scrape_all(language_shard=selected_shard)
                logger.info("Scraped %d files from GitHub.", len(scraped_files))

                if scraped_files:
                    # Mark all fetched repos as scraped in this execution so boilerplate-only
                    # repos aren't repeatedly re-fetched during the skip window.
                    db.mark_repos_scraped(
                        ((f.repo_full_name, f.repo_url, f.stars) for f in scraped_files),
                        execution_number=execution_num,
                    )

                    observations = files_to_observations(scraped_files, normalizer=normalizer)
                    inserted = db.upsert_observations(
                        observations,
                        execution_number=execution_num,
                    )
                    logger.info(
                        "Extracted %d English-normalized directives (%d newly stored).",
                        len(observations),
                        inserted,
                    )

                    all_observations = db.load_all_observations()
                    embedder = SemanticEmbedder()
                    canonical = distill_observations(
                        all_observations,
                        similarity_threshold=similarity_threshold,
                        use_llm=use_llm,
                        embedder=embedder,
                    )
                    logger.info(
                        "Distilled %d total observations into %d canonical rules (backend=%s).",
                        len(all_observations),
                        len(canonical),
                        embedder.backend,
                    )
                    db.upsert_canonical_rules(canonical)
                else:
                    logger.warning("No files scraped in live mode; keeping existing database rules.")
            else:
                raise ValueError(f"Unsupported mode: {mode}")

            payload = db.export_json(json_outputs)
            logger.info(
                "Exported %d canonical rules to: %s",
                payload["stats"]["total_rules"],
                ", ".join(str(p) for p in json_outputs),
            )
            return payload
        finally:
            normalizer.close()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="RuleIndex GitHub scraper and semantic rule distillation pipeline."
    )
    parser.add_argument(
        "--mode",
        choices=("live", "seed", "sample", "normalize"),
        default="live",
        help="Pipeline mode: 'live' scrapes GitHub API, 'seed' loads seed data, 'sample' runs ETL on built-in sample files, 'normalize' normalizes existing DB records to English.",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"Path to SQLite database (default: {DEFAULT_DB_PATH})",
    )
    parser.add_argument(
        "--json-out",
        type=Path,
        action="append",
        dest="json_outputs",
        help="Output JSON path (can be specified multiple times).",
    )
    parser.add_argument(
        "--max-repos-per-target",
        type=int,
        default=DEFAULT_MAX_REPOS_PER_TARGET,
        help=f"Maximum newly fetched repositories per target filename in live mode (default: {DEFAULT_MAX_REPOS_PER_TARGET}).",
    )
    parser.add_argument(
        "--per-page",
        type=int,
        default=DEFAULT_PER_PAGE,
        help=f"GitHub Code Search results per page, up to 100 (default: {DEFAULT_PER_PAGE}).",
    )
    parser.add_argument(
        "--skip-within-executions",
        type=int,
        default=DEFAULT_SKIP_WITHIN_EXECUTIONS,
        help=f"Skip repositories already scraped within the last N executions (default: {DEFAULT_SKIP_WITHIN_EXECUTIONS}).",
    )
    parser.add_argument(
        "--language-shard",
        type=str,
        default=None,
        help="Optional explicit language shard override (defaults to rotating through LANGUAGE_SHARDS each execution).",
    )
    parser.add_argument(
        "--similarity-threshold",
        type=float,
        default=DEFAULT_SIMILARITY_THRESHOLD,
        help="Cosine similarity threshold for semantic clustering (0.0-1.0).",
    )
    parser.add_argument(
        "--llm-canonicalize",
        action="store_true",
        help="Use GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY if set to refine cluster titles.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    json_outputs = args.json_outputs or [DEFAULT_DATA_JSON_PATH, DEFAULT_WEB_JSON_PATH]
    run_pipeline(
        mode=args.mode,
        db_path=args.db,
        json_outputs=json_outputs,
        max_repos_per_target=args.max_repos_per_target,
        per_page=args.per_page,
        skip_within_executions=args.skip_within_executions,
        language_shard=args.language_shard,
        similarity_threshold=args.similarity_threshold,
        use_llm=args.llm_canonicalize,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
