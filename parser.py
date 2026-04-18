import sys
from pathlib import Path

import tree_sitter_php as tsphp
import tree_sitter as ts

HOOK_FUNCTIONS = {
    "do_action": "fires",
    "do_action_ref_array": "fires",
    "apply_filters": "fires",
    "apply_filters_ref_array": "fires",
    "add_action": "listens",
    "add_filter": "listens",
}

ACTION_FUNCTIONS = {"do_action", "do_action_ref_array", "add_action"}
FILTER_FUNCTIONS = {"apply_filters", "apply_filters_ref_array", "add_filter"}

_lang = ts.Language(tsphp.language_php())
_parser = ts.Parser(_lang)


def _extract_string_value(node):
    """Extract a string literal value from an AST node, or None."""
    if node.type in ("string", "encapsed_string"):
        for child in node.children:
            if child.type == "string_content":
                return child.text.decode("utf-8", errors="replace")
    return None


def _flatten_concat(node, parts, has_dynamic_ref):
    """Recursively flatten nested binary_expression (concatenation) nodes."""
    for child in node.children:
        if child.type == ".":
            continue
        if child.type == "binary_expression":
            _flatten_concat(child, parts, has_dynamic_ref)
        else:
            sv = _extract_string_value(child)
            if sv is not None:
                parts.append(sv)
            else:
                parts.append("*")
                has_dynamic_ref[0] = True


def _extract_hook_name(node):
    """Extract hook name from the first argument node.

    Returns (name, dynamic, raw_expression).
    """
    # String literal: 'hook_name' or "hook_name"
    string_val = _extract_string_value(node)
    if string_val is not None:
        return string_val, False, None

    # Binary expression (concatenation): 'prefix_' . $var . '_suffix'
    # Tree-sitter nests these left-associatively, so flatten recursively.
    if node.type == "binary_expression":
        parts = []
        has_dynamic = False
        _flatten_concat(node, parts, has_dynamic_ref := [False])
        has_dynamic = has_dynamic_ref[0]
        name = "".join(parts)
        raw = node.text.decode("utf-8", errors="replace")
        return name, has_dynamic, raw

    # Variable or anything else
    raw = node.text.decode("utf-8", errors="replace")
    return None, True, raw


def _extract_callback(node, scope_class=None):
    """Extract callback info from an argument node.

    Returns a dict with keys: callback, callback_type, callback_class, callback_method.
    """
    # String literal callback: 'my_func' or 'Class::method'
    string_val = _extract_string_value(node)
    if string_val is not None:
        if "::" in string_val:
            cls, method = string_val.split("::", 1)
            return {
                "callback": string_val,
                "callback_type": "static_method",
                "callback_class": cls,
                "callback_method": method,
            }
        return {
            "callback": string_val,
            "callback_type": "function",
            "callback_class": None,
            "callback_method": string_val,
        }

    # array($this, 'method'), array('Class', 'method'), [Class::class, 'method'], etc.
    if node.type == "array_creation_expression":
        elements = [c for c in node.children if c.type == "array_element_initializer"]
        if len(elements) == 2:
            first_val = elements[0].children[0] if elements[0].children else elements[0]
            method_node = elements[1].children[0] if elements[1].children else elements[1]
            method = _extract_string_value(method_node)
            if method:
                return _resolve_array_callback(first_val, method, scope_class)

    # Closure: function() { ... }
    if node.type == "anonymous_function":
        return {
            "callback": node.text.decode("utf-8", errors="replace"),
            "callback_type": "closure",
            "callback_class": None,
            "callback_method": None,
        }

    # Arrow function: fn() => ...
    if node.type == "arrow_function":
        return {
            "callback": node.text.decode("utf-8", errors="replace"),
            "callback_type": "closure",
            "callback_class": None,
            "callback_method": None,
        }

    # Variable: $callback
    if node.type == "variable_name":
        return {
            "callback": node.text.decode("utf-8", errors="replace"),
            "callback_type": "variable",
            "callback_class": None,
            "callback_method": None,
        }

    # Fallback
    return {
        "callback": node.text.decode("utf-8", errors="replace"),
        "callback_type": None,
        "callback_class": None,
        "callback_method": None,
    }


def _resolve_array_callback(first_val, method, scope_class):
    """Resolve the class part of an array callback like array($this, 'method')."""
    # $this -> method callback, resolve from enclosing class
    if first_val.type == "variable_name" and first_val.text.decode("utf-8", errors="replace") == "$this":
        cls = scope_class or "$this"
        return {
            "callback": f"{cls}::{method}",
            "callback_type": "method",
            "callback_class": scope_class,
            "callback_method": method,
        }

    # self::class, static::class, or ClassName::class
    if first_val.type == "class_constant_access_expression":
        scope_node = first_val.children[0] if first_val.children else None
        if scope_node and scope_node.type == "relative_scope":
            # self::class or static::class
            keyword = scope_node.text.decode("utf-8", errors="replace")
            cls = scope_class or keyword
            return {
                "callback": f"{cls}::{method}",
                "callback_type": "static_method",
                "callback_class": scope_class,
                "callback_method": method,
            }
        elif scope_node and scope_node.type == "name":
            # ClassName::class
            cls = scope_node.text.decode("utf-8", errors="replace")
            return {
                "callback": f"{cls}::{method}",
                "callback_type": "static_method",
                "callback_class": cls,
                "callback_method": method,
            }

    # String class name: array('ClassName', 'method')
    cls_name = _extract_string_value(first_val)
    if cls_name:
        return {
            "callback": f"{cls_name}::{method}",
            "callback_type": "static_method",
            "callback_class": cls_name,
            "callback_method": method,
        }

    # Unknown first element
    raw = first_val.text.decode("utf-8", errors="replace")
    return {
        "callback": f"{raw}::{method}",
        "callback_type": None,
        "callback_class": None,
        "callback_method": method,
    }


def _extract_priority(node):
    """Extract integer priority from an argument node."""
    if node.type == "integer":
        try:
            return int(node.text.decode())
        except ValueError:
            pass
    return 10


def _find_enclosing_scope(node):
    """Find the enclosing class and function/method for a node.

    Returns (scope_class, scope_function). Skips anonymous functions
    and arrow functions so that closures inside methods report the method.
    """
    scope_class = None
    scope_function = None
    current = node.parent
    while current is not None:
        if current.type in ("function_definition", "method_declaration"):
            if scope_function is None:
                name_node = current.child_by_field_name("name")
                if name_node:
                    scope_function = name_node.text.decode("utf-8", errors="replace")
        elif current.type == "class_declaration":
            if scope_class is None:
                name_node = current.child_by_field_name("name")
                if name_node:
                    scope_class = name_node.text.decode("utf-8", errors="replace")
        current = current.parent
    return scope_class, scope_function


def _extract_doc_comment(call_node):
    """Extract a comment from the line immediately above a hook call.

    Walks up to the nearest statement-level parent, then checks the
    previous sibling for a comment on the preceding line. Returns the
    cleaned comment text or None.
    """
    # Walk up to the statement that contains this call
    stmt = call_node
    while stmt.parent and stmt.parent.type not in (
        "program", "compound_statement", "declaration_list",
        "switch_block", "case_statement", "default_statement",
    ):
        stmt = stmt.parent

    # Look at previous siblings for a comment on the line before
    prev = stmt.prev_named_sibling
    if prev is None or prev.type != "comment":
        return None

    # Must be on the line immediately before the statement
    comment_end_line = prev.end_point[0]
    stmt_start_line = stmt.start_point[0]
    if stmt_start_line - comment_end_line != 1:
        return None

    raw = prev.text.decode("utf-8", errors="replace")
    # Strip comment delimiters
    if raw.startswith("//"):
        return raw[2:].strip()
    if raw.startswith("/*") and raw.endswith("*/"):
        inner = raw[2:-2].strip()
        # Strip leading * from each line (docblock style)
        lines = inner.split("\n")
        cleaned = []
        for line in lines:
            line = line.strip()
            if line.startswith("*"):
                line = line[1:].strip()
            cleaned.append(line)
        return "\n".join(cleaned).strip()
    return raw.strip()


def _walk_function_calls(node):
    """Yield all function_call_expression nodes in the tree."""
    if node.type == "function_call_expression":
        yield node
    for child in node.children:
        yield from _walk_function_calls(child)


def parse_file(filepath, source_label=None):
    """Parse a PHP file and extract all hook calls.

    Returns a list of dicts with keys:
        func, edge_type, hook_type, hook_name, dynamic, raw_expression,
        callback, priority, file, line, source
    """
    filepath = Path(filepath)
    try:
        code = filepath.read_bytes()
    except (OSError, IOError) as e:
        print(f"  Warning: cannot read {filepath}: {e}", file=sys.stderr)
        return []

    tree = _parser.parse(code)
    results = []

    for call_node in _walk_function_calls(tree.root_node):
        # Get function name
        name_node = call_node.child_by_field_name("function")
        if name_node is None:
            continue
        func_name = name_node.text.decode("utf-8", errors="replace")
        if func_name not in HOOK_FUNCTIONS:
            continue

        edge_type = HOOK_FUNCTIONS[func_name]
        hook_type = "action" if func_name in ACTION_FUNCTIONS else "filter"

        # Get arguments
        args_node = call_node.child_by_field_name("arguments")
        if args_node is None:
            continue
        arg_nodes = [c for c in args_node.children if c.type == "argument"]
        if not arg_nodes:
            continue

        # First arg: hook name
        first_arg = arg_nodes[0]
        # The argument node wraps the actual expression
        expr = first_arg.children[0] if first_arg.children else first_arg
        hook_name, dynamic, raw_expr = _extract_hook_name(expr)

        # Doc comment on the line above
        doc_comment = _extract_doc_comment(call_node)

        # Enclosing scope
        scope_class, scope_function = _find_enclosing_scope(call_node)

        # Callback and priority (for add_action/add_filter)
        callback = None
        callback_type = None
        callback_class = None
        callback_method = None
        priority = 10
        if edge_type == "listens":
            if len(arg_nodes) >= 2:
                cb_expr = arg_nodes[1].children[0] if arg_nodes[1].children else arg_nodes[1]
                cb_info = _extract_callback(cb_expr, scope_class)
                callback = cb_info["callback"]
                callback_type = cb_info["callback_type"]
                callback_class = cb_info["callback_class"]
                callback_method = cb_info["callback_method"]
            if len(arg_nodes) >= 3:
                pri_expr = arg_nodes[2].children[0] if arg_nodes[2].children else arg_nodes[2]
                priority = _extract_priority(pri_expr)

        results.append({
            "func": func_name,
            "edge_type": edge_type,
            "hook_type": hook_type,
            "hook_name": hook_name,
            "dynamic": dynamic,
            "raw_expression": raw_expr,
            "callback": callback,
            "callback_type": callback_type,
            "callback_class": callback_class,
            "callback_method": callback_method,
            "priority": priority,
            "file": str(filepath),
            "line": call_node.start_point[0] + 1,
            "source": source_label,
            "scope_class": scope_class,
            "scope_function": scope_function,
            "doc_comment": doc_comment,
        })

    return results
