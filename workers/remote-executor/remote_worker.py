#!/usr/bin/env python3
"""SciForge remote worker protocol skeleton.

This file intentionally uses only the Python standard library. It implements a
JSONL protocol stub that is safe to run locally: commands and Slurm jobs are
recorded in memory and never executed by a shell.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from typing import Any, Dict


PROTOCOL = "sciforge.remote-worker.v1"
VERSION = "0.1.0"
CAPABILITIES = [
    "jsonl",
    "hello",
    "direct-run-stub",
    "stdin-stub",
    "cancel-stub",
    "slurm-stub",
]


def version_payload() -> Dict[str, Any]:
    return {
        "protocol": PROTOCOL,
        "version": VERSION,
        "python": {
            "version": sys.version.split()[0],
            "implementation": sys.implementation.name,
        },
        "capabilities": CAPABILITIES,
    }


def envelope(message_type: str, payload: Dict[str, Any], request_id: str | None = None) -> Dict[str, Any]:
    message: Dict[str, Any] = {
        "v": 1,
        "type": message_type,
        "ts": iso_now(),
        "payload": payload,
    }
    if request_id:
        message["id"] = request_id
    return message


def error_payload(code: str, reason: str, retryable: bool = False) -> Dict[str, Any]:
    return {
        "code": code,
        "reason": reason,
        "retryable": retryable,
        "suggestion": "Check the JSONL envelope type and payload shape.",
    }


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def write_message(message: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, separators=(",", ":"), sort_keys=True) + "\n")
    sys.stdout.flush()


def run_jsonl() -> int:
    runs: Dict[str, Dict[str, Any]] = {}
    jobs: Dict[str, Dict[str, Any]] = {}

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            request_id = request.get("id")
            message_type = request.get("type")
            payload = request.get("payload") or {}
            if not isinstance(payload, dict):
                raise ValueError("payload must be an object")

            if message_type == "hello":
                write_message(envelope("hello.ok", version_payload(), request_id))
            elif message_type == "run.start":
                run_id = "run_" + uuid.uuid4().hex[:12]
                command = payload.get("command") or []
                if isinstance(command, str):
                    command = [command]
                runs[run_id] = {
                    "status": "running",
                    "command": command,
                    "stdout": "mock remote_worker accepted run: " + " ".join(map(str, command)) + "\n",
                    "stderr": "",
                    "stdin": payload.get("stdin") or "",
                    "exitCode": None,
                }
                write_message(envelope("run.started", {"runId": run_id, "status": "running"}, request_id))
            elif message_type == "run.poll":
                run_id = str(payload.get("runId") or "")
                run = require_record(runs, run_id, "run_not_found")
                if run["status"] == "running":
                    run["status"] = "succeeded"
                    run["exitCode"] = 0
                    run["stdout"] += "mock remote_worker completed run\n"
                write_message(envelope("run.status", {
                    "runId": run_id,
                    "status": run["status"],
                    "exitCode": run["exitCode"],
                    "stdout": run["stdout"],
                    "stderr": run["stderr"],
                }, request_id))
            elif message_type == "run.stdin":
                run_id = str(payload.get("runId") or "")
                run = require_record(runs, run_id, "run_not_found")
                data = str(payload.get("data") or "")
                run["stdin"] += data
                write_message(envelope("run.stdin.ok", {
                    "runId": run_id,
                    "acceptedBytes": len(data.encode("utf-8")),
                    "eof": bool(payload.get("eof")),
                }, request_id))
            elif message_type == "run.cancel":
                run_id = str(payload.get("runId") or "")
                run = require_record(runs, run_id, "run_not_found")
                run["status"] = "cancelled"
                write_message(envelope("run.cancelled", {"runId": run_id, "status": "cancelled"}, request_id))
            elif message_type == "slurm.submit":
                job_id = "slurm_" + uuid.uuid4().hex[:12]
                jobs[job_id] = {
                    "state": "queued",
                    "raw": "PENDING",
                    "script": payload.get("script") or "",
                }
                write_message(envelope("slurm.submitted", {"jobId": job_id, "state": "queued"}, request_id))
            elif message_type == "slurm.status":
                job_id = str(payload.get("jobId") or "")
                job = require_record(jobs, job_id, "job_not_found")
                write_message(envelope("slurm.status", {
                    "jobId": job_id,
                    "state": job["state"],
                    "raw": job["raw"],
                }, request_id))
            elif message_type == "slurm.cancel":
                job_id = str(payload.get("jobId") or "")
                job = require_record(jobs, job_id, "job_not_found")
                job["state"] = "cancelled"
                job["raw"] = "CANCELLED"
                write_message(envelope("slurm.cancelled", {"jobId": job_id, "state": "cancelled"}, request_id))
            else:
                write_message(envelope("error", error_payload("remote_protocol_error", f"Unsupported type: {message_type}"), request_id))
        except Exception as exc:  # Keep the protocol alive after malformed lines.
            request_id = request.get("id") if isinstance(locals().get("request"), dict) else None
            code = exc.args[1] if len(getattr(exc, "args", ())) > 1 else "remote_protocol_error"
            write_message(envelope("error", error_payload(str(code), str(exc)), request_id))
    return 0


def require_record(records: Dict[str, Dict[str, Any]], record_id: str, code: str) -> Dict[str, Any]:
    if record_id in records:
        return records[record_id]
    raise KeyError(f"Unknown id: {record_id}", code)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="SciForge remote worker protocol skeleton")
    parser.add_argument("--version-json", action="store_true", help="Print version and capability JSON")
    parser.add_argument("--jsonl", action="store_true", help="Run JSONL protocol over stdin/stdout")
    args = parser.parse_args(argv)

    if args.version_json:
        print(json.dumps(version_payload(), indent=2, sort_keys=True))
        return 0
    if args.jsonl:
        return run_jsonl()
    parser.print_help(sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
