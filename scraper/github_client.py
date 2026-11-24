"""GitHub Code Search API client with pagination and rate-limit backoff."""

from __future__ import annotations

import base64
import logging
import os
import time
from dataclasses import dataclass
from typing import Iterator

import requests

from config import TARGET_FILES, TargetFileSpec

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"


@dataclass
class ScrapedFile:
    """A single agent rule file discovered on GitHub."""

    repo_full_name: str
    repo_url: str
    stars: int
    file_path: str
    file_url: str
    agents: tuple[str, ...]
    content: str


class GitHubRuleScraper:
    """Scrapes public GitHub repositories for AI coding agent configuration files."""

    def __init__(
        self,
        token: str | None = None,
        per_page: int = 30,
        max_repos_per_target: int = 50,
        request_timeout: int = 20,
    ) -> None:
        self.token = token or os.getenv("GITHUB_TOKEN")
        self.per_page = min(max(per_page, 1), 100)
        self.max_repos_per_target = max_repos_per_target
        self.request_timeout = request_timeout
        self._repo_star_cache: dict[str, int] = {}

        self.session = requests.Session()
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "RuleIndex-Scraper/1.0 (+https://github.com/michaelmallo/rule-index)",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        self.session.headers.update(headers)

    def _request_with_backoff(
        self,
        url: str,
        params: dict[str, str | int] | None = None,
        max_retries: int = 5,
    ) -> requests.Response | None:
        """Issue a GET request with GitHub rate-limit awareness and exponential backoff."""
        for attempt in range(max_retries):
            try:
                resp = self.session.get(url, params=params, timeout=self.request_timeout)
            except requests.RequestException as exc:
                wait = min(2**attempt * 2, 60)
                logger.warning("Network error fetching %s: %s (retry in %ss)", url, exc, wait)
                time.sleep(wait)
                continue

            if resp.status_code == 200:
                # Respect proactive rate limit headers for code search (10 req/min)
                remaining = resp.headers.get("X-RateLimit-Remaining")
                if remaining is not None and int(remaining) <= 1:
                    reset_ts = int(resp.headers.get("X-RateLimit-Reset", time.time() + 10))
                    sleep_for = max(1, min(reset_ts - int(time.time()) + 1, 65))
                    logger.info("Rate limit nearly exhausted; sleeping %ss", sleep_for)
                    time.sleep(sleep_for)
                return resp

            if resp.status_code in (403, 429):
                retry_after = resp.headers.get("Retry-After")
                if retry_after:
                    wait = min(int(retry_after), 90)
                else:
                    reset_ts = resp.headers.get("X-RateLimit-Reset")
                    if reset_ts:
                        wait = max(2, min(int(reset_ts) - int(time.time()) + 2, 90))
                    else:
                        wait = min(2**attempt * 5, 90)
                logger.warning(
                    "GitHub rate limited (%s) on %s; backing off %ss",
                    resp.status_code,
                    url,
                    wait,
                )
                time.sleep(wait)
                continue

            if resp.status_code in (500, 502, 503, 504):
                wait = min(2**attempt * 3, 45)
                logger.warning("GitHub %s on %s; retrying in %ss", resp.status_code, url, wait)
                time.sleep(wait)
                continue

            if resp.status_code == 422:
                logger.warning("GitHub 422 validation error for %s params=%s", url, params)
                return None

            logger.error("Unexpected status %s for %s: %s", resp.status_code, url, resp.text[:200])
            return None

        logger.error("Exhausted retries for %s", url)
        return None

    def _get_repo_stars(self, repo_full_name: str) -> int:
        if repo_full_name in self._repo_star_cache:
            return self._repo_star_cache[repo_full_name]

        resp = self._request_with_backoff(f"{GITHUB_API_BASE}/repos/{repo_full_name}")
        if not resp:
            self._repo_star_cache[repo_full_name] = 0
            return 0

        stars = int(resp.json().get("stargazers_count", 0))
        self._repo_star_cache[repo_full_name] = stars
        return stars

    def _fetch_file_content(self, repo_full_name: str, file_path: str) -> str | None:
        resp = self._request_with_backoff(
            f"{GITHUB_API_BASE}/repos/{repo_full_name}/contents/{file_path}"
        )
        if not resp:
            return None

        data = resp.json()
        if isinstance(data, list):
            return None

        if data.get("encoding") == "base64" and data.get("content"):
            try:
                return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
            except Exception as exc:
                logger.warning("Failed decoding %s/%s: %s", repo_full_name, file_path, exc)
                return None

        download_url = data.get("download_url")
        if download_url:
            raw_resp = self._request_with_backoff(download_url)
            if raw_resp:
                return raw_resp.text
        return None

    def search_target(self, target: TargetFileSpec) -> Iterator[ScrapedFile]:
        """Yield scraped files for a single TargetFileSpec with pagination."""
        seen_repos: set[str] = set()
        fetched = 0

        for page in range(1, target.max_pages + 1):
            if fetched >= self.max_repos_per_target:
                break

            resp = self._request_with_backoff(
                f"{GITHUB_API_BASE}/search/code",
                params={
                    "q": target.query,
                    "per_page": self.per_page,
                    "page": page,
                },
            )
            if not resp:
                break

            items = resp.json().get("items", [])
            if not items:
                break

            for item in items:
                if fetched >= self.max_repos_per_target:
                    break

                repo = item.get("repository", {})
                if repo.get("private") or repo.get("fork"):
                    continue

                repo_full_name = repo.get("full_name")
                file_path = item.get("path")
                file_url = item.get("html_url")
                repo_url = repo.get("html_url") or f"https://github.com/{repo_full_name}"

                if not repo_full_name or not file_path:
                    continue

                dedup_key = f"{repo_full_name}:{file_path}"
                if dedup_key in seen_repos:
                    continue
                seen_repos.add(dedup_key)

                content = self._fetch_file_content(repo_full_name, file_path)
                if not content:
                    continue

                stars = self._get_repo_stars(repo_full_name)
                fetched += 1
                yield ScrapedFile(
                    repo_full_name=repo_full_name,
                    repo_url=repo_url,
                    stars=stars,
                    file_path=file_path,
                    file_url=file_url or f"{repo_url}/blob/HEAD/{file_path}",
                    agents=target.agents,
                    content=content,
                )

            # Respect GitHub Code Search secondary rate limit (gentle pause between pages)
            time.sleep(2.5)

    def scrape_all(
        self,
        targets: tuple[TargetFileSpec, ...] = TARGET_FILES,
    ) -> list[ScrapedFile]:
        """Run code search across all configured agent rule targets."""
        if not self.token:
            logger.warning(
                "GITHUB_TOKEN is not set. GitHub Code Search API requires authentication; "
                "live scraping may return 401/403."
            )

        collected: list[ScrapedFile] = []
        for target in targets:
            logger.info("Searching GitHub for %s (%s)", target.filename_label, target.query)
            count = 0
            for scraped in self.search_target(target):
                collected.append(scraped)
                count += 1
            logger.info("Collected %d files for %s", count, target.filename_label)
        return collected
