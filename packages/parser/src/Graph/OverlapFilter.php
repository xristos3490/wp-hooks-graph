<?php

declare(strict_types=1);

namespace HooksGraph\Graph;

/**
 * Filters a built graph down to hooks that appear in two or more scanned sources.
 */
final class OverlapFilter
{
    public static function apply(array $graph): array
    {
        $originalHooks = array_filter($graph['nodes'], static fn ($n) => $n['type'] === 'hook');

        $keepIds = [];
        foreach ($originalHooks as $n) {
            if (count($n['sources']) >= 2) {
                $keepIds[$n['id']] = true;
            }
        }

        $keptEdges = array_values(array_filter(
            $graph['edges'],
            static fn ($e) => isset($keepIds[$e['target']])
        ));

        $keptFileIds  = [];
        $fileEdgeCnt  = [];
        foreach ($keptEdges as $e) {
            $keptFileIds[$e['source']] = true;
            $fileEdgeCnt[$e['source']] = ($fileEdgeCnt[$e['source']] ?? 0) + 1;
        }

        $keptHooks = [];
        foreach ($originalHooks as $n) {
            if (isset($keepIds[$n['id']])) {
                $keptHooks[] = $n;
            }
        }

        $keptFiles = [];
        foreach ($graph['nodes'] as $n) {
            if ($n['type'] === 'file' && isset($keptFileIds[$n['id']])) {
                $n['hook_count'] = $fileEdgeCnt[$n['id']] ?? 0;
                $keptFiles[]     = $n;
            }
        }

        usort($keptHooks, static fn ($a, $b) => strcmp($a['id'], $b['id']));
        usort($keptFiles, static fn ($a, $b) => strcmp($a['id'], $b['id']));

        $meta                           = $graph['metadata'];
        $meta['overlap_filter']         = true;
        $meta['pre_filter_total_hooks'] = $graph['metadata']['total_hooks'];
        $meta['total_hooks']            = count($keptHooks);
        $meta['dynamic_hooks']          = count(array_filter($keptHooks, static fn ($n) => !empty($n['dynamic'])));

        return [
            'metadata' => $meta,
            'nodes'    => array_merge($keptHooks, $keptFiles),
            'edges'    => $keptEdges,
        ];
    }
}
