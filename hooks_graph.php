#!/usr/bin/env php
<?php
/**
 * WordPress Hooks Graph — PHP CLI entry point.
 *
 * Scans one or more directories for PHP files, extracts WordPress hook calls
 * (do_action, add_action, apply_filters, add_filter), and outputs a JSON
 * graph of hook relationships.
 *
 * Uses PHP's built-in token_get_all() tokenizer.
 *
 * Usage:
 *     php hooks_graph.php /path/to/wordpress
 *     php hooks_graph.php /path/to/wordpress /path/to/plugin -o analysis.json
 */

// ── Constants ───────────────────────────────────────────────

define('HOOK_FUNCTIONS', [
    'do_action'               => 'fires',
    'do_action_ref_array'     => 'fires',
    'apply_filters'           => 'fires',
    'apply_filters_ref_array' => 'fires',
    'add_action'              => 'listens',
    'add_filter'              => 'listens',
]);

define('ACTION_FUNCTIONS', ['do_action', 'do_action_ref_array', 'add_action']);
define('FILTER_FUNCTIONS', ['apply_filters', 'apply_filters_ref_array', 'add_filter']);

// ── ANSI styling ────────────────────────────────────────────

// In --print-path mode stdout is reserved for the final path, and the pretty
// UI is redirected to stderr; color it based on stderr's TTY status instead.
$_tty_stream = in_array('--print-path', $argv, true) ? STDERR : STDOUT;
if (function_exists('posix_isatty')) {
    $IS_TTY = posix_isatty($_tty_stream);
} elseif (function_exists('stream_isatty')) {
    $IS_TTY = stream_isatty($_tty_stream);
} else {
    $IS_TTY = false;
}

define('_BOLD',    "\033[1m");
define('_DIM',     "\033[2m");
define('_RESET',   "\033[0m");
define('_CYAN',    "\033[36m");
define('_GREEN',   "\033[32m");
define('_YELLOW',  "\033[33m");
define('_RED',     "\033[31m");
define('_MAGENTA', "\033[35m");

function style($text, ...$codes) {
    global $IS_TTY;
    if (!$IS_TTY || empty($codes)) {
        return (string) $text;
    }
    return implode('', $codes) . $text . _RESET;
}

function section($title) {
    $line   = style(str_repeat("\xe2\x94\x80", 45), _DIM);
    $header = style(" $title", _BOLD, _CYAN);
    echo "\n$line\n$header\n$line\n";
}

function row($label, $value, $extra = '') {
    $lbl = style(sprintf("  %-18s", $label), _DIM);
    $val = style(sprintf("%5s", $value), _BOLD);
    echo $extra !== '' ? "$lbl$val  $extra\n" : "$lbl$val\n";
}

function progress_bar($current, $total, $rate, $width = 25) {
    $filled   = $total > 0 ? intval($width * $current / $total) : 0;
    $bar      = str_repeat("\xe2\x96\x88", $filled) . str_repeat("\xe2\x96\x91", $width - $filled);
    $bar_str  = style($bar, _GREEN);
    $rate_str = style(sprintf("%.0f/sec", $rate), _DIM);
    echo "  $bar_str $current/$total  $rate_str\r";
}

// ── Parser helpers ──────────────────────────────────────────

function strip_quotes($str) {
    if (strlen($str) >= 2) {
        $f = $str[0];
        $l = $str[strlen($str) - 1];
        if (($f === "'" && $l === "'") || ($f === '"' && $l === '"')) {
            return substr($str, 1, -1);
        }
    }
    return $str;
}

function reconstruct_tokens($tokens) {
    $out = '';
    foreach ($tokens as $t) {
        $out .= is_array($t) ? $t[1] : $t;
    }
    return $out;
}

function strip_ws($tokens) {
    return array_values(array_filter($tokens, function ($t) {
        return !(is_array($t) && $t[0] === T_WHITESPACE);
    }));
}

/**
 * Extract tokens between a matched pair of parentheses.
 *
 * $pos must point to the opening '('. On return $pos points to the closing ')'.
 */
function tokens_between_parens(&$all, &$pos) {
    $depth  = 1;
    $pos++;
    $result = [];
    $count  = count($all);
    while ($pos < $count && $depth > 0) {
        $t    = $all[$pos];
        $char = is_string($t) ? $t : null;
        if ($char === '(') $depth++;
        if ($char === ')') { $depth--; if ($depth === 0) break; }
        $result[] = $t;
        $pos++;
    }
    return $result;
}

/**
 * Split a flat token list by top-level commas (respecting (), [], {} nesting).
 */
function split_args($tokens) {
    $args    = [];
    $current = [];
    $depth   = 0;
    foreach ($tokens as $t) {
        $char = is_string($t) ? $t : null;
        if ($char === '(' || $char === '[' || $char === '{') $depth++;
        if ($char === ')' || $char === ']' || $char === '}') $depth--;
        if ($char === ',' && $depth === 0) {
            $args[]  = $current;
            $current = [];
            continue;
        }
        $current[] = $t;
    }
    if (!empty($current)) $args[] = $current;
    return $args;
}

// ── Hook-name extraction ────────────────────────────────────

/**
 * Extract the hook name from the first-argument token list.
 *
 * Returns [name|null, dynamic, raw_expression|null].
 */
function extract_hook_name($arg_tokens) {
    $tokens = strip_ws($arg_tokens);
    if (empty($tokens)) return [null, true, null];

    // Single string literal
    if (count($tokens) === 1 && is_array($tokens[0]) && $tokens[0][0] === T_CONSTANT_ENCAPSED_STRING) {
        return [strip_quotes($tokens[0][1]), false, null];
    }

    // Concatenation (contains '.')
    $has_dot = false;
    foreach ($tokens as $t) {
        if (is_string($t) && $t === '.') { $has_dot = true; break; }
    }
    if ($has_dot) {
        $parts       = [];
        $raw_parts   = [];
        $has_dynamic = false;
        foreach ($tokens as $t) {
            if (is_string($t) && $t === '.') continue;
            if (is_array($t) && $t[0] === T_CONSTANT_ENCAPSED_STRING) {
                $parts[]     = strip_quotes($t[1]);
                $raw_parts[] = $t[1];
            } else {
                $parts[]     = '*';
                $has_dynamic = true;
                $raw_parts[] = is_array($t) ? $t[1] : $t;
            }
        }
        return [implode('', $parts), $has_dynamic, implode(' . ', $raw_parts)];
    }

    // Variable or other expression → dynamic
    return [null, true, reconstruct_tokens($tokens)];
}

// ── Callback extraction ─────────────────────────────────────

function extract_callback($arg_tokens, $scope_class = null) {
    $tokens = strip_ws($arg_tokens);
    $empty  = ['callback' => null, 'callback_type' => null, 'callback_class' => null, 'callback_method' => null];
    if (empty($tokens)) return $empty;

    $first = $tokens[0];

    // String literal
    if (count($tokens) === 1 && is_array($first) && $first[0] === T_CONSTANT_ENCAPSED_STRING) {
        $val = strip_quotes($first[1]);
        if (strpos($val, '::') !== false) {
            list($cls, $method) = explode('::', $val, 2);
            return ['callback' => $val, 'callback_type' => 'static_method', 'callback_class' => $cls, 'callback_method' => $method];
        }
        return ['callback' => $val, 'callback_type' => 'function', 'callback_class' => null, 'callback_method' => $val];
    }

    // array(...) or [...]
    if ((is_array($first) && $first[0] === T_ARRAY) || (is_string($first) && $first === '[')) {
        return extract_array_callback($tokens, $scope_class);
    }

    // Closure
    if (is_array($first) && $first[0] === T_FUNCTION) {
        return ['callback' => reconstruct_tokens($tokens), 'callback_type' => 'closure', 'callback_class' => null, 'callback_method' => null];
    }

    // Arrow function (PHP 7.4+)
    if (is_array($first) && defined('T_FN') && $first[0] === T_FN) {
        return ['callback' => reconstruct_tokens($tokens), 'callback_type' => 'closure', 'callback_class' => null, 'callback_method' => null];
    }

    // Variable
    if (is_array($first) && $first[0] === T_VARIABLE) {
        return ['callback' => $first[1], 'callback_type' => 'variable', 'callback_class' => null, 'callback_method' => null];
    }

    // Fallback
    return ['callback' => reconstruct_tokens($tokens), 'callback_type' => null, 'callback_class' => null, 'callback_method' => null];
}

function extract_array_callback($tokens, $scope_class) {
    $is_long = is_array($tokens[0]) && $tokens[0][0] === T_ARRAY;

    // Find inner tokens between the delimiters
    $inner = [];
    $depth = 0;
    $open  = $is_long ? '(' : '[';
    $close = $is_long ? ')' : ']';
    $start = -1;
    for ($i = 0, $c = count($tokens); $i < $c; $i++) {
        $ch = is_string($tokens[$i]) ? $tokens[$i] : null;
        if ($ch === $open) {
            if ($depth === 0) $start = $i + 1;
            $depth++;
        }
        if ($ch === $close) {
            $depth--;
            if ($depth === 0) {
                $inner = array_slice($tokens, $start, $i - $start);
                break;
            }
        }
    }

    $elements = split_args($inner);
    if (count($elements) !== 2) {
        return ['callback' => reconstruct_tokens($tokens), 'callback_type' => null, 'callback_class' => null, 'callback_method' => null];
    }

    $first_el  = strip_ws($elements[0]);
    $second_el = strip_ws($elements[1]);

    // Method name from second element
    $method = null;
    if (!empty($second_el) && is_array($second_el[0]) && $second_el[0][0] === T_CONSTANT_ENCAPSED_STRING) {
        $method = strip_quotes($second_el[0][1]);
    }
    if ($method === null) {
        return ['callback' => reconstruct_tokens($tokens), 'callback_type' => null, 'callback_class' => null, 'callback_method' => null];
    }

    if (empty($first_el)) {
        return ['callback' => "::$method", 'callback_type' => null, 'callback_class' => null, 'callback_method' => $method];
    }

    $first = $first_el[0];

    // $this
    if (is_array($first) && $first[0] === T_VARIABLE && $first[1] === '$this') {
        $cls = $scope_class ?: '$this';
        return ['callback' => "$cls::$method", 'callback_type' => 'method', 'callback_class' => $scope_class, 'callback_method' => $method];
    }

    // self::class, static::class, ClassName::class
    $has_dcolon = false;
    $has_class  = false;
    foreach ($first_el as $t) {
        if (is_array($t) && $t[0] === T_DOUBLE_COLON) $has_dcolon = true;
        if (is_array($t) && $t[0] === T_CLASS)        $has_class  = true;
    }
    if ($has_dcolon && $has_class) {
        $first_text = is_array($first) ? $first[1] : $first;
        if (in_array($first_text, ['self', 'static', 'parent'], true)) {
            $cls = $scope_class ?: $first_text;
            return ['callback' => "$cls::$method", 'callback_type' => 'static_method', 'callback_class' => $scope_class, 'callback_method' => $method];
        }
        return ['callback' => "$first_text::$method", 'callback_type' => 'static_method', 'callback_class' => $first_text, 'callback_method' => $method];
    }

    // String class name: 'ClassName'
    if (is_array($first) && $first[0] === T_CONSTANT_ENCAPSED_STRING) {
        $cls = strip_quotes($first[1]);
        return ['callback' => "$cls::$method", 'callback_type' => 'static_method', 'callback_class' => $cls, 'callback_method' => $method];
    }

    // Fallback
    $raw = reconstruct_tokens($first_el);
    return ['callback' => "$raw::$method", 'callback_type' => null, 'callback_class' => null, 'callback_method' => $method];
}

// ── Priority extraction ─────────────────────────────────────

function extract_priority($arg_tokens) {
    $tokens = strip_ws($arg_tokens);
    if (!empty($tokens) && is_array($tokens[0]) && $tokens[0][0] === T_LNUMBER) {
        return intval($tokens[0][1]);
    }
    return 10;
}

// ── Doc-comment extraction ──────────────────────────────────

function find_doc_comment($all_tokens, $hook_pos) {
    $hook_line = is_array($all_tokens[$hook_pos]) ? $all_tokens[$hook_pos][2] : null;
    if ($hook_line === null) return null;

    for ($i = $hook_pos - 1; $i >= 0; $i--) {
        $t = $all_tokens[$i];
        if (!is_array($t)) continue;
        if ($t[0] === T_WHITESPACE) continue;
        if ($t[0] === T_COMMENT || $t[0] === T_DOC_COMMENT) {
            $comment_start = $t[2];
            $comment_lines = substr_count($t[1], "\n");
            $comment_end   = $comment_start + $comment_lines;
            if ($hook_line - $comment_end === 1) {
                return clean_comment($t[1]);
            }
        }
        break;
    }
    return null;
}

function clean_comment($raw) {
    if (strpos($raw, '//') === 0) {
        return trim(substr($raw, 2));
    }
    if (strpos($raw, '/*') === 0 && substr($raw, -2) === '*/') {
        $inner   = trim(substr($raw, 2, -2));
        $lines   = explode("\n", $inner);
        $cleaned = [];
        foreach ($lines as $line) {
            $line = trim($line);
            if (isset($line[0]) && $line[0] === '*') {
                $line = trim(substr($line, 1));
            }
            $cleaned[] = $line;
        }
        return trim(implode("\n", $cleaned));
    }
    return trim($raw);
}

// ── File parser ─────────────────────────────────────────────

/**
 * Parse a PHP file and extract all hook calls.
 *
 * Returns a list of associative arrays with the same keys as the Python parser.
 */
function parse_php_file($filepath, $source_label = null) {
    $code = @file_get_contents($filepath);
    if ($code === false) {
        fwrite(STDERR, "  Warning: cannot read $filepath\n");
        return [];
    }

    $tokens = @token_get_all($code);
    if (!is_array($tokens)) return [];

    $results     = [];
    $scope_stack = []; // [{type, name, depth}]
    $brace_depth = 0;
    $count       = count($tokens);

    for ($i = 0; $i < $count; $i++) {
        $token = $tokens[$i];

        // ── Brace tracking ──
        if (is_string($token)) {
            if ($token === '{') {
                $brace_depth++;
            } elseif ($token === '}') {
                $brace_depth--;
                while (!empty($scope_stack) && end($scope_stack)['depth'] === $brace_depth) {
                    array_pop($scope_stack);
                }
            }
            continue;
        }

        list($id, $text, $line) = $token;

        // ── Scope: class declarations ──
        if ($id === T_CLASS) {
            $j = $i + 1;
            while ($j < $count && is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE) $j++;
            if ($j < $count && is_array($tokens[$j]) && $tokens[$j][0] === T_STRING) {
                $scope_stack[] = ['type' => 'class', 'name' => $tokens[$j][1], 'depth' => $brace_depth];
            }
            continue;
        }

        // ── Scope: function / method declarations ──
        if ($id === T_FUNCTION) {
            $j = $i + 1;
            while ($j < $count && is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE) $j++;
            if ($j < $count && is_array($tokens[$j]) && $tokens[$j][0] === T_STRING) {
                $scope_stack[] = ['type' => 'function', 'name' => $tokens[$j][1], 'depth' => $brace_depth];
            } else {
                // Anonymous function — track depth but don't report as scope
                $scope_stack[] = ['type' => 'anon', 'name' => null, 'depth' => $brace_depth];
            }
            continue;
        }

        // ── Hook function call? ──
        if ($id !== T_STRING || !isset(HOOK_FUNCTIONS[$text])) {
            continue;
        }

        // Ensure this is a plain function call, not a method call ($obj->do_action)
        $prev = $i - 1;
        while ($prev >= 0 && is_array($tokens[$prev]) && $tokens[$prev][0] === T_WHITESPACE) $prev--;
        if ($prev >= 0 && is_array($tokens[$prev])) {
            $pid = $tokens[$prev][0];
            if ($pid === T_OBJECT_OPERATOR || $pid === T_DOUBLE_COLON
                || (defined('T_NULLSAFE_OBJECT_OPERATOR') && $pid === T_NULLSAFE_OBJECT_OPERATOR)) {
                continue;
            }
        }

        $func_name = $text;
        $call_line = $line;

        // Next non-whitespace must be '('
        $j = $i + 1;
        while ($j < $count && is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE) $j++;
        if ($j >= $count || $tokens[$j] !== '(') {
            continue;
        }

        // Extract argument tokens and split
        $arg_tokens_raw = tokens_between_parens($tokens, $j);
        $args = split_args($arg_tokens_raw);
        if (empty($args)) continue;

        // Determine current scope
        $scope_class    = null;
        $scope_function = null;
        foreach (array_reverse($scope_stack) as $entry) {
            if ($entry['type'] === 'class'    && $scope_class    === null) $scope_class    = $entry['name'];
            if ($entry['type'] === 'function' && $scope_function === null) $scope_function = $entry['name'];
        }

        $edge_type = HOOK_FUNCTIONS[$func_name];
        $hook_type = in_array($func_name, ACTION_FUNCTIONS) ? 'action' : 'filter';

        list($hook_name, $dynamic, $raw_expr) = extract_hook_name($args[0]);

        $doc_comment = find_doc_comment($tokens, $i);

        $callback       = null;
        $callback_type  = null;
        $callback_class = null;
        $callback_method = null;
        $priority       = 10;

        if ($edge_type === 'listens') {
            if (count($args) >= 2) {
                $cb = extract_callback($args[1], $scope_class);
                $callback       = $cb['callback'];
                $callback_type  = $cb['callback_type'];
                $callback_class = $cb['callback_class'];
                $callback_method = $cb['callback_method'];
            }
            if (count($args) >= 3) {
                $priority = extract_priority($args[2]);
            }
        }

        $results[] = [
            'func'            => $func_name,
            'edge_type'       => $edge_type,
            'hook_type'       => $hook_type,
            'hook_name'       => $hook_name,
            'dynamic'         => $dynamic,
            'raw_expression'  => $raw_expr,
            'callback'        => $callback,
            'callback_type'   => $callback_type,
            'callback_class'  => $callback_class,
            'callback_method' => $callback_method,
            'priority'        => $priority,
            'file'            => $filepath,
            'line'            => $call_line,
            'source'          => $source_label,
            'scope_class'     => $scope_class,
            'scope_function'  => $scope_function,
            'doc_comment'     => $doc_comment,
        ];

        $i = $j; // advance past closing ')'
    }

    return $results;
}

// ── Graph builder ───────────────────────────────────────────

$_dynamic_counter = 0;

function hook_id($call) {
    global $_dynamic_counter;
    $name = $call['hook_name'];
    if ($name === null) {
        $_dynamic_counter++;
        return "hook::dynamic_{$_dynamic_counter}";
    }
    return "hook::{$name}";
}

function make_source_label($dir) {
    return basename(rtrim($dir, DIRECTORY_SEPARATOR));
}

function relative_path($filepath, $base_dir) {
    $fp = realpath($filepath) ?: $filepath;
    $bd = rtrim(realpath($base_dir) ?: $base_dir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    if (strpos($fp, $bd) === 0) {
        return substr($fp, strlen($bd));
    }
    return $filepath;
}

function find_base_dir($filepath, $scanned_dirs) {
    $fp = realpath($filepath) ?: $filepath;
    foreach ($scanned_dirs as $d) {
        $abs  = realpath($d) ?: $d;
        $sep  = rtrim($abs, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
        if (strpos($fp, $sep) === 0 || $fp === $abs) return $d;
    }
    return dirname($filepath);
}

function build_graph($hook_calls, $scanned_dirs, $total_files = 0) {
    global $_dynamic_counter;
    $_dynamic_counter = 0;

    $source_labels = [];
    foreach ($scanned_dirs as $d) {
        $source_labels[realpath($d) ?: $d] = make_source_label($d);
    }
    $source_label_list = array_map('make_source_label', $scanned_dirs);

    $hook_nodes    = [];
    $file_nodes    = [];
    $edges         = [];
    $dynamic_count = 0;

    foreach ($hook_calls as $call) {
        $hid      = hook_id($call);
        $base_dir = find_base_dir($call['file'], $scanned_dirs);
        $abs_base = realpath($base_dir) ?: $base_dir;
        $source   = $source_labels[$abs_base] ?? basename($base_dir);
        $rel_path = relative_path($call['file'], $base_dir);
        $file_id  = "file::{$source}::{$rel_path}";

        if (!isset($hook_nodes[$hid])) {
            $hook_nodes[$hid] = [
                'id'           => $hid,
                'type'         => 'hook',
                'hook_type'    => $call['hook_type'],
                'name'         => $call['hook_name'] ?: str_replace('hook::', '', $hid),
                'fire_count'   => 0,
                'listen_count' => 0,
                'dynamic'      => $call['dynamic'],
                'sources'      => [],
            ];
            if ($call['dynamic']) {
                $hook_nodes[$hid]['raw_expression'] = $call['raw_expression'];
                $dynamic_count++;
            }
        }

        if (!in_array($source, $hook_nodes[$hid]['sources'])) {
            $hook_nodes[$hid]['sources'][] = $source;
        }

        if ($call['edge_type'] === 'fires') {
            $hook_nodes[$hid]['fire_count']++;
        } else {
            $hook_nodes[$hid]['listen_count']++;
        }

        if (!isset($file_nodes[$file_id])) {
            $file_nodes[$file_id] = [
                'id'         => $file_id,
                'type'       => 'file',
                'path'       => $rel_path,
                'source'     => $source,
                'hook_count' => 0,
            ];
        }
        $file_nodes[$file_id]['hook_count']++;

        $edge = [
            'source' => $file_id,
            'target' => $hid,
            'type'   => $call['edge_type'],
            'line'   => $call['line'],
        ];
        if ($call['callback'] !== null) {
            $edge['callback'] = $call['callback'];
        }
        if ($call['edge_type'] === 'listens') {
            $edge['priority'] = $call['priority'];
        }
        foreach (['callback_type', 'callback_class', 'callback_method', 'scope_class', 'scope_function', 'doc_comment'] as $f) {
            if (isset($call[$f]) && $call[$f] !== null) {
                $edge[$f] = $call[$f];
            }
        }
        $edges[] = $edge;
    }

    // Finalize hook nodes
    foreach ($hook_nodes as &$node) {
        sort($node['sources']);
        $node['overlap'] = count($node['sources']) >= 2;
        if ($node['overlap']) {
            $node['sourceIndex'] = -1;
        } else {
            $idx = array_search($node['sources'][0], $source_label_list);
            $node['sourceIndex'] = $idx !== false ? $idx : 0;
        }
    }
    unset($node);

    $sorted_hooks = array_values($hook_nodes);
    usort($sorted_hooks, function ($a, $b) { return strcmp($a['id'], $b['id']); });

    $sorted_files = array_values($file_nodes);
    usort($sorted_files, function ($a, $b) { return strcmp($a['id'], $b['id']); });

    return [
        'metadata' => [
            'scanned_dirs'  => array_map(function ($d) { return realpath($d) ?: $d; }, $scanned_dirs),
            'source_labels' => $source_label_list,
            'total_files'   => $total_files,
            'total_hooks'   => count($sorted_hooks),
            'dynamic_hooks' => $dynamic_count,
            'scan_date'     => gmdate('c'),
        ],
        'nodes' => array_merge($sorted_hooks, $sorted_files),
        'edges' => $edges,
    ];
}

function filter_graph_by_overlap($graph) {
    $original_hooks = array_filter($graph['nodes'], function ($n) { return $n['type'] === 'hook'; });

    $keep_ids = [];
    foreach ($original_hooks as $n) {
        if (count($n['sources']) >= 2) $keep_ids[$n['id']] = true;
    }

    $kept_edges = array_values(array_filter($graph['edges'], function ($e) use ($keep_ids) {
        return isset($keep_ids[$e['target']]);
    }));

    $kept_file_ids  = [];
    $file_edge_cnt  = [];
    foreach ($kept_edges as $e) {
        $kept_file_ids[$e['source']] = true;
        $file_edge_cnt[$e['source']] = ($file_edge_cnt[$e['source']] ?? 0) + 1;
    }

    $kept_hooks = [];
    foreach ($original_hooks as $n) {
        if (isset($keep_ids[$n['id']])) $kept_hooks[] = $n;
    }

    $kept_files = [];
    foreach ($graph['nodes'] as $n) {
        if ($n['type'] === 'file' && isset($kept_file_ids[$n['id']])) {
            $n['hook_count'] = $file_edge_cnt[$n['id']] ?? 0;
            $kept_files[] = $n;
        }
    }

    usort($kept_hooks, function ($a, $b) { return strcmp($a['id'], $b['id']); });
    usort($kept_files, function ($a, $b) { return strcmp($a['id'], $b['id']); });

    $meta = $graph['metadata'];
    $meta['overlap_filter']        = true;
    $meta['pre_filter_total_hooks'] = $graph['metadata']['total_hooks'];
    $meta['total_hooks']           = count($kept_hooks);
    $meta['dynamic_hooks']         = count(array_filter($kept_hooks, function ($n) { return !empty($n['dynamic']); }));

    return [
        'metadata' => $meta,
        'nodes'    => array_merge($kept_hooks, $kept_files),
        'edges'    => $kept_edges,
    ];
}

// ── File discovery ──────────────────────────────────────────

/**
 * Check whether a relative path matches any of the exclude patterns.
 *
 * Patterns are matched as path-segment sequences against the (normalized)
 * relative path — so "tests" matches `foo/tests/bar.php` but not
 * `tests-helper.php`, and "packages/e2e-tests" matches the nested folder
 * but not `packages/e2e-tests-utils/foo.php`.
 */
function path_matches_excludes($rel, $exclude_dirs) {
    if (empty($exclude_dirs)) return false;
    $norm = '/' . trim(str_replace('\\', '/', $rel), '/') . '/';
    foreach ($exclude_dirs as $pat) {
        $p = trim(str_replace('\\', '/', $pat), '/');
        if ($p === '') continue;
        if (strpos($norm, '/' . $p . '/') !== false) return true;
    }
    return false;
}

function find_php_files($directory, $exclude_dirs = []) {
    $directory = rtrim($directory, DIRECTORY_SEPARATOR);
    if (!is_dir($directory)) {
        fwrite(STDERR, "Error: $directory is not a directory\n");
        exit(1);
    }

    $excluded = function ($rel) use ($exclude_dirs) {
        return path_matches_excludes($rel, $exclude_dirs);
    };

    // Try git ls-files (respects .gitignore)
    $descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $proc = @proc_open(
        'git ls-files --cached --others --exclude-standard -z "*.php"',
        $descriptors, $pipes, $directory
    );
    if ($proc !== false) {
        fclose($pipes[0]);
        $stdout = stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        if (proc_close($proc) === 0) {
            $files = [];
            foreach (explode("\0", $stdout) as $f) {
                $f = trim($f);
                if ($f === '' || $excluded($f)) continue;
                $full = $directory . DIRECTORY_SEPARATOR . $f;
                if (file_exists($full)) $files[] = $full;
            }
            sort($files);
            return $files;
        }
    }

    // Fallback: recursive glob
    $files = [];
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );
    foreach ($it as $file) {
        if ($file->getExtension() !== 'php') continue;
        $rel = substr($file->getPathname(), strlen($directory) + 1);
        if ($excluded($rel)) continue;
        $files[] = $file->getPathname();
    }
    sort($files);
    return $files;
}

// ── CLI ─────────────────────────────────────────────────────

function parse_cli_args($argv) {
    $args = [
        'dirs'         => [],
        'output'       => null,
        'overlap_only' => false,
        'exclude'      => '',
        'print_path'   => false,
        'help'         => false,
    ];
    $n = count($argv);
    for ($i = 1; $i < $n; $i++) {
        switch ($argv[$i]) {
            case '-o': case '--output':
                if ($i + 1 < $n) $args['output'] = $argv[++$i];
                break;
            case '--overlap-only':
                $args['overlap_only'] = true;
                break;
            case '--exclude':
                if ($i + 1 < $n) $args['exclude'] = $argv[++$i];
                break;
            case '--print-path':
                $args['print_path'] = true;
                break;
            case '-h': case '--help':
                $args['help'] = true;
                break;
            default:
                if ($argv[$i][0] !== '-') $args['dirs'][] = $argv[$i];
                break;
        }
    }
    return $args;
}

function build_help_text() {
    $help = <<<'HELP'
Usage: php hooks_graph.php [options] DIR [DIR...]

Scan WordPress codebases and build a hook relationship graph.

Arguments:
  DIR                   One or more directories to scan for PHP files.

Options:
  -o, --output PATH     Output JSON file path
                        (default: <project>/storage/<dir-names>.json).
  --overlap-only        Only output hooks present in 2+ scanned directories.
                        Useful for finding shared integration points between
                        a core codebase and plugins.
  --exclude a,b,c       Comma-separated list of path patterns to exclude
                        (in addition to .gitignore). Each pattern is matched
                        as a path-segment sequence against the relative path,
                        so a plain folder name like `tests` matches any
                        `tests/` directory, and a nested pattern like
                        `packages/e2e-tests` matches only that specific path.
                        Partial folder names (e.g. `tests-helper.php`) are
                        NOT matched by `tests`.
  --print-path          Print only the absolute path to the written JSON on
                        stdout; route the pretty UI output to stderr. Used
                        by the `hooksgraph` launcher to capture the path.
  -h, --help            Show this help message.

Examples:
  php hooks_graph.php ~/Code/wordpress
  php hooks_graph.php ~/Code/wordpress ~/Code/my-plugin --overlap-only
  php hooks_graph.php ~/Code/wordpress --exclude vendor,tests,node_modules
  php hooks_graph.php ~/Code/wordpress -o storage/wp-core.json

Supported hook functions:
  do_action, do_action_ref_array          fires an action hook
  apply_filters, apply_filters_ref_array  fires a filter hook
  add_action                              listens to an action hook
  add_filter                              listens to a filter hook

Output format:
  The output JSON contains three top-level keys:

    nodes     Hook nodes (name, type, fire/listen counts, sources)
              and file nodes (path, source label).
    edges     Connections between files and hooks (type, line, callback).
    metadata  Scan summary (dirs, file count, hook count, timestamp).

Viewing results:
  bin/hooksgraph DIR              parse + serve + open the viewer in one step
  npm run serve -- PATH.json      serve the viewer against an already-parsed JSON
                                  (omit the path to use the most recent in storage/)

HELP;

    $invoked_as = getenv('HOOKSGRAPH_INVOKED_AS');
    if ($invoked_as === false || $invoked_as === '') {
        return $help;
    }

    $replacements = [
        'Usage: php hooks_graph.php'       => "Usage: $invoked_as",
        'php hooks_graph.php '             => "$invoked_as ",
        'bin/hooksgraph DIR              ' => 'hooksgraph <dir>                ',
        'npm run serve -- PATH.json'       => 'hooksgraph serve PATH.json',
    ];
    return strtr($help, $replacements);
}

function show_help() {
    echo build_help_text();
}

function main() {
    global $argv;

    $args = parse_cli_args($argv);

    if ($args['help']) {
        show_help();
        exit(0);
    }

    if (empty($args['dirs'])) {
        fwrite(STDERR, "Error: at least one directory is required. Use -h for help.\n");
        exit(1);
    }

    // In --print-path mode the pretty UI must go to stderr so stdout can carry
    // only the final output path. Redirect all echo/printf output to STDERR.
    if ($args['print_path']) {
        ob_start(function ($buffer) {
            fwrite(STDERR, $buffer);
            return '';
        });
    }

    // Parse exclude list
    $exclude_dirs = [];
    if ($args['exclude'] !== '') {
        foreach (explode(',', $args['exclude']) as $name) {
            $name = trim($name);
            if ($name !== '') $exclude_dirs[] = $name;
        }
    }

    // Expand ~ and resolve paths
    $dirs = [];
    foreach ($args['dirs'] as $d) {
        if (strpos($d, '~') === 0) {
            $d = getenv('HOME') . substr($d, 1);
        }
        $dirs[] = realpath($d) ?: $d;
    }

    // Default output path
    $output = $args['output'];
    if ($output === null) {
        $names    = array_map(function ($d) { return basename(rtrim($d, DIRECTORY_SEPARATOR)); }, $dirs);
        $filename = implode('-', $names) . '.json';
        $output   = __DIR__ . "/storage/{$filename}";
    }

    // Validate directories
    foreach ($dirs as $d) {
        if (!is_dir($d)) {
            fwrite(STDERR, "Error: $d is not a directory\n");
            exit(1);
        }
    }

    // Discover files
    if (!empty($exclude_dirs)) {
        echo "Excluding folders: " . style(implode(', ', $exclude_dirs), _YELLOW) . "\n";
    }
    echo style("Scanning for PHP files...", _BOLD) . "\n";

    $all_files = [];
    foreach ($dirs as $d) {
        $files = find_php_files($d, $exclude_dirs);
        $label = basename(rtrim($d, DIRECTORY_SEPARATOR));
        foreach ($files as $f) {
            $all_files[] = ['file' => $f, 'dir' => $d, 'label' => $label];
        }
        echo "  " . style($label, _BOLD) . " " . style("\xe2\x94\x80", _DIM) . " " . style(count($files) . " files", _DIM) . "\n";
    }

    $total = count($all_files);
    if ($total === 0) {
        echo "No PHP files found.\n";
        exit(0);
    }

    echo "\n" . style("Parsing $total files...", _BOLD) . "\n";
    $start = microtime(true);

    $all_calls = [];
    $errors    = 0;

    foreach ($all_files as $idx => $entry) {
        $i       = $idx + 1;
        $elapsed = microtime(true) - $start;
        $rate    = $elapsed > 0 ? $i / $elapsed : 0;
        if ($i % 50 === 0 || $i === $total) {
            progress_bar($i, $total, $rate);
        }
        try {
            $calls     = parse_php_file($entry['file'], $entry['label']);
            $all_calls = array_merge($all_calls, $calls);
        } catch (Exception $e) {
            $errors++;
            fwrite(STDERR, "\n  " . style("Warning:", _YELLOW) . " failed to parse {$entry['file']}: {$e->getMessage()}\n");
        }
    }

    $elapsed = microtime(true) - $start;
    echo str_repeat(' ', 60) . "\r";
    echo "  " . style(sprintf("Parsed %d files in %.1fs", $total, $elapsed), _GREEN) . "\n";

    // Build graph
    echo "\n" . style("Building graph...", _BOLD) . "\n";
    $graph = build_graph($all_calls, $dirs, $total);

    if ($args['overlap_only']) {
        $graph = filter_graph_by_overlap($graph);
        echo "  Filtered to hooks shared across 2+ repos\n";
    }

    // Write output
    $output_dir = dirname($output);
    if (!is_dir($output_dir)) {
        mkdir($output_dir, 0755, true);
    }
    file_put_contents($output, json_encode($graph, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

    // ── Summary ──
    $meta         = $graph['metadata'];
    $hook_nodes   = array_filter($graph['nodes'], function ($n) { return $n['type'] === 'hook'; });
    $file_nodes   = array_filter($graph['nodes'], function ($n) { return $n['type'] === 'file'; });
    $action_hooks = array_filter($hook_nodes, function ($n) { return $n['hook_type'] === 'action'; });
    $filter_hooks = array_filter($hook_nodes, function ($n) { return $n['hook_type'] === 'filter'; });

    $hotspots = array_values($hook_nodes);
    usort($hotspots, function ($a, $b) {
        return ($b['fire_count'] + $b['listen_count']) - ($a['fire_count'] + $a['listen_count']);
    });
    $hotspots = array_slice($hotspots, 0, 5);

    // Scan
    section("Scan");
    row("Files scanned",   $meta['total_files']);
    row("Files with hooks", count($file_nodes));
    if ($errors) {
        echo style("  Parse errors    ", _DIM) . style(sprintf("%5d", $errors), _BOLD, _YELLOW) . "\n";
    }

    // Hooks
    $sep = style("\xe2\x94\x82", _DIM);
    section("Hooks");
    $extras = "$sep  Actions " . style(count($action_hooks), _BOLD) . "  $sep  Filters " . style(count($filter_hooks), _BOLD);
    row("Total hooks",   $meta['total_hooks'], $extras);
    row("Dynamic hooks", $meta['dynamic_hooks']);
    row("Total edges",   count($graph['edges']));
    if (!empty($meta['overlap_filter'])) {
        row("Overlap filter",    "on");
        row("Pre-filter hooks",  $meta['pre_filter_total_hooks']);
    }

    // Top Hooks
    if (!empty($hotspots)) {
        section("Top Hooks");
        foreach ($hotspots as $h) {
            $conn = $h['fire_count'] + $h['listen_count'];
            $name = $h['name'];
            if (strlen($name) > 32) $name = substr($name, 0, 30) . "..";
            $fires   = style("{$h['fire_count']} fires", _DIM);
            $listens = style("{$h['listen_count']} listens", _DIM);
            printf("  %-34s%s  %s  %s  %s\n", $name, style(sprintf("%4d", $conn), _BOLD), $sep, $fires, $listens);
        }
    }

    // Output
    section("Output");
    echo "  " . style($output, _CYAN) . "\n";

    // In --print-path mode: flush the pretty output to stderr, close the
    // buffer, then emit only the absolute path on stdout.
    if ($args['print_path']) {
        ob_end_flush();
        $abs = realpath($output);
        echo ($abs !== false ? $abs : $output) . "\n";
    }
}

if (PHP_SAPI === 'cli' && !defined('HOOKS_GRAPH_TESTING')) {
    main();
}
