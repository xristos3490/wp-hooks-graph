<?php

declare(strict_types=1);

namespace HooksGraph\Tests\Cli;

use HooksGraph\Cli\Arguments;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\TestCase;

#[CoversClass(Arguments::class)]
final class ArgumentsTest extends TestCase
{
    public function test_exclude_with_space_separated_value(): void
    {
        $a = Arguments::parse(['hooksgraph.php', '.', '--exclude', 'vendor,tests']);
        $this->assertSame('vendor,tests', $a['exclude']);
        $this->assertSame(['.'], $a['dirs']);
    }

    public function test_exclude_inline_value(): void
    {
        $a = Arguments::parse(['hooksgraph.php', '.', '--exclude=packages/e2e-tests,phpunit,test']);
        $this->assertSame('packages/e2e-tests,phpunit,test', $a['exclude']);
        $this->assertSame(['.'], $a['dirs']);
    }

    public function test_output_inline_value(): void
    {
        $a = Arguments::parse(['hooksgraph.php', '.', '--output=/tmp/out.json']);
        $this->assertSame('/tmp/out.json', $a['output']);
    }

    public function test_short_output_takes_next_arg(): void
    {
        $a = Arguments::parse(['hooksgraph.php', '.', '-o', '/tmp/out.json']);
        $this->assertSame('/tmp/out.json', $a['output']);
    }

    public function test_boolean_flags(): void
    {
        $a = Arguments::parse(['hooksgraph.php', '.', '--overlap-only']);
        $this->assertTrue($a['overlap_only']);
    }

    public function test_multiple_dirs_collected_in_order(): void
    {
        $a = Arguments::parse(['hooksgraph.php', 'a', 'b', '--exclude=x', 'c']);
        $this->assertSame(['a', 'b', 'c'], $a['dirs']);
        $this->assertSame('x', $a['exclude']);
    }

    public function test_split_list_trims_whitespace_and_drops_blanks(): void
    {
        $this->assertSame(
            ['test', 'tests', 'packages/e2e-tests'],
            Arguments::splitList('test, tests ,  packages/e2e-tests  ,')
        );
    }

    public function test_split_list_empty_string_returns_empty_array(): void
    {
        $this->assertSame([], Arguments::splitList(''));
    }
}
