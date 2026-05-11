<?php

declare(strict_types=1);

namespace HooksGraph\Parser;

/**
 * Static catalogue of recognised WordPress / PHP-stdlib APIs that produce
 * a structured target and/or an effect tag when seen in a callback body.
 *
 * Shape per entry:
 *   function:       canonical function name (no leading namespace)
 *   kind:           target kind (option, post_meta, ...), or null for IO-only
 *   op:             read | write | check | fire, or null
 *   key_arg_index:  0-based arg index that carries the key literal, or -1
 *   effect:         effect taxonomy tag, or null when the API only emits a target
 */
final class WpApiMap
{
    public const EFFECTS = [
        'reads_option', 'writes_option',
        'reads_post_meta', 'writes_post_meta',
        'reads_user_meta', 'writes_user_meta',
        'reads_term_meta', 'writes_term_meta',
        'reads_transient', 'writes_transient',
        'reads_db', 'writes_db',
        'io_http', 'io_fs', 'io_mail',
        'output', 'redirect', 'enqueue',
        'cache_read', 'cache_write',
        'fires_hook',
    ];

    public const OPS = ['read', 'write', 'check', 'fire'];

    /**
     * @return array<string, array{function:string, kind:?string, op:?string, key_arg_index:int, effect:?string}>
     */
    public static function functions(): array
    {
        static $map = null;
        if ($map !== null) {
            return $map;
        }
        $entries = [
            // ── options ───────────────────────────────────────────
            ['get_option',     'option', 'read',  0, 'reads_option'],
            ['get_site_option','option', 'read',  0, 'reads_option'],
            ['update_option',  'option', 'write', 0, 'writes_option'],
            ['add_option',     'option', 'write', 0, 'writes_option'],
            ['delete_option',  'option', 'write', 0, 'writes_option'],
            ['update_site_option', 'option', 'write', 0, 'writes_option'],
            ['delete_site_option', 'option', 'write', 0, 'writes_option'],
            // ── post_meta ────────────────────────────────────────
            ['get_post_meta',     'post_meta', 'read',  1, 'reads_post_meta'],
            ['add_post_meta',     'post_meta', 'write', 1, 'writes_post_meta'],
            ['update_post_meta',  'post_meta', 'write', 1, 'writes_post_meta'],
            ['delete_post_meta',  'post_meta', 'write', 1, 'writes_post_meta'],
            // ── user_meta ────────────────────────────────────────
            ['get_user_meta',     'user_meta', 'read',  1, 'reads_user_meta'],
            ['add_user_meta',     'user_meta', 'write', 1, 'writes_user_meta'],
            ['update_user_meta',  'user_meta', 'write', 1, 'writes_user_meta'],
            ['delete_user_meta',  'user_meta', 'write', 1, 'writes_user_meta'],
            // ── term_meta ────────────────────────────────────────
            ['get_term_meta',     'term_meta', 'read',  1, 'reads_term_meta'],
            ['add_term_meta',     'term_meta', 'write', 1, 'writes_term_meta'],
            ['update_term_meta',  'term_meta', 'write', 1, 'writes_term_meta'],
            ['delete_term_meta',  'term_meta', 'write', 1, 'writes_term_meta'],
            // ── transients ───────────────────────────────────────
            ['get_transient',     'transient', 'read',  0, 'reads_transient'],
            ['set_transient',     'transient', 'write', 0, 'writes_transient'],
            ['delete_transient',  'transient', 'write', 0, 'writes_transient'],
            ['get_site_transient','transient', 'read',  0, 'reads_transient'],
            ['set_site_transient','transient', 'write', 0, 'writes_transient'],
            ['delete_site_transient','transient', 'write', 0, 'writes_transient'],
            // ── capabilities ─────────────────────────────────────
            ['current_user_can', 'capability', 'check', 0, null],
            ['user_can',         'capability', 'check', 1, null],
            ['author_can',       'capability', 'check', 1, null],
            // ── hooks (when fired inside a callback body) ────────
            ['do_action',               'hook_fire', 'fire', 0, 'fires_hook'],
            ['do_action_ref_array',     'hook_fire', 'fire', 0, 'fires_hook'],
            ['apply_filters',           'hook_fire', 'fire', 0, 'fires_hook'],
            ['apply_filters_ref_array', 'hook_fire', 'fire', 0, 'fires_hook'],
            // ── HTTP ─────────────────────────────────────────────
            ['wp_remote_get',       null, null, -1, 'io_http'],
            ['wp_remote_post',      null, null, -1, 'io_http'],
            ['wp_remote_head',      null, null, -1, 'io_http'],
            ['wp_remote_request',   null, null, -1, 'io_http'],
            ['wp_safe_remote_get',  null, null, -1, 'io_http'],
            ['wp_safe_remote_post', null, null, -1, 'io_http'],
            // ── mail ─────────────────────────────────────────────
            ['wp_mail', null, null, -1, 'io_mail'],
            ['mail',    null, null, -1, 'io_mail'],
            // ── redirect ─────────────────────────────────────────
            ['wp_redirect',      null, null, -1, 'redirect'],
            ['wp_safe_redirect', null, null, -1, 'redirect'],
            // ── output ───────────────────────────────────────────
            ['wp_send_json',         null, null, -1, 'output'],
            ['wp_send_json_success', null, null, -1, 'output'],
            ['wp_send_json_error',   null, null, -1, 'output'],
            ['header',               null, null, -1, 'output'],
            // ── filesystem ───────────────────────────────────────
            ['file_put_contents', null, null, -1, 'io_fs'],
            ['file_get_contents', null, null, -1, 'io_fs'],
            ['fopen',             null, null, -1, 'io_fs'],
            ['fwrite',            null, null, -1, 'io_fs'],
            ['unlink',            null, null, -1, 'io_fs'],
            ['mkdir',             null, null, -1, 'io_fs'],
            ['rmdir',             null, null, -1, 'io_fs'],
            // ── cache ────────────────────────────────────────────
            ['wp_cache_get',    null, null, -1, 'cache_read'],
            ['wp_cache_set',    null, null, -1, 'cache_write'],
            ['wp_cache_delete', null, null, -1, 'cache_write'],
            ['wp_cache_add',    null, null, -1, 'cache_write'],
            // ── enqueue ──────────────────────────────────────────
            ['wp_enqueue_script', null, null, -1, 'enqueue'],
            ['wp_enqueue_style',  null, null, -1, 'enqueue'],
            ['wp_register_script',null, null, -1, 'enqueue'],
            ['wp_register_style', null, null, -1, 'enqueue'],
        ];

        $map = [];
        foreach ($entries as $e) {
            $map[$e[0]] = [
                'function'      => $e[0],
                'kind'          => $e[1],
                'op'            => $e[2],
                'key_arg_index' => $e[3],
                'effect'        => $e[4],
            ];
        }
        return $map;
    }

    /**
     * Methods on the $wpdb global. Keys are method names.
     *
     * @return array<string, array{kind:?string, op:?string, key_arg_index:int, effect:string}>
     */
    public static function wpdbMethods(): array
    {
        static $map = null;
        if ($map !== null) {
            return $map;
        }
        $map = [
            'get_var'     => ['kind' => null,       'op' => null,    'key_arg_index' => -1, 'effect' => 'reads_db'],
            'get_row'     => ['kind' => null,       'op' => null,    'key_arg_index' => -1, 'effect' => 'reads_db'],
            'get_col'     => ['kind' => null,       'op' => null,    'key_arg_index' => -1, 'effect' => 'reads_db'],
            'get_results' => ['kind' => null,       'op' => null,    'key_arg_index' => -1, 'effect' => 'reads_db'],
            'query'       => ['kind' => null,       'op' => null,    'key_arg_index' => -1, 'effect' => 'writes_db'],
            'insert'      => ['kind' => 'db_table', 'op' => 'write', 'key_arg_index' => 0,  'effect' => 'writes_db'],
            'update'      => ['kind' => 'db_table', 'op' => 'write', 'key_arg_index' => 0,  'effect' => 'writes_db'],
            'delete'      => ['kind' => 'db_table', 'op' => 'write', 'key_arg_index' => 0,  'effect' => 'writes_db'],
            'replace'     => ['kind' => 'db_table', 'op' => 'write', 'key_arg_index' => 0,  'effect' => 'writes_db'],
        ];
        return $map;
    }

    /** Known PHP superglobals (canonical without leading `$`). */
    public const SUPERGLOBALS = ['_GET', '_POST', '_REQUEST', '_COOKIE', '_SESSION', '_SERVER', '_FILES', '_ENV'];

    /** Known WP globals (canonical without leading `$`). */
    public const GLOBALS = ['wpdb', 'wp_filter', 'wp_actions', 'wp_query', 'wp', 'post', 'wp_rewrite', 'current_screen', 'pagenow'];

    public static function isSuperglobal(string $varNameNoDollar): bool
    {
        return in_array($varNameNoDollar, self::SUPERGLOBALS, true);
    }

    public static function isGlobal(string $varNameNoDollar): bool
    {
        return in_array($varNameNoDollar, self::GLOBALS, true);
    }
}
