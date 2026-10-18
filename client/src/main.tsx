import '@fontsource/alfa-slab-one/latin-400.css';
import '@fontsource/alfa-slab-one/latin-ext-400.css';
import '@fontsource-variable/archivo/wdth.css';
import './styles/index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { readConfig } from './config';
import { createConnection } from './connection';
import { ConnectionProvider } from './connection/context';
import { ConnectionStore } from './connection/store';

const config = readConfig(import.meta.env, window.location.search, window.location.origin);
const { connection, mock } = createConnection(config);
const store = new ConnectionStore(connection);

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <ConnectionProvider store={store}>
      <App config={config} mock={mock} />
    </ConnectionProvider>
  </StrictMode>,
);
