import { useRef, useState, useCallback } from 'react';
import { Button, EmptyState } from '@wordpress/ui';
import { upload } from '@wordpress/icons';
import Logo from './Logo';

export default function LoadingScreen({ onFileLoad }) {
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

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    dragCounter.current = 0;
    const file = e.dataTransfer.files[0];
    if (file) onFileLoad(file);
  }, [onFileLoad]);

  return (
    <div
      className={`loading-screen ${dragging ? 'loading-screen--dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <EmptyState.Root>
        <EmptyState.Icon icon={upload} />
        <EmptyState.Title><Logo /></EmptyState.Title>
        <EmptyState.Description>
          {dragging
            ? 'Drop your JSON file here'
            : 'Drag & drop a hooks file, or click to browse.'}
        </EmptyState.Description>
        <EmptyState.Actions>
          <Button
            variant="outline"
            onClick={() => inputRef.current?.click()}
          >
            Browse files
          </Button>
        </EmptyState.Actions>
      </EmptyState.Root>
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
