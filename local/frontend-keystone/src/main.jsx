/* Keystone frontend entry.
 *
 * This file was 8,177 lines with zero imports, loaded as a <script defer>
 * alongside React, framer-motion and gsap from CDNs. It is now the entry
 * point and nothing else: the stylesheet, the router, and one render call.
 *
 * StrictMode is deliberately absent. Several effects allocate
 * non-idempotent resources, and double-invoking them in development
 * produces duplicate rAF loops and canvas contexts. Revisit only after
 * auditing every effect's cleanup.
 */
import { createRoot } from 'react-dom/client';

// Must stay first so Tailwind's preflight lands before anything that
// depends on it. Order inside the sheet is documented in styles/index.css.
import './styles/index.css';

import { AppRouter } from './App.jsx';
import { AccountProvider } from './lib/account.jsx';

createRoot(document.getElementById('root')).render(<AccountProvider><AppRouter/></AccountProvider>);
