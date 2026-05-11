import apiFetch from '@wordpress/api-fetch';
import { Spinner } from '@wordpress/components';
import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';

export default function AiCodebasesPanel() {
  const [state, setState] = useState({ status: 'idle', text: '', error: '' });

  const run = async () => {
    setState({ status: 'loading', text: '', error: '' });
    try {
      const res = await apiFetch({
        path: '/hooksgraph/v1/ai/list-codebases',
        method: 'POST',
      });
      setState({ status: 'done', text: res?.text ?? '', error: '' });
    } catch (err) {
      setState({
        status: 'error',
        text: '',
        error: err?.message ?? __('Request failed.', 'hooksgraph'),
      });
    }
  };

  return (
    <div className="hooksgraph-ai-panel" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <Button variant="solid" tone="brand" onClick={run} disabled={state.status === 'loading'}>
          {__('Ask AI: what codebases are available?', 'hooksgraph')}
        </Button>
        {state.status === 'loading' && <Spinner />}
      </div>
      {state.status === 'done' && state.text && (
        <pre style={{ whiteSpace: 'pre-wrap', marginTop: '0.75rem' }}>{state.text}</pre>
      )}
      {state.status === 'error' && (
        <p style={{ color: '#b32d2e', marginTop: '0.75rem' }}>{state.error}</p>
      )}
    </div>
  );
}
