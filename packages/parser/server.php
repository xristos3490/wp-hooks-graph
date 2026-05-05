<?php
// Router for `php -S` — serves the parsed hooks JSON at /hooks.json,
// and delegates everything else to the built-in static server rooted at dist/.

$json = getenv('HOOKS_JSON');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if ($path === '/hooks.json') {
    if (!$json || !is_file($json)) {
        // 204 (not 404) — the homepage probes this endpoint and "no JSON bound" is a normal state.
        http_response_code(204);
        return true;
    }
    header('Content-Type: application/json');
    readfile($json);
    return true;
}

if ($path === '/demo.json') {
    $dist = getenv('HOOKS_DIST_DIR') ?: null;
    $dir = $dist && is_dir($dist . '/parsed') ? $dist . '/parsed' : null;
    $first = null;
    if ($dir) {
        $files = glob($dir . '/*.json') ?: [];
        sort($files);
        if ($files) $first = $files[0];
    }
    if (!$first) {
        http_response_code(204);
        return true;
    }
    header('Content-Type: application/json');
    readfile($first);
    return true;
}

return false;
