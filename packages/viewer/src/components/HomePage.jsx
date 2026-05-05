import { useRef, useState, useCallback } from 'react';
import { Button, EmptyState, Stack, Text, Badge } from '@wordpress/ui';
import Logo from './Logo';
import HomePageBackground from './HomePageBackground';
import GitHubLink from './GitHubLink';
import './HomePage.css';

export default function HomePage({ onFileLoad, isLoading, onLoadDemo, hasDemo }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  function handleChange(e) {
    const file = e.target.files[0];
    if (file) onFileLoad(file);
  }

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      dragCounter.current = 0;
      const file = e.dataTransfer.files[0];
      if (file) onFileLoad(file);
    },
    [onFileLoad]
  );

  function getDescription() {
    if (isLoading) return 'Parsing your graph…';
    if (dragging) return 'Release to load this graph';
    if (hasDemo) return 'Drag and drop a hooks JSON file, browse to pick one, or load the demo.';
    return 'Drag and drop a hooks JSON file, or browse to pick one.';
  }
  const description = getDescription();

  return (
    <div
      className={['home-page', dragging && 'home-page--dragging', isLoading && 'home-page--loading']
        .filter(Boolean)
        .join(' ')}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <HomePageBackground />

      <main className="hp-hero">
        <Stack direction="column" align="center" gap="3xl">
          <EmptyState.Root>
            <EmptyState.Visual>
              <Logo showWordmark={false} />
            </EmptyState.Visual>
            <EmptyState.Title>Hooks Graph</EmptyState.Title>
            <EmptyState.Description>{description}</EmptyState.Description>
            <EmptyState.Actions>
              <Button
                onClick={() => inputRef.current?.click()}
                disabled={isLoading}
              >
                {isLoading ? 'Loading…' : 'Browse files'}
              </Button>
              {hasDemo && (
                <Button
                  variant="outline"
                  onClick={onLoadDemo}
                  disabled={isLoading}
                >
                  Load demo
                </Button>
              )}
            </EmptyState.Actions>
          </EmptyState.Root>

          <Stack direction="row" align="center" gap="sm" className="hp-hint">
            <Badge tone="info">Tip</Badge>
            <Text variant="body-sm" tone="muted">
              Generate one with <code>hooksgraph parse &lt;dir&gt;</code>
            </Text>
          </Stack>

          <GitHubLink />
        </Stack>
      </main>

      <input
        ref={inputRef}
        type="file"
        accept=".json"
        onChange={handleChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
