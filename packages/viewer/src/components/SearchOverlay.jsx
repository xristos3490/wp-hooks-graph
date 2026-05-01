import { useRef, useCallback, useState } from 'react';
import { SearchControl } from '@wordpress/components';
import { IconButton } from '@wordpress/ui';
import { category, file } from '@wordpress/icons';
import { useGraphContext } from '../context/GraphContext';

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export default function SearchOverlay() {
  const { setSearchQuery, isLargeGraph, groupBy, setGroupBy } = useGraphContext();
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);

  const searchDelay = isLargeGraph ? 200 : 80;
  const debouncedSearch = useCallback(
    debounce((value) => setSearchQuery(value), searchDelay),
    [setSearchQuery, searchDelay]
  );

  function handleInput(value) {
    setInputValue(value);
    debouncedSearch(value);
  }

  function handleClose() {
    setInputValue('');
    setSearchQuery('');
  }

  function handleToggleGroupBy() {
    const next = groupBy === 'file' ? 'class' : 'file';
    if (!confirm('Switch to ' + next + ' view?\n\nThis rebuilds the entire graph layout.')) return;
    setGroupBy(next);
  }

  const overlayStyle = {
    position: 'absolute',
    top: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 20,
    width: 'min(540px, calc(100% - 70px))',
  };

  const wrapperStyle = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  };

  return (
    <div style={overlayStyle}>
      <div style={wrapperStyle}>
        <IconButton
          onClick={handleToggleGroupBy}
          icon={groupBy === 'class' ? category : file}
          label={groupBy === 'class' ? 'Switch to File view' : 'Switch to Class view'}
          variant="minimal"
          tone="neutral"
          size="small"
          style={{ position: 'absolute', left: -52, top: '50%', transform: 'translateY(-50%)' }}
        />

        <div style={{ flex: 1, overflow: 'hidden' }}>
          <SearchControl
            __nextHasNoMarginBottom
            ref={inputRef}
            id="graph-search"
            value={inputValue}
            onChange={handleInput}
            onClose={handleClose}
            placeholder="Search hooks, files, paths..."
            size="__unstable-large"
          />
        </div>
      </div>
    </div>
  );
}
