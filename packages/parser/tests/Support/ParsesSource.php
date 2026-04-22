<?php

declare(strict_types=1);

namespace HooksGraph\Tests\Support;

use HooksGraph\Parser\FileParser;

/**
 * Shared helper: write a snippet of PHP to a temp file and run the parser against it.
 */
trait ParsesSource
{
    /**
     * @return list<array<string, mixed>>
     */
    protected function parseSource(string $code, string $sourceLabel = 'test'): array
    {
        $path = tempnam(sys_get_temp_dir(), 'hg_test_');
        file_put_contents($path, $code);
        try {
            return FileParser::parse($path, $sourceLabel);
        } finally {
            @unlink($path);
        }
    }
}
