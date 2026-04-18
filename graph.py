"""Build a graph JSON structure from parsed hook calls."""
import os
from datetime import datetime, timezone


def _make_source_label(directory, scanned_dirs):
    """Derive a short source label from a directory path."""
    return os.path.basename(os.path.normpath(directory))


def _relative_path(filepath, base_dir):
    """Make a file path relative to its scanned directory."""
    try:
        return os.path.relpath(filepath, base_dir)
    except ValueError:
        return filepath


def _find_base_dir(filepath, scanned_dirs):
    """Find which scanned directory a file belongs to."""
    filepath = os.path.abspath(filepath)
    for d in scanned_dirs:
        d = os.path.abspath(d)
        if filepath.startswith(d + os.sep) or filepath == d:
            return d
    return os.path.dirname(filepath)


_dynamic_counter = 0


def _hook_id(hook_call):
    """Generate a node ID for a hook."""
    global _dynamic_counter
    name = hook_call["hook_name"]
    if name is None:
        _dynamic_counter += 1
        return f"hook::dynamic_{_dynamic_counter}"
    return f"hook::{name}"


def build_graph(hook_calls, scanned_dirs, total_files=0):
    """Build graph dict from a list of hook call dicts.

    Args:
        hook_calls: list of dicts from parser.parse_file()
        scanned_dirs: list of directory paths that were scanned
        total_files: total number of PHP files scanned

    Returns:
        dict matching the hooks.json schema
    """
    global _dynamic_counter
    _dynamic_counter = 0

    source_labels = {}
    for d in scanned_dirs:
        source_labels[os.path.abspath(d)] = _make_source_label(d, scanned_dirs)

    source_label_list = [_make_source_label(d, scanned_dirs) for d in scanned_dirs]

    # Collect hook nodes and file nodes
    hook_nodes = {}  # hook_id -> node dict
    file_nodes = {}  # file_id -> node dict
    edges = []
    dynamic_count = 0

    for call in hook_calls:
        hid = _hook_id(call)
        base_dir = _find_base_dir(call["file"], scanned_dirs)
        source = source_labels.get(os.path.abspath(base_dir), os.path.basename(base_dir))
        rel_path = _relative_path(call["file"], base_dir)
        file_id = f"file::{source}::{rel_path}"

        # Upsert hook node
        if hid not in hook_nodes:
            hook_nodes[hid] = {
                "id": hid,
                "type": "hook",
                "hook_type": call["hook_type"],
                "name": call["hook_name"] or hid.replace("hook::", ""),
                "fire_count": 0,
                "listen_count": 0,
                "dynamic": call["dynamic"],
                "sources": set(),
            }
            if call["dynamic"]:
                hook_nodes[hid]["raw_expression"] = call["raw_expression"]
                dynamic_count += 1

        hook_node = hook_nodes[hid]
        hook_node["sources"].add(source)

        if call["edge_type"] == "fires":
            hook_node["fire_count"] += 1
        else:
            hook_node["listen_count"] += 1

        # Upsert file node
        if file_id not in file_nodes:
            file_nodes[file_id] = {
                "id": file_id,
                "type": "file",
                "path": rel_path,
                "source": source,
                "hook_count": 0,
            }
        file_nodes[file_id]["hook_count"] += 1

        # Create edge
        edge = {
            "source": file_id,
            "target": hid,
            "type": call["edge_type"],
            "line": call["line"],
        }
        if call["callback"]:
            edge["callback"] = call["callback"]
        if call["edge_type"] == "listens":
            edge["priority"] = call["priority"]
        for field in ("callback_type", "callback_class", "callback_method",
                       "scope_class", "scope_function", "doc_comment"):
            val = call.get(field)
            if val is not None:
                edge[field] = val

        edges.append(edge)

    # Convert sets to sorted lists for JSON serialization
    for node in hook_nodes.values():
        node["sources"] = sorted(node["sources"])
        node["overlap"] = len(node["sources"]) >= 2
        if node["overlap"]:
            node["sourceIndex"] = -1
        else:
            src = node["sources"][0]
            node["sourceIndex"] = source_label_list.index(src) if src in source_label_list else 0

    nodes = sorted(hook_nodes.values(), key=lambda n: n["id"])
    nodes += sorted(file_nodes.values(), key=lambda n: n["id"])

    return {
        "metadata": {
            "scanned_dirs": [os.path.abspath(d) for d in scanned_dirs],
            "source_labels": [_make_source_label(d, scanned_dirs) for d in scanned_dirs],
            "total_files": total_files,
            "total_hooks": len(hook_nodes),
            "dynamic_hooks": dynamic_count,
            "scan_date": datetime.now(timezone.utc).isoformat(),
        },
        "nodes": nodes,
        "edges": edges,
    }


def filter_graph_by_overlap(graph):
    """Filter graph to only hooks present in 2+ sources.

    Args:
        graph: dict from build_graph()

    Returns:
        New filtered graph dict (does not mutate input)
    """
    original_hooks = [n for n in graph["nodes"] if n["type"] == "hook"]

    keep_hook_ids = set()
    for node in original_hooks:
        if len(node["sources"]) >= 2:
            keep_hook_ids.add(node["id"])

    kept_edges = [e for e in graph["edges"] if e["target"] in keep_hook_ids]

    kept_file_ids = {e["source"] for e in kept_edges}

    file_edge_counts = {}
    for e in kept_edges:
        file_edge_counts[e["source"]] = file_edge_counts.get(e["source"], 0) + 1

    kept_hooks = [dict(n) for n in original_hooks if n["id"] in keep_hook_ids]
    kept_files = []
    for n in graph["nodes"]:
        if n["type"] == "file" and n["id"] in kept_file_ids:
            f = dict(n)
            f["hook_count"] = file_edge_counts.get(f["id"], 0)
            kept_files.append(f)

    nodes = sorted(kept_hooks, key=lambda n: n["id"]) + sorted(kept_files, key=lambda n: n["id"])

    meta = dict(graph["metadata"])
    meta["overlap_filter"] = True
    meta["pre_filter_total_hooks"] = graph["metadata"]["total_hooks"]
    meta["total_hooks"] = len(kept_hooks)
    meta["dynamic_hooks"] = sum(1 for n in kept_hooks if n.get("dynamic"))

    return {
        "metadata": meta,
        "nodes": nodes,
        "edges": kept_edges,
    }
