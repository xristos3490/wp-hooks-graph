import React from 'react';
import ReactDOM from 'react-dom/client';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import layoutUtilities from 'cytoscape-layout-utilities';
import App from './App';

cytoscape.use(fcose);
// Enables fcose's packComponents path: each connected component is laid out
// separately and arranged in a rectangular grid, restoring the "main blob
// plus a row of smaller isolated clusters" look that cose gave us for free.
cytoscape.use(layoutUtilities);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
