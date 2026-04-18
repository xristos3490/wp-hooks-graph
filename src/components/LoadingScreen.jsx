import { useRef } from 'react';
import { Button } from '@wordpress/components';

export default function LoadingScreen({ onFileLoad }) {
  const inputRef = useRef(null);

  function handleChange(e) {
    const file = e.target.files[0];
    if (file) onFileLoad(file);
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
    }}>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{
          fontSize: 'var(--wpds-font-size-xl)',
          fontWeight: 'var(--wpds-font-weight-medium)',
          marginBottom: 'var(--wpds-dimension-gap-sm)',
        }}>
          Hooks Graph
        </h2>
        <p style={{
          fontSize: 'var(--wpds-font-size-md)',
          marginBottom: 'var(--wpds-dimension-gap-xl)',
        }}>
          Load a generated hooks file to explore hook relationships.
        </p>
        <Button
          variant="secondary"
          onClick={() => inputRef.current?.click()}
        >
          Upload JSON file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".json"
          onChange={handleChange}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}
