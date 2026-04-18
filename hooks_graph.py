#!/usr/bin/env python3
"""WordPress Hooks Graph — CLI entry point.

Scans one or more directories for PHP files, extracts WordPress hook calls
(do_action, add_action, apply_filters, add_filter), and outputs a JSON
graph of hook relationships.

Usage:
    python hooks_graph.py /path/to/wordpress
    python hooks_graph.py /path/to/wordpress /path/to/plugin -o analysis.json
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from parser import parse_file
from graph import build_graph, filter_graph_by_overlap

# ── ANSI styling ──────────────────────────────────────────────

_IS_TTY = sys.stdout.isatty()

BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"
CYAN = "\033[36m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
MAGENTA = "\033[35m"


def _style(text, *codes):
    if not _IS_TTY or not codes:
        return str(text)
    return "".join(codes) + str(text) + RESET


def _section(title):
    line = _style("─" * 45, DIM)
    header = _style(f" {title}", BOLD, CYAN)
    print(f"\n{line}\n{header}\n{line}")


def _row(label, value, extra=""):
    lbl = _style(f"  {label:<18s}", DIM)
    val = _style(f"{value:>5}", BOLD)
    if extra:
        print(f"{lbl}{val}  {extra}")
    else:
        print(f"{lbl}{val}")


def _progress_bar(current, total, rate, width=25):
    filled = int(width * current / total) if total else 0
    bar = "█" * filled + "░" * (width - filled)
    bar_str = _style(bar, GREEN)
    rate_str = _style(f"{rate:.0f}/sec", DIM)
    print(f"  {bar_str} {current}/{total}  {rate_str}", end="\r")


def find_php_files(directory, exclude_dirs=None):
    """Recursively find all .php files in a directory, respecting .gitignore.

    Args:
        directory: Root directory to scan.
        exclude_dirs: Optional set of folder names to exclude (matched against
            each component of the relative path).
    """
    directory = Path(directory)
    if not directory.is_dir():
        print(f"Error: {directory} is not a directory", file=sys.stderr)
        sys.exit(1)

    exclude_dirs = exclude_dirs or set()

    def _excluded(rel_path):
        return bool(exclude_dirs and exclude_dirs & set(Path(rel_path).parts))

    # Use git ls-files to respect .gitignore rules
    try:
        result = subprocess.run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "*.php"],
            cwd=directory,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            files = [directory / f for f in result.stdout.split("\0") if f and not _excluded(f)]
            return sorted(files)
    except FileNotFoundError:
        pass  # git not installed

    files = []
    for p in directory.rglob("*.php"):
        rel = p.relative_to(directory)
        if not _excluded(rel):
            files.append(p)
    return sorted(files)


def main():
    ap = argparse.ArgumentParser(
        description="Scan WordPress codebases and build a hook relationship graph.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
examples:
  # Scan a single WordPress checkout
  npm run parse -- ~/Code/wordpress

  # Scan multiple directories and find shared hooks
  npm run parse -- ~/Code/wordpress ~/Code/my-plugin --overlap-only

  # Exclude vendor and test folders
  npm run parse -- ~/Code/wordpress --exclude vendor,tests,node_modules

  # Custom output path
  npm run parse -- ~/Code/wordpress -o storage/wp-core.json

  # Combine options
  npm run parse -- ~/Code/wp ~/Code/woo --overlap-only --exclude vendor -o storage/overlap.json

supported hook functions:
  do_action, do_action_ref_array         fires an action hook
  apply_filters, apply_filters_ref_array fires a filter hook
  add_action                             listens to an action hook
  add_filter                             listens to a filter hook

file discovery:
  PHP files are found using git ls-files (respecting .gitignore) when run
  inside a git repository. Falls back to a recursive glob when git is not
  available. The --exclude flag removes folders on top of .gitignore rules.

output format:
  The output JSON contains three top-level keys:

    nodes    List of node objects. Each node has a "type" field that is
             either "hook" or "file".
             - hook nodes include: name, hook_type (action/filter),
               fire_count, listen_count, sources, and dynamic flag.
             - file nodes include: file path and source label.

    edges    List of edge objects connecting files to hooks, with fields:
             source, target, edge_type (fires/listens), function name,
             line number, callback, and priority.

    metadata Scan summary: scanned directories, total files, total hooks,
             dynamic hook count, timestamp, and overlap filter status.

viewing results:
  Open index.html in a browser and upload the generated JSON file.
  The viewer provides interactive graph visualization with search,
  layout switching (dagre/force/concentric), source filtering, and
  hotspot highlighting. No server or build step required.
""",
    )
    ap.add_argument(
        "dirs",
        nargs="+",
        metavar="DIR",
        help="One or more directories to scan for PHP files.",
    )
    ap.add_argument(
        "-o", "--output",
        default=None,
        metavar="PATH",
        help="Output JSON file path (default: $TMPDIR/hooksgraph-$USER/<dir-names>.json).",
    )
    ap.add_argument(
        "--overlap-only",
        action="store_true",
        default=False,
        help="Only output hooks present in 2+ scanned directories. "
             "Useful for finding shared integration points between "
             "a core codebase and plugins.",
    )
    ap.add_argument(
        "--exclude",
        default="",
        metavar="a,b,c",
        help="Comma-separated list of folder names to exclude "
             "(in addition to .gitignore). Matched against each "
             "path component, e.g. --exclude vendor,tests.",
    )
    ap.add_argument(
        "--serve",
        action="store_true",
        default=False,
        help="Start a local dev server after parsing to view the graph.",
    )
    args = ap.parse_args()

    # Parse exclude list into a set of folder names
    exclude_dirs = {name.strip() for name in args.exclude.split(",") if name.strip()}

    # Expand ~ and resolve relative paths (so "." becomes the actual folder name)
    args.dirs = [os.path.realpath(os.path.expanduser(d)) for d in args.dirs]

    # Derive default output path from scanned dir names
    if args.output is None:
        dir_names = [os.path.basename(os.path.normpath(d)) for d in args.dirs]
        filename = "-".join(dir_names) + ".json"
        args.output = os.path.join(
            tempfile.gettempdir(), f"hooksgraph-{os.getenv('USER', 'unknown')}", filename
        )

    # Validate directories
    for d in args.dirs:
        if not os.path.isdir(d):
            print(f"Error: {d} is not a directory", file=sys.stderr)
            sys.exit(1)

    # Discover PHP files
    if exclude_dirs:
        print(f"Excluding folders: {_style(', '.join(sorted(exclude_dirs)), YELLOW)}")
    print(f"{_style('Scanning for PHP files...', BOLD)}")
    all_files = []
    for d in args.dirs:
        files = find_php_files(d, exclude_dirs=exclude_dirs)
        label = os.path.basename(os.path.normpath(d))
        all_files.extend((f, d, label) for f in files)
        count = _style(f"{len(files)} files", DIM)
        print(f"  {_style(label, BOLD)} {_style('─', DIM)} {count}")

    total = len(all_files)
    if total == 0:
        print("No PHP files found.")
        sys.exit(0)

    print(f"\n{_style(f'Parsing {total} files...', BOLD)}")
    start = time.time()

    all_calls = []
    errors = 0
    for i, (filepath, base_dir, label) in enumerate(all_files, 1):
        elapsed = time.time() - start
        rate = i / elapsed if elapsed > 0 else 0
        if i % 50 == 0 or i == total:
            _progress_bar(i, total, rate)
        try:
            calls = parse_file(filepath, source_label=label)
            all_calls.extend(calls)
        except Exception as e:
            errors += 1
            print(f"\n  {_style('Warning:', YELLOW)} failed to parse {filepath}: {e}", file=sys.stderr)

    elapsed = time.time() - start
    # Clear the progress bar line and print final status
    print(f"\r{' ' * 60}\r  {_style(f'Parsed {total} files in {elapsed:.1f}s', GREEN)}")

    # Build graph
    print(f"\n{_style('Building graph...', BOLD)}")
    graph = build_graph(all_calls, args.dirs, total_files=total)

    if args.overlap_only:
        graph = filter_graph_by_overlap(graph)
        print(f"  Filtered to hooks shared across 2+ repos")

    # Write output
    output_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(graph, f, indent=2)

    # Summary
    meta = graph["metadata"]
    hook_nodes = [n for n in graph["nodes"] if n["type"] == "hook"]
    file_nodes = [n for n in graph["nodes"] if n["type"] == "file"]
    action_hooks = [n for n in hook_nodes if n["hook_type"] == "action"]
    filter_hooks = [n for n in hook_nodes if n["hook_type"] == "filter"]
    hotspots = sorted(hook_nodes, key=lambda n: n["fire_count"] + n["listen_count"], reverse=True)[:5]

    # ── Scan section ──
    _section("Scan")
    _row("Files scanned", meta["total_files"])
    _row("Files with hooks", len(file_nodes))
    if errors:
        lbl = _style("  Parse errors    ", DIM)
        val = _style(f"{errors:>5}", BOLD, YELLOW)
        print(f"{lbl}{val}")

    # ── Hooks section ──
    sep = _style("│", DIM)
    _section("Hooks")
    actions_str = f"{sep}  Actions {_style(len(action_hooks), BOLD)}  {sep}  Filters {_style(len(filter_hooks), BOLD)}"
    _row("Total hooks", meta["total_hooks"], actions_str)
    _row("Dynamic hooks", meta["dynamic_hooks"])
    _row("Total edges", len(graph["edges"]))
    if meta.get("overlap_filter"):
        _row("Overlap filter", "on")
        _row("Pre-filter hooks", meta["pre_filter_total_hooks"])

    # ── Top Hooks section ──
    if hotspots:
        _section("Top Hooks")
        for h in hotspots:
            total_conn = h["fire_count"] + h["listen_count"]
            name = h["name"]
            if len(name) > 32:
                name = name[:30] + ".."
            fires = _style(f"{h['fire_count']} fires", DIM)
            listens = _style(f"{h['listen_count']} listens", DIM)
            conn_str = _style(f"{total_conn:>4}", BOLD)
            print(f"  {name:<34s}{conn_str}  {sep}  {fires}  {listens}")

    # ── Footer ──
    _section("Output")
    display_path = output_path.replace(tempfile.gettempdir(), "$TMPDIR")
    print(f"  {_style(display_path, CYAN)}")

    # Optionally start the dev server
    if args.serve:
        serve_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "serve.py")
        os.execv(sys.executable, [sys.executable, serve_script, "--json", output_path])


if __name__ == "__main__":
    main()
