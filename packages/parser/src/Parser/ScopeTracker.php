<?php

declare(strict_types=1);

namespace HooksGraph\Parser;

/**
 * Tracks class / function scope during a token walk.
 *
 * Each entry is the scope opened at a given brace depth; when that brace closes
 * the entry is popped off.
 */
final class ScopeTracker
{
    /** @var list<array{type: string, name: ?string, depth: int}> */
    private array $stack = [];

    private int $braceDepth = 0;

    public function openBrace(): void
    {
        $this->braceDepth++;
    }

    public function closeBrace(): void
    {
        $this->braceDepth--;
        while (!empty($this->stack) && end($this->stack)['depth'] === $this->braceDepth) {
            array_pop($this->stack);
        }
    }

    public function pushClass(string $name): void
    {
        $this->stack[] = ['type' => 'class', 'name' => $name, 'depth' => $this->braceDepth];
    }

    public function pushFunction(string $name): void
    {
        $this->stack[] = ['type' => 'function', 'name' => $name, 'depth' => $this->braceDepth];
    }

    public function pushAnonymous(): void
    {
        $this->stack[] = ['type' => 'anon', 'name' => null, 'depth' => $this->braceDepth];
    }

    public function currentClass(): ?string
    {
        foreach (array_reverse($this->stack) as $entry) {
            if ($entry['type'] === 'class') {
                return $entry['name'];
            }
        }
        return null;
    }

    public function currentFunction(): ?string
    {
        foreach (array_reverse($this->stack) as $entry) {
            if ($entry['type'] === 'function') {
                return $entry['name'];
            }
        }
        return null;
    }
}
