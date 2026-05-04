import { useRef, useCallback, useState } from 'react';
import {
  SearchControl,
  __experimentalToggleGroupControl as ToggleGroupControl,
  __experimentalToggleGroupControlOption as ToggleGroupControlOption,
} from '@wordpress/components';
import { Button, IconButton, Popover, Stack } from '@wordpress/ui';
import { category, file, download } from '@wordpress/icons';
import { useGraphContext } from '../context/GraphContext';
import { exportSigmaToPng } from '../lib/sigma-export';

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
  const [inputValue, setInputValue] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScale, setExportScale] = useState('2');
  const [isExporting, setIsExporting] = useState(false);
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
    setGroupBy(groupBy === 'file' ? 'class' : 'file');
  }

  async function handleExport() {
    const sigma = sigmaRef && sigmaRef.current;
    if (!sigma) return;
    setIsExporting(true);
    try {
      await exportSigmaToPng(sigma, { scale: Number(exportScale) });
      setExportOpen(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('PNG export failed', err);
    } finally {
      setIsExporting(false);
    }
  }

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
          style={leftButtonStyle}
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

        <div style={rightButtonStyle}>
          <Popover.Root open={exportOpen} onOpenChange={setExportOpen}>
            <Popover.Trigger
              render={
                <IconButton
                  icon={download}
                  label="Export as PNG"
                  variant="minimal"
                  tone="neutral"
                  size="small"
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

const leftButtonStyle = {
  position: 'absolute',
  left: -52,
  top: '50%',
  transform: 'translateY(-50%)',
};

const rightButtonStyle = {
  position: 'absolute',
  right: -52,
  top: '50%',
  transform: 'translateY(-50%)',
};

const popupStyle = {
  padding: 'var(--wpds-dimension-gap-md)',
  minWidth: 240,
};
