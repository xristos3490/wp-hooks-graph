<?php

declare(strict_types=1);

namespace HooksGraph\Discovery;

use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

/**
 * Finds PHP files under a directory, preferring `git ls-files` (to respect .gitignore)
 * and falling back to a recursive filesystem walk.
 */
final class PhpFileFinder
{
    /**
     * @param list<string> $excludePatterns
     * @return list<string>  absolute file paths
     */
    public static function find(string $directory, array $excludePatterns = []): array
    {
        $directory = rtrim($directory, DIRECTORY_SEPARATOR);
        if (!is_dir($directory)) {
            fwrite(STDERR, "Error: $directory is not a directory\n");
            exit(1);
        }

        $files = self::findViaGit($directory, $excludePatterns);
        if ($files !== null) {
            return $files;
        }
        return self::findViaFilesystem($directory, $excludePatterns);
    }

    /**
     * @return list<string>|null  null when git isn't usable here
     */
    private static function findViaGit(string $directory, array $excludePatterns): ?array
    {
        $descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
        $proc = @proc_open(
            'git ls-files --cached --others --exclude-standard -z "*.php"',
            $descriptors,
            $pipes,
            $directory
        );
        if ($proc === false) {
            return null;
        }
        fclose($pipes[0]);
        $stdout = stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        if (proc_close($proc) !== 0) {
            return null;
        }

        $files = [];
        foreach (explode("\0", $stdout) as $f) {
            $f = trim($f);
            if ($f === '' || ExcludeMatcher::matches($f, $excludePatterns)) {
                continue;
            }
            $full = $directory . DIRECTORY_SEPARATOR . $f;
            if (file_exists($full)) {
                $files[] = $full;
            }
        }
        sort($files);
        return $files;
    }

    /**
     * @return list<string>
     */
    private static function findViaFilesystem(string $directory, array $excludePatterns): array
    {
        $files = [];
        $it    = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($directory, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        foreach ($it as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }
            $rel = substr($file->getPathname(), strlen($directory) + 1);
            if (ExcludeMatcher::matches($rel, $excludePatterns)) {
                continue;
            }
            $files[] = $file->getPathname();
        }
        sort($files);
        return $files;
    }
}
