import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { assertConversion } from './scripts/conversion-config.mjs';

// local: the loopback conversion API behind the dev proxy. preview (C4e): same-origin,
// served by the preview API service, so there is no proxy target.
const conversion = assertConversion();

// `frontend/` stays the Vite root so the Vercel project's Root Directory and
// frontend/vercel.json keep working untouched. Output goes to dist/, which is
// what both Vercel and backend/server.js now serve.
//
// Social metadata needs an ABSOLUTE origin: scrapers do not resolve
// root-relative og:image reliably. Vite's own %VAR% substitution leaves the
// literal token in place when the variable is unset, which would ship
// `href="%VITE_SITE_ORIGIN%/"` to production, so the plugin below does the
// substitution itself.
//
// Resolving the public origin, in order of how much we trust it:
//
//   1. VITE_SITE_ORIGIN              - set by hand; the only one that can
//                                      know about a custom domain.
//   2. VERCEL_PROJECT_PRODUCTION_URL - Vercel's own production hostname,
//                                      exposed to every build. Stable
//                                      across deploys, so it is safe to
//                                      put in a canonical.
//   3. VERCEL_URL                    - this deployment's unique hostname.
//                                      Different on every push, so it is
//                                      only reached on previews, where a
//                                      canonical pointing at the preview
//                                      is what you want anyway.
//
// Falling all the way through used to be the normal case, and it shipped
// href="/" in canonical and og:url - which no scraper resolves, so every
// share card rendered imageless. On Vercel that can no longer happen.
export const resolveSiteOrigin = () => {
  const explicit = (process.env.VITE_SITE_ORIGIN || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const host = (process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '').trim();
  if (host) return 'https://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return '';
};

// Vercel Analytics exists only on Vercel. Elsewhere (local, the Cloud Run preview)
// the script 404s on every page, so it is emitted only in builds made on Vercel.
// If the site moves off Vercel, analytics needs a replacement (see the brand
// migration notes in docs/superpowers/plans).
const vercelAnalytics = () => ({
  name: 'keystone-vercel-analytics',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => (process.env.VERCEL ? html : html.replace(/[ \t]*<script defer src="\/_vercel\/insights\/script\.js"><\/script>\r?\n?/, '')),
  },
});

const siteOrigin = () => ({
  name: 'keystone-site-origin',
  // `pre`, not the default. vite:build-html scans link hrefs for assets to
  // inline during its own transform, which runs before post hooks - so a
  // substitution made afterwards is too late to matter. It has to happen
  // before that scan sees the tag.
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      const origin = resolveSiteOrigin();
      if (!origin) {
        console.warn(
          [
            '',
            '  [keystone] No site origin could be resolved.',
            '  og:url and og:image will be emitted root-relative and the canonical',
            '  will be dropped, so share cards will not resolve. Set VITE_SITE_ORIGIN',
            '  to the public origin (e.g. https://your-domain.com). On Vercel this is',
            '  only reached if system environment variables have been turned off.',
            '',
          ].join('\n')
        );
        // With nothing to substitute, the canonical becomes href="/" - which
        // Vite reads as an asset path, so it tried to read the public root
        // and the build died on a bare `EISDIR: illegal operation on a
        // directory`. A canonical pointing at "/" is useless anyway, so drop
        // the tag instead of emitting it. The client still sets a correct one
        // at runtime from window.location; the only readers that lose out are
        // the scrapers that could not have resolved "/" either.
        return html.replace(/[ \t]*<link rel="canonical"[^>]*>\r?\n?/g, '')
          .replaceAll('%VITE_SITE_ORIGIN%', '');
      }
      return html.replaceAll('%VITE_SITE_ORIGIN%', origin);
    },
  },
});

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [vercelAnalytics(), react(), siteOrigin()],
  // src/data/meta.js builds the per-route canonical and og tags from this.
  // Vite only exposes VITE_-prefixed variables, so the Vercel-derived
  // fallback has to be handed over explicitly - otherwise the JS half of
  // the metadata would disagree with the HTML half the plugin writes.
  define: {
    'import.meta.env.VITE_SITE_ORIGIN': JSON.stringify(resolveSiteOrigin()),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // Explicit modern targets. The default CSS target is conservative enough
    // that the minifier rewrote `backdrop-filter` to the -webkit- alias ONLY,
    // dropping the standard property and silently killing every glass surface
    // on the site. These targets all support it unprefixed.
    target: 'es2022',
    cssTarget: ['chrome111', 'edge111', 'firefox113', 'safari16.4'],
  },
  server: {
    host: '127.0.0.1',
    port: 5299,
    headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:5299; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; form-action 'self'",
      'X-Robots-Tag': 'noindex, nofollow',
    },
    strictPort: true,
    // Lets `npm run dev` talk to a locally running backend without a build.
    ...(conversion.api ? { proxy: { '/api': conversion.api } } : {}),
  },
});
