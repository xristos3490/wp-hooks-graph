<?php

declare(strict_types=1);

namespace HooksGraph\Cli;

/**
 * TTY-aware console output: styling, sections, rows, and the parser progress bar.
 */
final class Console
{
    public const BOLD    = "\033[1m";
    public const DIM     = "\033[2m";
    public const RESET   = "\033[0m";
    public const CYAN    = "\033[36m";
    public const GREEN   = "\033[32m";
    public const YELLOW  = "\033[33m";
    public const RED     = "\033[31m";
    public const MAGENTA = "\033[35m";

    private bool $isTty;

    public function __construct($stream = STDOUT)
    {
        if (function_exists('posix_isatty')) {
            $this->isTty = @posix_isatty($stream);
        } elseif (function_exists('stream_isatty')) {
            $this->isTty = @stream_isatty($stream);
        } else {
            $this->isTty = false;
        }
    }

    public function style(string|int $text, string ...$codes): string
    {
        if (!$this->isTty || empty($codes)) {
            return (string) $text;
        }
        return implode('', $codes) . $text . self::RESET;
    }

    public function section(string $title): void
    {
        $line   = $this->style(str_repeat("\xe2\x94\x80", 45), self::DIM);
        $header = $this->style(" $title", self::BOLD, self::CYAN);
        echo "\n$line\n$header\n$line\n";
    }

    public function row(string $label, int|string $value, string $extra = ''): void
    {
        $lbl = $this->style(sprintf('  %-18s', $label), self::DIM);
        $val = $this->style(sprintf('%5s', (string) $value), self::BOLD);
        echo $extra !== '' ? "$lbl$val  $extra\n" : "$lbl$val\n";
    }

    public function progressBar(int $current, int $total, float $rate, int $width = 25): void
    {
        $filled  = $total > 0 ? (int) ($width * $current / $total) : 0;
        $bar     = str_repeat("\xe2\x96\x88", $filled) . str_repeat("\xe2\x96\x91", $width - $filled);
        $barStr  = $this->style($bar, self::GREEN);
        $rateStr = $this->style(sprintf('%.0f/sec', $rate), self::DIM);
        echo "  $barStr $current/$total  $rateStr\r";
    }
}
