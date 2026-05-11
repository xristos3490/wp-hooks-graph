import { useState, useEffect, useCallback } from 'react';

/**
 * Resolve hooks.json and demo.json URLs from optional `window.*` overrides.
 *
 * `hooksUrl`:
 *   - `window.HOOKSGRAPH_JSON_URL` if truthy, else `'./hooks.json'`.
 *
 * `demoUrl` (tri-state — distinguishes "use default" from "skip"):
 *   - key absent           → `'./demo.json'` (CLI dev/server default).
 *   - explicit `null`      → `null` (skip probe + button; e.g. WP theme without demo).
 *   - non-empty string     → use as URL.
 */
export function resolveDataUrls(globals) {
  const hooksUrl = (globals && globals.HOOKSGRAPH_JSON_URL) || './hooks.json';
  const demoUrl =
    globals && Object.prototype.hasOwnProperty.call(globals, 'HOOKSGRAPH_DEMO_URL')
      ? globals.HOOKSGRAPH_DEMO_URL
      : './demo.json';
  return { hooksUrl, demoUrl };
}

export default function useGraphData() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hasDemo, setHasDemo] = useState(false);

  // Parse JSON, with Web Worker for large payloads
  const parseJson = useCallback((text) => {
    return new Promise((resolve, reject) => {
      if (text.length > 1_000_000) {
        const workerCode =
          'self.onmessage=function(e){try{self.postMessage({ok:true,data:JSON.parse(e.data)})}catch(err){self.postMessage({ok:false,error:err.message})}};';
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const worker = new Worker(url);
        worker.onmessage = (msg) => {
          worker.terminate();
          URL.revokeObjectURL(url);
          if (msg.data.ok) resolve(msg.data.data);
          else reject(new Error(msg.data.error));
        };
        worker.postMessage(text);
      } else {
        try {
          resolve(JSON.parse(text));
        } catch (err) {
          reject(err);
        }
      }
    });
  }, []);

  const { hooksUrl, demoUrl } = resolveDataUrls(typeof window !== 'undefined' ? window : null);

  useEffect(() => {
    let cancelled = false;

    if (demoUrl) {
      fetch(demoUrl, { method: 'HEAD' })
        .then((r) => {
          if (!r.ok || r.status === 204) return false;
          const ct = r.headers.get('content-type') || '';
          return ct.includes('json');
        })
        .catch(() => false)
        .then((demo) => {
          if (!cancelled) setHasDemo(demo);
        });
    }

    fetch(hooksUrl)
      .then((r) => {
        // 204 = server has no JSON bound; stay on the homepage silently.
        if (r.status === 204 || !r.ok) return null;
        return r.text().then((text) => parseJson(text));
      })
      .then((parsed) => {
        if (cancelled) return;
        if (parsed) setData(parsed);
        setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [parseJson, hooksUrl, demoUrl]);

  // Shared loader: parse text → set data, handle errors uniformly.
  const loadGraphFromJson = useCallback(
    (text, errorPrefix = '') =>
      parseJson(text)
        .then((parsed) => {
          setData(parsed);
          setIsLoading(false);
        })
        .catch((err) => {
          setError(errorPrefix + err.message);
          setIsLoading(false);
        }),
    [parseJson]
  );

  const loadFile = useCallback(
    (file) => {
      setIsLoading(true);
      setError(null);
      const reader = new FileReader();
      reader.onload = (e) => loadGraphFromJson(e.target.result, 'Invalid JSON file: ');
      reader.readAsText(file);
    },
    [loadGraphFromJson]
  );

  const loadDemo = useCallback(() => {
    if (!demoUrl) {
      setError('No demo available');
      return Promise.resolve();
    }
    setIsLoading(true);
    setError(null);
    return fetch(demoUrl)
      .then((r) => {
        if (!r.ok || r.status === 204) {
          throw new Error(`No demo available (status ${r.status})`);
        }
        return r.text();
      })
      .then((text) => loadGraphFromJson(text))
      .catch((err) => {
        setError(err.message);
        setIsLoading(false);
      });
  }, [loadGraphFromJson, demoUrl]);

  const clearData = useCallback(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return { data, isLoading, error, loadFile, loadDemo, clearData, hasDemo };
}
