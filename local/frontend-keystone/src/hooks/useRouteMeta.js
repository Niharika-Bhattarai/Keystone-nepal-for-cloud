import { useEffect } from 'react';
import { BRAND_DISPLAY_NAME, CONTACT_EMAIL } from '../data/brand.js';
import { OG_IMAGE_PATH, ROUTE_META, SITE_ORIGIN } from '../data/meta.js';

export const upsertMeta = (selector, attr, value, content) => {
    let el = document.head.querySelector(selector);
    if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, value);
        document.head.appendChild(el);
    }
    el.setAttribute('content', content);
};

export const upsertLink = (rel, href) => {
    let el = document.head.querySelector(`link[rel="${rel}"]`);
    if (!el) {
        el = document.createElement('link');
        el.setAttribute('rel', rel);
        document.head.appendChild(el);
    }
    el.setAttribute('href', href);
};

// A JSON-LD block, keyed by id so a route swap replaces rather than stacks.
export const upsertJsonLd = (id, data) => {
    let el = document.head.querySelector(`script[data-ld="${id}"]`);
    if (!data) { if (el) el.remove(); return; }
    if (!el) {
        el = document.createElement('script');
        el.type = 'application/ld+json';
        el.setAttribute('data-ld', id);
        document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);
};

export const useRouteMeta = (path, extra) => {
    useEffect(() => {
        const meta = ROUTE_META[path] || ROUTE_META['/'];
        // /case-study renders the same page as /how-floor-plans-work, so it
        // points its canonical there rather than competing with it.
        const canonical = SITE_ORIGIN + (meta.canonicalPath || path);
        const image = SITE_ORIGIN + OG_IMAGE_PATH;

        document.title = meta.title;
        upsertMeta('meta[name="description"]', 'name', 'description', meta.description);
        upsertLink('canonical', canonical);

        upsertMeta('meta[property="og:url"]', 'property', 'og:url', canonical);
        upsertMeta('meta[property="og:title"]', 'property', 'og:title', meta.title);
        upsertMeta('meta[property="og:description"]', 'property', 'og:description', meta.description);
        upsertMeta('meta[property="og:image"]', 'property', 'og:image', image);
        upsertMeta('meta[property="og:site_name"]', 'property', 'og:site_name', BRAND_DISPLAY_NAME);
        upsertMeta('meta[name="twitter:title"]', 'name', 'twitter:title', meta.title);
        upsertMeta('meta[name="twitter:description"]', 'name', 'twitter:description', meta.description);
        upsertMeta('meta[name="twitter:image"]', 'name', 'twitter:image', image);

        upsertJsonLd('website', {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: BRAND_DISPLAY_NAME,
            url: SITE_ORIGIN + '/',
            description: ROUTE_META['/'].description,
        });
        upsertJsonLd('organization', {
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: BRAND_DISPLAY_NAME,
            url: SITE_ORIGIN + '/',
            logo: SITE_ORIGIN + '/images/keystone-mark.svg',
            email: CONTACT_EMAIL,
        });
        upsertJsonLd('webpage', {
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: meta.title,
            url: canonical,
            description: meta.description,
            isPartOf: { '@type': 'WebSite', url: SITE_ORIGIN + '/' },
        });
        upsertJsonLd('breadcrumb', path === '/' ? null : {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_ORIGIN + '/' },
                { '@type': 'ListItem', position: 2, name: meta.title.split(' - ')[0], item: canonical },
            ],
        });
        upsertJsonLd('extra', extra || null);
    }, [path, extra]);
};
