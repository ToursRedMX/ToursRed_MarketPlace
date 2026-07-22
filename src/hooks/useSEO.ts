import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

interface SEOOptions {
  title: string;
  description?: string;
  image?: string;
  type?: 'website' | 'product' | 'profile' | 'article';
  noindex?: boolean;
  jsonLd?: object | object[];
}

const SITE_URL = (import.meta.env.VITE_APP_URL || 'https://toursredmx.netlify.app/').replace(/\/$/, '');
const DEFAULT_IMAGE = `${SITE_URL}/LogoFinal.jpg`;

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function useSEO({ title, description, image, type = 'website', noindex = false, jsonLd }: SEOOptions) {
  const location = useLocation();

  useEffect(() => {
    const canonicalUrl = `${SITE_URL}${location.pathname}${location.search}`;
    const ogImage = image || DEFAULT_IMAGE;

    document.title = title;

    if (description) {
      upsertMeta('name', 'description', description);
      upsertMeta('property', 'og:description', description);
      upsertMeta('name', 'twitter:description', description);
    }

    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description || '');
    upsertMeta('property', 'og:image', ogImage);
    upsertMeta('property', 'og:url', canonicalUrl);
    upsertMeta('property', 'og:type', type);
    upsertMeta('property', 'og:locale', 'es_MX');
    upsertMeta('property', 'og:site_name', 'ToursRed');

    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:image', ogImage);

    upsertMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow');

    upsertLink('canonical', canonicalUrl);

    const ldArray = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];
    const createdScripts: HTMLScriptElement[] = [];

    ldArray.forEach((ld) => {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(ld);
      script.setAttribute('data-seo-jsonld', 'true');
      document.head.appendChild(script);
      createdScripts.push(script);
    });

    return () => {
      createdScripts.forEach((s) => s.remove());
    };
  }, [title, description, image, type, noindex, jsonLd, location.pathname, location.search]);
}
