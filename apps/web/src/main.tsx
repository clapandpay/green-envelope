// SPDX-License-Identifier: AGPL-3.0-or-later
import { render } from 'preact';
import { App } from './app';
import { createServices } from './services';
import './styles/tokens.css';
import './styles/base.css';
import './styles/claim.css';

const root = document.getElementById('app');
if (root) render(<App services={createServices()} />, root);
