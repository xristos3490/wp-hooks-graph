import { useState, useEffect, useCallback } from 'react';

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

  useEffect(() => {
    let cancelled = false;

    fetch('./demo.json', { method: 'HEAD' })
      .then((r) => {
        if (!r.ok || r.status === 204) return false;
        const ct = r.headers.get('content-type') || '';
        return ct.includes('json');
      })
      .catch(() => false)
      .then((demo) => {
        if (!cancelled) setHasDemo(demo);
      });

    fetch('./hooks.json')
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
  }, [parseJson]);

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
    setIsLoading(true);
    setError(null);
    return fetch('./demo.json')
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
  }, [loadGraphFromJson]);

  const clearData = useCallback(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return { data, isLoading, error, loadFile, loadDemo, clearData, hasDemo };
}
