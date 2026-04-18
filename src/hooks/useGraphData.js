import { useState, useEffect, useCallback } from 'react';

export default function useGraphData() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

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

  // Auto-fetch from server
  useEffect(() => {
    let cancelled = false;
    fetch('/api/hooks.json')
      .then((r) => {
        if (!r.ok) throw new Error('No data');
        return r.text();
      })
      .then((text) => parseJson(text))
      .then((parsed) => {
        if (!cancelled) {
          setData(parsed);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [parseJson]);

  // Manual file upload
  const loadFile = useCallback(
    (file) => {
      setIsLoading(true);
      setError(null);
      const reader = new FileReader();
      reader.onload = (e) => {
        parseJson(e.target.result)
          .then((parsed) => {
            setData(parsed);
            setIsLoading(false);
          })
          .catch((err) => {
            setError('Invalid JSON file: ' + err.message);
            setIsLoading(false);
          });
      };
      reader.readAsText(file);
    },
    [parseJson]
  );

  return { data, isLoading, error, loadFile };
}
