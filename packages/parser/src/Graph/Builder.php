<?php

declare(strict_types=1);

namespace HooksGraph\Graph;

/**
 * Builds the hook-graph JSON shape from parsed hook-call records.
 */
final class Builder
{
    private int $dynamicCounter = 0;

    /**
     * @param list<array<string, mixed>> $hookCalls
     * @param list<string>               $scannedDirs
     */
    public function build(array $hookCalls, array $scannedDirs, int $totalFiles = 0): array
    {
        $this->dynamicCounter = 0;

        $sourceLabels = [];
        foreach ($scannedDirs as $d) {
            $sourceLabels[realpath($d) ?: $d] = self::sourceLabel($d);
        }
        $sourceLabelList = array_map([self::class, 'sourceLabel'], $scannedDirs);

        $hookNodes    = [];
        $fileNodes    = [];
        $edges        = [];
        $dynamicCount = 0;

        foreach ($hookCalls as $call) {
            $hid     = $this->hookId($call);
            $baseDir = self::findBaseDir($call['file'], $scannedDirs);
            $absBase = realpath($baseDir) ?: $baseDir;
            $source  = $sourceLabels[$absBase] ?? basename($baseDir);
            $relPath = self::relativePath($call['file'], $baseDir);
            $fileId  = "file::{$source}::{$relPath}";

            if (!isset($hookNodes[$hid])) {
                $hookNodes[$hid] = [
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
                    $hookNodes[$hid]['raw_expression'] = $call['raw_expression'];
                    $dynamicCount++;
                }
            }

            if (!in_array($source, $hookNodes[$hid]['sources'], true)) {
                $hookNodes[$hid]['sources'][] = $source;
            }

            if ($call['edge_type'] === 'fires') {
                $hookNodes[$hid]['fire_count']++;
            } else {
                $hookNodes[$hid]['listen_count']++;
            }

            if (!isset($fileNodes[$fileId])) {
                $fileNodes[$fileId] = [
                    'id'         => $fileId,
                    'type'       => 'file',
                    'path'       => $relPath,
                    'source'     => $source,
                    'hook_count' => 0,
                ];
            }
            $fileNodes[$fileId]['hook_count']++;

            $edge = [
                'source' => $fileId,
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
            foreach (['effects', 'targets', 'called_apis', 'filter_behavior', 'callback_body_start_line', 'callback_body_end_line'] as $f) {
                if (array_key_exists($f, $call) && $call[$f] !== null) {
                    $edge[$f] = $call[$f];
                }
            }
            $edges[] = $edge;
        }

        foreach ($hookNodes as &$node) {
            sort($node['sources']);
            $node['overlap'] = count($node['sources']) >= 2;
            if ($node['overlap']) {
                $node['sourceIndex'] = -1;
            } else {
                $idx = array_search($node['sources'][0], $sourceLabelList, true);
                $node['sourceIndex'] = $idx !== false ? $idx : 0;
            }
        }
        unset($node);

        $sortedHooks = array_values($hookNodes);
        usort($sortedHooks, static fn ($a, $b) => strcmp($a['id'], $b['id']));

        $sortedFiles = array_values($fileNodes);
        usort($sortedFiles, static fn ($a, $b) => strcmp($a['id'], $b['id']));

        return [
            'metadata' => [
                'scanned_dirs'  => array_map(static fn ($d) => realpath($d) ?: $d, $scannedDirs),
                'source_labels' => $sourceLabelList,
                'total_files'   => $totalFiles,
                'total_hooks'   => count($sortedHooks),
                'dynamic_hooks' => $dynamicCount,
                'scan_date'     => gmdate('c'),
            ],
            'nodes' => array_merge($sortedHooks, $sortedFiles),
            'edges' => $edges,
        ];
    }

    private function hookId(array $call): string
    {
        $name = $call['hook_name'];
        if ($name === null) {
            $this->dynamicCounter++;
            return "hook::dynamic_{$this->dynamicCounter}";
        }
        return "hook::{$name}";
    }

    private static function sourceLabel(string $dir): string
    {
        return basename(rtrim($dir, DIRECTORY_SEPARATOR));
    }

    private static function relativePath(string $filepath, string $baseDir): string
    {
        $fp = realpath($filepath) ?: $filepath;
        $bd = rtrim(realpath($baseDir) ?: $baseDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
        if (strpos($fp, $bd) === 0) {
            return substr($fp, strlen($bd));
        }
        return $filepath;
    }

    private static function findBaseDir(string $filepath, array $scannedDirs): string
    {
        $fp = realpath($filepath) ?: $filepath;
        foreach ($scannedDirs as $d) {
            $abs = realpath($d) ?: $d;
            $sep = rtrim($abs, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
            if (strpos($fp, $sep) === 0 || $fp === $abs) {
                return $d;
            }
        }
        return dirname($filepath);
    }
}
