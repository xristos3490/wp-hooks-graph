import { useRef, useCallback, useMemo, useState } from 'react';
import {
  SearchControl,
  __experimentalToggleGroupControl as ToggleGroupControl,
  __experimentalToggleGroupControlOption as ToggleGroupControlOption,
} from '@wordpress/components';
import { Button, IconButton, Popover, Stack } from '@wordpress/ui';
import { category, file, download } from '@wordpress/icons';
import { useGraphContext } from '../context/GraphContext';
import { useSizing } from '../context/SizingContext';
import { exportSigmaToPng } from '../lib/sigma-export';
import { contrastForegroundColors } from '../lib/contrast';

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const SCALE_OPTIONS = ['1', '2'];

export default function SearchOverlay() {
  const { setSearchQuery, isLargeGraph, groupBy, setGroupBy, sigmaRef } = useGraphContext();
  const { sizing } = useSizing();
  const [inputValue, setInputValue] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScale, setExportScale] = useState('2');
  const [isExporting, setIsExporting] = useState(false);
  const inputRef = useRef(null);

  const iconStyleVars = useMemo(() => {
    const c = contrastForegroundColors(sizing.canvasBg);
    return {
      '--wp-ui-button-foreground-color': c.idle,
      '--wp-ui-button-foreground-color-active': c.hover,
      '--wp-ui-button-background-color-active': c.hoverBg,
      '--wp-ui-button-border-color-active': c.hoverBg,
    };
  }, [sizing.canvasBg]);

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
    setGroupBy(groupBy === 'file' ? 'class' : 'file');
  }

  async function handleExport() {
    const sigma = sigmaRef && sigmaRef.current;
    if (!sigma) return;
    setIsExporting(true);
    try {
      await exportSigmaToPng(sigma, {
        scale: Number(exportScale),
        background: sizing.canvasBg || '#ffffff',
      });
      setExportOpen(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('PNG export failed', err);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="search-overlay">
      <div className="search-overlay__wrapper">
        <div className="search-overlay__left-btn">
          <IconButton
            onClick={handleToggleGroupBy}
            icon={groupBy === 'class' ? category : file}
            label={groupBy === 'class' ? 'Switch to File view' : 'Switch to Class view'}
            variant="minimal"
            tone="neutral"
            size="small"
            style={iconStyleVars}
          />
        </div>

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

        <div className="search-overlay__right-btn">
          <Popover.Root open={exportOpen} onOpenChange={setExportOpen}>
            <Popover.Trigger
              render={
                <IconButton
                  icon={download}
                  label="Export as PNG"
                  variant="minimal"
                  tone="neutral"
                  size="small"
                  style={iconStyleVars}
                />
              }
            />
            <Popover.Popup style={popupStyle} side="bottom" align="end">
              <Popover.Title style={{ marginBottom: 'var(--wpds-dimension-gap-sm)' }}>
                Export PNG
              </Popover.Title>
              <Popover.Description
                style={{
                  marginBottom: 'var(--wpds-dimension-gap-sm)',
                  fontSize: 'var(--wpds-typography-font-size-sm)',
                  color: 'var(--wpds-color-fg-content-neutral-weak)',
                }}
              >
                Choose a resolution. Higher scales render the graph at higher pixel density.
              </Popover.Description>
              <ToggleGroupControl
                __next40pxDefaultSize
                __nextHasNoMarginBottom
                isBlock
                label="Resolution"
                hideLabelFromVision
                value={exportScale}
                onChange={(v) => setExportScale(v || '2')}
              >
                {SCALE_OPTIONS.map((s) => (
                  <ToggleGroupControlOption key={s} value={s} label={`${s}×`} />
                ))}
              </ToggleGroupControl>
              <Stack
                direction="row"
                justify="flex-end"
                gap="sm"
                style={{ marginTop: 'var(--wpds-dimension-gap-md)' }}
              >
                <Popover.Close
                  render={
                    <Button variant="minimal" tone="neutral" size="compact">
                      Cancel
                    </Button>
                  }
                />
                <Button
                  variant="solid"
                  tone="brand"
                  size="compact"
                  loading={isExporting}
                  onClick={handleExport}
                >
                  Download
                </Button>
              </Stack>
            </Popover.Popup>
          </Popover.Root>
        </div>
      </div>
    </div>
  );
}

const popupStyle = {
  padding: 'var(--wpds-dimension-gap-md)',
  minWidth: 240,
};
