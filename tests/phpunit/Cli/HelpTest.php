<?php

declare(strict_types=1);

namespace HooksGraph\Tests\Cli;

use HooksGraph\Cli\Help;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\TestCase;

/**
 * Help text has two presentations:
 *   - default (env unset) → the original `php hooksgraph.php` branding.
 *   - rebranded (env="hooksgraph parse") → routed from the `hooksgraph` launcher
 *     so Usage, Examples, and the Viewing-results block read as subcommands.
 */
#[CoversClass(Help::class)]
final class HelpTest extends TestCase
{
    protected function tearDown(): void
    {
        putenv('HOOKSGRAPH_INVOKED_AS');
        parent::tearDown();
    }

    public function test_unset_env_keeps_php_hooksgraph_branding(): void
    {
        putenv('HOOKSGRAPH_INVOKED_AS');
        $help = Help::text();
        $this->assertStringContainsString('Usage: php hooksgraph.php [options] DIR [DIR...]', $help);
        $this->assertStringContainsString('php hooksgraph.php ~/Code/wordpress',              $help);
        $this->assertStringContainsString('bin/hooksgraph DIR',                                $help);
        $this->assertStringContainsString('npm run serve -- PATH.json',                        $help);
    }

    public function test_env_rewrites_usage_to_hooksgraph_parse(): void
    {
        putenv('HOOKSGRAPH_INVOKED_AS=hooksgraph parse');
        $this->assertStringContainsString(
            'Usage: hooksgraph parse [options] DIR [DIR...]',
            Help::text()
        );
    }

    public function test_env_removes_php_hooksgraph_references(): void
    {
        putenv('HOOKSGRAPH_INVOKED_AS=hooksgraph parse');
        $help = Help::text();
        $this->assertStringNotContainsString('php hooksgraph.php', $help);
    }

    public function test_env_rewrites_examples_block(): void
    {
        putenv('HOOKSGRAPH_INVOKED_AS=hooksgraph parse');
        $help = Help::text();
        $this->assertStringContainsString('hooksgraph parse ~/Code/wordpress',                                 $help);
        $this->assertStringContainsString('hooksgraph parse ~/Code/wordpress ~/Code/my-plugin --overlap-only', $help);
    }

    public function test_env_rewrites_viewing_results_block(): void
    {
        putenv('HOOKSGRAPH_INVOKED_AS=hooksgraph parse');
        $help = Help::text();
        $this->assertStringContainsString('hooksgraph <dir>',             $help);
        $this->assertStringContainsString('hooksgraph serve PATH.json',   $help);
        $this->assertStringNotContainsString('bin/hooksgraph DIR',        $help);
        $this->assertStringNotContainsString('npm run serve',             $help);
    }
}
