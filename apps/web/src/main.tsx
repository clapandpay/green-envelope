// SPDX-License-Identifier: AGPL-3.0-or-later
import { render } from 'preact';
import { App } from './app';
import { createServices } from './services';
import './styles/tokens.css';
import './styles/base.css';
import './styles/claim.css';

import { misplacedLink, sitesFrom } from './lib/network';

// A link for the other network, opened on this network's site: it belongs on the other site.
const elsewhere = misplacedLink(location, sitesFrom(import.meta.env));
const root = document.getElementById('app');
if (elsewhere !== null) location.replace(elsewhere);
else if (root) render(<App services={createServices()} />, root);
