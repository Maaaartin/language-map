export const catalogPlaceholder = '<!-- LANGUAGE_CATALOG -->';

export function embedCatalog(html, catalog) {
  if (html.split(catalogPlaceholder).length !== 2) throw new Error('HTML template needs exactly one language catalog placeholder');
  // JSON is data, not executable JavaScript. Escape HTML-significant characters
  // so scraped labels cannot close the script element or introduce markup.
  const escapes = { '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' };
  const json = JSON.stringify(catalog).replace(/[<>&\u2028\u2029]/g, character => escapes[character]);
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('en-US') : '—';
  return html
    .replaceAll('<!-- LANGUAGE_COUNT -->', count(catalog.languages.length))
    .replaceAll('<!-- COMPARISON_COUNT -->', count(catalog.comparisonCount))
    .replace(catalogPlaceholder, () => `<script id="language-data" type="application/json">${json}</script>`);
}
