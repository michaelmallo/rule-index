"""Zero-dependency HTTP server exposing the RuleIndex RESTful API."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from service import (
    APIValidationError,
    DEFAULT_DB_PATH,
    DEFAULT_WEB_BASE_URL,
    RuleIndexService,
    build_openapi_spec,
    parse_bool_param,
    parse_int_param,
    validate_rule_query,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("rule-index.api")

MAX_REQUEST_BODY_BYTES = 1_048_576  # 1 MiB


class RuleIndexHTTPServer(ThreadingHTTPServer):
    """ThreadingHTTPServer carrying a shared RuleIndexService instance."""

    allow_reuse_address = True

    def __init__(
        self,
        server_address: tuple[str, int],
        service: RuleIndexService,
    ) -> None:
        self.service = service
        super().__init__(server_address, RuleIndexRequestHandler)


class RuleIndexRequestHandler(BaseHTTPRequestHandler):
    """RESTful HTTP request handler for `/api/v1/*` endpoints."""

    server: RuleIndexHTTPServer  # type: ignore[assignment]

    def log_message(self, format: str, *args: object) -> None:
        logger.info("%s - %s", self.address_string(), format % args)

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")

    def _send_json(self, payload: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_markdown(self, markdown: str, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = markdown.encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "text/markdown; charset=utf-8")
        self.send_header("Content-Disposition", 'inline; filename="AGENTS.md"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status: HTTPStatus, message: str) -> None:
        self._send_json({"error": status.phrase, "status": int(status), "message": message}, status)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        params = parse_qs(parsed.query, keep_blank_values=False)

        try:
            if path in ("/", "/api/v1", "/api/v1/health"):
                stats = self.server.service.get_stats()
                self._send_json(
                    {
                        "status": "ok",
                        "service": "RuleIndex REST API",
                        "version": "1.0.0",
                        "generated_at": stats["generated_at"],
                        "total_rules": stats["total_rules"],
                    }
                )
                return

            if path == "/api/v1/openapi.json":
                host = self.headers.get("Host") or f"localhost:{self.server.server_port}"
                self._send_json(build_openapi_spec(server_url=f"http://{host}"))
                return

            if path == "/api/v1/stats":
                self._send_json(self.server.service.get_stats())
                return

            if path == "/api/v1/categories":
                self._send_json({"categories": self.server.service.get_categories()})
                return

            if path == "/api/v1/agents":
                self._send_json({"agents": self.server.service.get_agents()})
                return

            if path == "/api/v1/rules":
                query = validate_rule_query(params)
                self._send_json(self.server.service.query_rules(query))
                return

            if path.startswith("/api/v1/rules/"):
                rule_id = unquote(path[len("/api/v1/rules/") :]).strip()
                if not rule_id or "/" in rule_id:
                    self._send_error_json(HTTPStatus.NOT_FOUND, "Rule not found.")
                    return
                rule = self.server.service.get_rule_by_id(rule_id)
                if rule is None:
                    self._send_error_json(HTTPStatus.NOT_FOUND, f"Rule '{rule_id}' not found.")
                    return
                self._send_json(rule)
                return

            if path == "/api/v1/rules-file":
                self._handle_rules_file_get(params)
                return

            if path == "/api/v1/page-url":
                self._handle_page_url(params)
                return

            self._send_error_json(HTTPStatus.NOT_FOUND, f"Unknown endpoint '{path}'.")
        except APIValidationError as exc:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
        except FileNotFoundError as exc:
            self._send_error_json(HTTPStatus.SERVICE_UNAVAILABLE, str(exc))
        except Exception as exc:
            logger.exception("Unhandled error serving GET %s", path)
            self._send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, f"Internal error: {exc}")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path != "/api/v1/rules-file":
            self._send_error_json(
                HTTPStatus.METHOD_NOT_ALLOWED,
                f"POST is only supported on /api/v1/rules-file (got '{path}').",
            )
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_error_json(HTTPStatus.BAD_REQUEST, "Invalid Content-Length header.")
            return

        if content_length < 0 or content_length > MAX_REQUEST_BODY_BYTES:
            self._send_error_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                f"Request body must not exceed {MAX_REQUEST_BODY_BYTES} bytes.",
            )
            return

        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._send_error_json(HTTPStatus.BAD_REQUEST, f"Invalid JSON body: {exc}")
            return

        if not isinstance(payload, dict):
            self._send_error_json(HTTPStatus.BAD_REQUEST, "Request body must be a JSON object.")
            return

        try:
            rule_ids = payload.get("rule_ids")
            if rule_ids is not None and not isinstance(rule_ids, list):
                raise APIValidationError("'rule_ids' must be a JSON array of rule ID strings.")

            categories = payload.get("categories")
            if categories is not None and not isinstance(categories, list):
                raise APIValidationError("'categories' must be a JSON array of category strings.")

            agents = payload.get("agents")
            if agents is not None and not isinstance(agents, list):
                raise APIValidationError("'agents' must be a JSON array of agent strings.")

            min_adoption = parse_int_param(
                payload.get("min_adoption"),
                "min_adoption",
                default=0,
                minimum=0,
                maximum=1_000_000,
            )
            include_summaries = parse_bool_param(payload.get("include_summaries"), default=True)
            top_n = payload.get("top_n")
            sort = str(payload.get("sort") or "repos").strip().lower()
            query = str(payload.get("q") or "").strip()
            output_format = str(payload.get("format") or "").strip().lower()

            result = self.server.service.generate_rules_file(
                rule_ids=[str(r) for r in rule_ids] if rule_ids is not None else None,
                categories=[str(c) for c in categories] if categories is not None else None,
                top_n=top_n,
                query=query,
                agents=[str(a) for a in agents] if agents is not None else None,
                min_adoption=min_adoption,
                sort=sort,
                include_summaries=include_summaries,
            )

            self._respond_rules_file(result, output_format)
        except APIValidationError as exc:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
        except Exception as exc:
            logger.exception("Unhandled error serving POST %s", path)
            self._send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, f"Internal error: {exc}")

    def _handle_rules_file_get(self, params: dict[str, list[str]]) -> None:
        rule_ids = [
            part.strip()
            for item in params.get("rule_ids", [])
            for part in item.split(",")
            if part.strip()
        ]
        categories = [
            part.strip()
            for item in params.get("categories", [])
            for part in item.split(",")
            if part.strip()
        ]
        agents = [
            part.strip()
            for item in params.get("agents", [])
            for part in item.split(",")
            if part.strip()
        ]
        top_n_raw = (params.get("top_n") or [None])[0]
        top_n = int(top_n_raw) if top_n_raw is not None else None
        min_adoption = parse_int_param(
            (params.get("min_adoption") or params.get("min") or [None])[0],
            "min_adoption",
            default=0,
            minimum=0,
            maximum=1_000_000,
        )
        sort = ((params.get("sort") or ["repos"])[0] or "repos").strip().lower()
        query = (params.get("q") or [""])[0].strip()
        include_summaries = parse_bool_param(
            (params.get("include_summaries") or [None])[0],
            default=True,
        )
        output_format = ((params.get("format") or [""])[0] or "").strip().lower()

        result = self.server.service.generate_rules_file(
            rule_ids=rule_ids or None,
            categories=categories or None,
            top_n=top_n,
            query=query,
            agents=agents or None,
            min_adoption=min_adoption,
            sort=sort,
            include_summaries=include_summaries,
        )
        self._respond_rules_file(result, output_format)

    def _respond_rules_file(self, result: dict[str, Any], output_format: str) -> None:
        if output_format and output_format not in ("markdown", "json"):
            raise APIValidationError("Parameter 'format' must be 'markdown' or 'json'.")

        accept = (self.headers.get("Accept") or "").lower()
        wants_json = output_format == "json" or (
            not output_format and "application/json" in accept and "text/markdown" not in accept
        )
        if wants_json:
            self._send_json(result)
        else:
            self._send_markdown(result["markdown"])

    def _handle_page_url(self, params: dict[str, list[str]]) -> None:
        agents = [
            part.strip()
            for item in params.get("agents", [])
            for part in item.split(",")
            if part.strip()
        ]
        categories = [
            part.strip()
            for item in params.get("categories", [])
            for part in item.split(",")
            if part.strip()
        ]
        min_adoption = parse_int_param(
            (params.get("min_adoption") or params.get("min") or [None])[0],
            "min_adoption",
            default=0,
            minimum=0,
            maximum=100,
        )
        sort = ((params.get("sort") or ["repos"])[0] or "repos").strip().lower()
        query = (params.get("q") or [""])[0].strip()
        generate = parse_bool_param((params.get("generate") or [None])[0], default=False)
        top_n_raw = (params.get("top_n") or [None])[0]
        top_n = int(top_n_raw) if top_n_raw is not None else None
        include_summaries = parse_bool_param(
            (params.get("include_summaries") or [None])[0],
            default=True,
        )

        result = self.server.service.build_page_url(
            query=query,
            agents=agents,
            categories=categories,
            min_adoption=min_adoption,
            sort=sort,
            generate=generate,
            top_n=top_n,
            include_summaries=include_summaries,
        )
        self._send_json(result)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the RuleIndex RESTful API server.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Bind port (default: 8000)")
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"Path to SQLite database (default: {DEFAULT_DB_PATH})",
    )
    parser.add_argument(
        "--web-base-url",
        default=DEFAULT_WEB_BASE_URL,
        help=f"Base URL of the deployed RuleIndex web app (default: {DEFAULT_WEB_BASE_URL})",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    service = RuleIndexService(db_path=args.db, web_base_url=args.web_base_url)
    # Fail fast at startup if the SQLite database is missing or unreadable
    stats = service.get_stats()
    server = RuleIndexHTTPServer((args.host, args.port), service=service)
    logger.info(
        "RuleIndex REST API listening on http://%s:%d (%d canonical rules loaded)",
        args.host,
        args.port,
        stats["total_rules"],
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down RuleIndex REST API server.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
