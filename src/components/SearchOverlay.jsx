import { useRef, useCallback, useState } from 'react';
import {
  SearchControl,
  Button,
  Tooltip,
  Icon,
} from '@wordpress/components';
import { category, file } from '@wordpress/icons';
import { useGraphContext } from '../context/GraphContext';

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// sun/moon icons are not in @wordpress/icons — keep minimal inline SVGs
const MoonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

export default function SearchOverlay() {
  const { setSearchQuery, isLargeGraph, groupBy, setGroupBy, isLightTheme, currentThemeColors, cyRef } =
    useGraphContext();
  const [inputValue, setInputValue] = useState('');
  const [isLight, setIsLight] = useState(() => document.documentElement.classList.contains('light'));
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

  function handleToggleTheme() {
    document.documentElement.classList.toggle('light');
    const light = document.documentElement.classList.contains('light');
    localStorage.setItem('hooks-graph-theme', light ? 'light' : 'dark');
    setIsLight(light);

    const cy = cyRef.current;
    if (cy) {
      const tc = currentThemeColors();
      cy.style()
        .selector('node[type="hook"]').style({ color: tc.nodeText })
        .selector('node[type="file"]').style({ color: tc.nodeText })
        .selector('node[type="class"]').style({ color: tc.nodeText, 'border-color': tc.classBorder })
        .selector('node.highlighted[type="hook"]').style({
          color: tc.highlightHookText,
          'text-background-color': tc.highlightTextBg,
        })
        .selector('node.highlighted[type="file"]').style({ color: tc.highlightFileText })
        .selector('node.selected-node').style({ 'border-color': tc.selectedBorder })
        .update();
    }
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
    width: 'min(540px, calc(100% - 110px))',
  };

  const wrapperStyle = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  };

  return (
    <div style={overlayStyle}>
      <div style={wrapperStyle}>
        <Tooltip text={groupBy === 'class' ? 'Switch to File view' : 'Switch to Class view'}>
          <Button
            onClick={handleToggleGroupBy}
            icon={<Icon icon={groupBy === 'class' ? category : file} size={18} />}
            label={groupBy === 'class' ? 'Switch to File view' : 'Switch to Class view'}
            style={{ position: 'absolute', left: -52, top: '50%', transform: 'translateY(-50%)' }}
          />
        </Tooltip>

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

        <Tooltip text={isLight ? 'Switch to Dark mode' : 'Switch to Light mode'}>
          <Button
            onClick={handleToggleTheme}
            icon={isLight ? <SunIcon /> : <MoonIcon />}
            label={isLight ? 'Switch to Dark mode' : 'Switch to Light mode'}
            style={{ position: 'absolute', right: -52, top: '50%', transform: 'translateY(-50%)' }}
          />
        </Tooltip>
      </div>
    </div>
  );
}
