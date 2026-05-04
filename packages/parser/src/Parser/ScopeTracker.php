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
    /** @var list<array{type: string, name: ?string, namespace?: string, depth: int}> */
    private array $stack = [];

    private int $braceDepth = 0;

    private string $currentNamespace = '';

    /** @var list<array{namespace: string, depth: int}> */
    private array $namespaceStack = [];

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
        while (!empty($this->namespaceStack) && end($this->namespaceStack)['depth'] === $this->braceDepth) {
            $entry = array_pop($this->namespaceStack);
            $this->currentNamespace = $entry['namespace'];
        }
    }

    public function pushClass(string $name): void
    {
        $this->stack[] = [
            'type' => 'class',
            'name' => $name,
            'namespace' => $this->currentNamespace,
            'depth' => $this->braceDepth,
        ];
    }

    public function pushFunction(string $name): void
    {
        $this->stack[] = ['type' => 'function', 'name' => $name, 'depth' => $this->braceDepth];
    }

    public function pushAnonymous(): void
    {
        $this->stack[] = ['type' => 'anon', 'name' => null, 'depth' => $this->braceDepth];
    }

    public function pushNamespace(string $name, bool $blockScoped): void
    {
        if ($blockScoped) {
            $this->namespaceStack[] = ['namespace' => $this->currentNamespace, 'depth' => $this->braceDepth];
        } else {
            $this->namespaceStack = [];
        }
        $this->currentNamespace = $name;
    }

    public function currentNamespace(): string
    {
        return $this->currentNamespace;
    }

    public function currentClass(): ?string
    {
        foreach (array_reverse($this->stack) as $entry) {
            if ($entry['type'] === 'class') {
                $ns = $entry['namespace'] ?? '';
                return $ns === '' ? $entry['name'] : $ns . '\\' . $entry['name'];
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
