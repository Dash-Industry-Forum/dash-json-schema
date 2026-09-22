#!/usr/bin/env python3
"""Minify pretty-printed JSON and XML/MPD files.

This script removes whitespace and newline characters that are only used
for readability in pretty-printed files.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
import re


def minify_json(raw: str) -> str:
    decoder = json.JSONDecoder()
    start = None
    for idx, ch in enumerate(raw):
        if ch in "[{":
            start = idx
            break

    if start is None:
        raise ValueError("No JSON object/array found in input")

    data, _ = decoder.raw_decode(raw, idx=start)
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


def minify_xml(raw: str) -> str:
    # Preserve XML bytes as-is except indentation/newline runs between tags.
    # This avoids parser re-serialization side effects (namespace prefix changes,
    # attribute reordering, quote style changes, etc.).
    return re.sub(r">\s+<", "><", raw).strip()


def output_path_for(input_path: Path) -> Path:
    return input_path.with_name(f"{input_path.stem}.min{input_path.suffix}")


def gzip_path_for(path: Path) -> Path:
    return path.with_name(f"{path.name}.gz")


def write_gzip(path: Path, content: str) -> Path:
    gz_path = gzip_path_for(path)
    with gzip.open(gz_path, "wt", encoding="utf-8", newline="") as handle:
        handle.write(content)
    return gz_path


def minify_file(path: Path) -> tuple[Path, Path]:
    suffix = path.suffix.lower()
    raw = path.read_text(encoding="utf-8")

    if suffix == ".json":
        minified = minify_json(raw)
    elif suffix in {".xml", ".mpd"}:
        minified = minify_xml(raw)
    else:
        raise ValueError(f"Unsupported file type: {path}")

    out_path = output_path_for(path)
    out_path.write_text(minified, encoding="utf-8")
    gz_path = write_gzip(out_path, minified)
    return out_path, gz_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Minify pretty-printed JSON and XML/MPD files.",
    )
    parser.add_argument(
        "files",
        nargs="+",
        help="Input files (.json, .xml, .mpd)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    for file_name in args.files:
        path = Path(file_name)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {path}")
        out_path, gz_path = minify_file(path)
        print(f"Wrote: {out_path}")
        print(f"Wrote: {gz_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
