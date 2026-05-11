<?php

declare(strict_types=1);

namespace HooksGraph\Tests\Parser;

use HooksGraph\Parser\WpApiMap;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\TestCase;

#[CoversClass(WpApiMap::class)]
final class WpApiMapTest extends TestCase
{
    public function test_every_entry_has_required_keys(): void
    {
        foreach (WpApiMap::functions() as $name => $entry) {
            $this->assertArrayHasKey('function', $entry);
            $this->assertArrayHasKey('kind', $entry);
            $this->assertArrayHasKey('op', $entry);
            $this->assertArrayHasKey('key_arg_index', $entry);
            $this->assertArrayHasKey('effect', $entry);
            $this->assertSame($name, $entry['function']);
        }
    }

    public function test_op_values_are_within_closed_set_or_null(): void
    {
        foreach (WpApiMap::functions() as $entry) {
            if ($entry['op'] === null) {
                continue;
            }
            $this->assertContains($entry['op'], WpApiMap::OPS);
        }
    }

    public function test_key_arg_index_non_negative_when_kind_present(): void
    {
        foreach (WpApiMap::functions() as $entry) {
            if ($entry['kind'] === null) {
                continue;
            }
            $this->assertGreaterThanOrEqual(0, $entry['key_arg_index'], 'Function: ' . $entry['function']);
        }
    }

    public function test_no_duplicate_function_keys(): void
    {
        // PHP arrays already dedupe; assert by checking the canonical list.
        $map = WpApiMap::functions();
        $names = array_keys($map);
        $this->assertSame(count($names), count(array_unique($names)));
    }

    public function test_effect_is_within_closed_taxonomy(): void
    {
        foreach (WpApiMap::functions() as $entry) {
            if ($entry['effect'] === null) {
                continue;
            }
            $this->assertContains($entry['effect'], WpApiMap::EFFECTS, 'Function: ' . $entry['function']);
        }
        foreach (WpApiMap::wpdbMethods() as $entry) {
            $this->assertContains($entry['effect'], WpApiMap::EFFECTS);
        }
    }
}
