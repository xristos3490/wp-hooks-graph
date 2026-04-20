<?php
// Router for `php -S` — serves the parsed hooks JSON at /hooks.json,
// and delegates everything else to the built-in static server rooted at dist/.

$json = getenv('HOOKS_JSON');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

if ($path === '/hooks.json') {
    if (!$json || !is_file($json)) {
        http_response_code(404);
        return true;
    }
    header('Content-Type: application/json');
    readfile($json);
    return true;
}

return false;
