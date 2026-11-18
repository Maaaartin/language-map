import type * as Leaflet from 'leaflet';
import type { LocationRecord, LocationGroup, LocationConnection, ClosestResult, LanguageNode } from './types.js';
import { byId as $, el, errorMessage } from './dom.js';
import { languageGroup, languageSearchText } from './family-groups.js';
import { prepareLocations, groupLocations, closestMappedLanguages } from './map-model.js';
import { normalizeGraph, normalizeLanguageGraph } from './model.js';
import { similarityWidth } from './edge-style.js';
import { createJsonLoader } from './data-loader.js';
import { sitePath } from './site-path.js';
import { readLanguageData } from './page-data.js';

const dataLoader = createJsonLoader();
window.addEventListener('pagehide', () => dataLoader.dispose());

const L = window.L;
const number = (n: number) => n.toLocaleString();
const countryNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const countryName = (code: string) => { try { return countryNames?.of(code) ?? code; } catch { return code; } };
let locations: LocationRecord[] = [], selected: string | null = null, loading = false;
const markers = new Map<string, { marker: Leaflet.Marker; group: LocationGroup }>();
let closest: (ClosestResult & { center: string }) | null = null, closestVersion = 0;
let indexRequest: Promise<{ catalog: LanguageNode[]; files: Map<string, string> }> | null = null;
let activeConnection: string | null = null, hoveredConnection: string | null = null;
const connectionLines = new Map<string, { line: Leaflet.Polyline; connection: LocationConnection }>();
export const map = L.map('geographic-map', { minZoom: 0, maxZoom: 19, worldCopyJump: true, closePopupOnClick: false }).setView([22, 10], 2);
const layer = L.layerGroup().addTo(map);
const connectionsLayer = L.layerGroup().addTo(map);
let tileFailed = false;
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).on('loading', () => { tileFailed = false; })
  .on('tileerror', () => { tileFailed = true; $('tile-warning').hidden = false; })
  .on('load', () => { if (!tileFailed) $('tile-warning').hidden = true; }).addTo(map);

function updateGraphLink() { $('graph-link').href = `${sitePath('/')}${window.location.search}`; }
function setStatus(text: string, retry = false) {
  $('geo-status-text').textContent = text;
  $('geo-status').hidden = !text;
  $('retry-locations').hidden = !retry;
}
function graphLink(id: string) {
  const url = new URL(sitePath('/'), window.location.origin);
  url.searchParams.set('language', id);
  return url.pathname + url.search;
}
function popup(group: LocationGroup) {
  const content = el('div', undefined, 'geo-popup');
  for (const record of group.records) {
    const section = el('section');
    section.append(el('h3', record.label), el('span', record.level, 'record-type'));
    if (record.name !== record.label) section.append(el('p', `Glottolog name: ${record.name}`));
    section.append(el('p', languageGroup(record).label));
    section.append(el('p', `ISO: ${record.iso6393 ?? 'not provided'} · Glottocode: ${record.glottocode ?? 'not provided'}`));
    section.append(el('p', record.countries.length ? `Country associations: ${record.countries.map(c => `${countryName(c)} (${c})`).join(', ')}` : 'No country associations provided.'));
    section.append(el('p', `Reference point: ${record.latitude.toFixed(4)}, ${record.longitude.toFixed(4)}`));
    const link = el('a', 'Explore comparison graph ↗'); link.href = graphLink(record.id); section.append(link);
    content.append(section);
  }
  return content;
}
function markerIcon(group: LocationGroup) {
  const active = group.records.some(r => r.id === selected);
  const compared = group.records.some(r => r.id === (hoveredConnection ?? activeConnection));
  const connected = closest?.connections.some(c => group.records.some(r => r.id === c.target.id));
  const level = group.records.some(r => r.level === 'language') ? 'language' : group.records.some(r => r.level === 'dialect') ? 'dialect' : 'family';
  return L.divIcon({ className: `map-marker${active ? ' is-active' : compared ? ' is-compared' : connected ? ' is-connected' : ''}`,
    html: `<span class="language-pin level-${level}"><span>${group.records.length > 1 ? group.records.length : '•'}</span></span>`,
    iconSize: [26, 34], iconAnchor: [13, 30], popupAnchor: [0, -28] });
}
function refreshMarkers() {
  const targets = new Set(closest?.connections.map(c => c.target.id) ?? []);
  for (const { marker, group } of new Set(markers.values())) {
    marker.setIcon(markerIcon(group));
    const related = group.records.some(r => r.id === selected || targets.has(r.id));
    marker.setOpacity(closest?.connections.length && !related ? .3 : 1);
    marker.setZIndexOffset(group.records.some(r => r.id === selected) ? 1000 : related ? 500 : 0);
  }
}
function applyConnectionStyles() {
  const target = hoveredConnection ?? activeConnection;
  for (const [id, { line, connection }] of connectionLines) {
    line.setStyle({ weight: similarityWidth(connection.similarity), color: target === id ? '#c7943f' : '#3d806b',
      opacity: target ? target === id ? 1 : .25 : .8 });
    if (target === id) line.bringToFront();
  }
  for (const button of $('closest-list').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.language === activeConnection));
  refreshMarkers();
}
function clearClosest({ history = true } = {}) {
  closestVersion++; closest = null; activeConnection = null; hoveredConnection = null;
  connectionsLayer.clearLayers(); connectionLines.clear();
  $('closest-panel').hidden = true; $('retry-closest').hidden = true; $('closest-list').replaceChildren();
  refreshMarkers();
  if (history) {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set('connections', 'none'); else url.searchParams.delete('connections');
    url.searchParams.delete('compare');
    if (url.href !== window.location.href) window.history.pushState(null, '', url.href);
    updateGraphLink();
  }
}
function clearSelection({ history = true } = {}) {
  selected = null;
  clearClosest({ history: false });
  for (const button of $('language-list').querySelectorAll('button')) button.setAttribute('aria-pressed', 'false');
  map.closePopup(); setStatus('');
  if (history) {
    const url = new URL(window.location.href);
    for (const key of ['language', 'compare', 'connections']) url.searchParams.delete(key);
    if (url.href !== window.location.href) window.history.pushState(null, '', url.href);
  }
  updateGraphLink();
}
async function comparisonIndex() {
  if (!indexRequest) indexRequest = (async () => {
    const data = readLanguageData();
    const catalog = normalizeGraph({ nodes: data.languages, edges: [] }).nodes;
    const files = new Map<string, string>();
    for (const language of data.languages) {
      if (!/^\/graphs\/[a-f0-9]{64}\.json$/.test(language.graphFile)) throw new Error('Invalid comparison index. Rebuild the graph files.');
      files.set(language.id, language.graphFile);
    }
    return { catalog, files };
  })().catch(error => { indexRequest = null; throw error; });
  return indexRequest;
}
async function showClosest(id: string, { history = true } = {}) {
  const record = locations.find(r => r.id === id);
  if (!record) return;
  focusLanguage(id, { zoom: false, history: false });
  clearClosest({ history: false });
  const version = ++closestVersion;
  $('map-search').value = ''; $('map-level').value = 'all'; render();
  markers.get(id)?.marker.openPopup();
  $('closest-panel').hidden = false;
  $('closest-title').textContent = `Closest to ${record.label}`;
  $('closest-status').textContent = 'Loading comparisons…';
  if (history) {
    const url = new URL(window.location.href);
    if (url.searchParams.get('language') !== id) url.searchParams.delete('compare');
    url.searchParams.set('language', id); url.searchParams.set('connections', 'closest');
    if (url.href !== window.location.href) window.history.pushState(null, '', url.href);
    updateGraphLink();
  }
  try {
    const index = await comparisonIndex();
    if (version !== closestVersion || selected !== id) return;
    const path = index.files.get(id);
    if (!path) throw new Error('No comparison graph exists for this language yet.');
    let graph;
    try { graph = normalizeLanguageGraph(await dataLoader.json(path), id, index.catalog); }
    catch (error) { dataLoader.invalidate(path); throw error; }
    if (version !== closestVersion || selected !== id) return;
    closest = { center: id, ...closestMappedLanguages(graph, locations, id) };
    const requested = new URL(window.location.href).searchParams.get('compare');
    activeConnection = closest.connections.some(c => c.target.id === requested) ? requested : null;
    render();
    if (closest.connections.length) map.fitBounds([record, ...closest.connections.map(c => c.target)].map(r => [r.latitude, r.longitude] as [number, number]), { padding: [60, 60], maxZoom: 6, animate: false });
    markers.get(id)?.marker.openPopup();
  } catch (error) {
    if (version !== closestVersion || selected !== id) return;
    $('closest-status').textContent = `Could not load comparisons: ${errorMessage(error)}`;
    $('retry-closest').hidden = false;
  }
}
function inspectConnection(id: string) {
  const connection = closest?.connections.find(c => c.target.id === id);
  if (!connection) return;
  activeConnection = id; hoveredConnection = null;
  if (!markers.has(id) || !selected || !markers.has(selected)) { $('map-search').value = ''; $('map-level').value = 'all'; render(); }
  applyConnectionStyles(); connectionLines.get(id)?.line.openPopup();
  const url = new URL(window.location.href);
  url.searchParams.set('compare', id);
  if (url.href !== window.location.href) window.history.pushState(null, '', url.href);
  updateGraphLink();
}
function drawConnections() {
  connectionsLayer.clearLayers(); connectionLines.clear();
  if (!closest) { refreshMarkers(); return; }
  const list = $('closest-list'); list.replaceChildren();
  for (const connection of closest.connections) {
    const { source, target, similarity, distance } = connection;
    if (markers.has(source.id) && markers.has(target.id)) {
      const line = L.polyline([[source.latitude, source.longitude], [target.latitude, target.longitude]], {
        className: 'language-connection', color: '#3d806b', weight: similarityWidth(similarity), opacity: .8, bubblingMouseEvents: false,
      });
      const content = el('div', undefined, 'geo-popup');
      content.append(el('h3', `${source.label} ↔ ${target.label}`), el('strong', `${Math.round(similarity * 100)}% similarity`), el('p', `Distance: ${distance.toFixed(2)}`));
      const link = el('a', 'Open this comparison in the graph ↗');
      link.href = graphLink(source.id) + `&compare=${encodeURIComponent(target.id)}`; content.append(link);
      line.bindPopup(content).bindTooltip(el('span', `${target.label} · ${Math.round(similarity * 100)}% similarity`));
      line.on('mouseover', () => { hoveredConnection = target.id; applyConnectionStyles(); })
        .on('mouseout', () => { hoveredConnection = null; applyConnectionStyles(); })
        .on('click', () => inspectConnection(target.id));
      line.addTo(connectionsLayer); connectionLines.set(target.id, { line, connection });
    }
    const row = el('li'); const button = el('button'); button.type = 'button'; button.dataset.language = target.id;
    button.append(el('span', target.label), el('strong', `${Math.round(similarity * 100)}%`));
    button.onclick = () => inspectConnection(target.id);
    row.append(button);
    if (source.latitude === target.latitude && source.longitude === target.longitude) row.append(el('small', 'Shares this reference point'));
    list.append(row);
  }
  $('closest-status').textContent = closest.connections.length
    ? `${connectionLines.size} of ${closest.connections.length} closest mapped matches visible (${closest.totalMapped} available). ${closest.withoutLocation} comparisons have no mapped coordinates.`
    : closest.withoutLocation ? 'Collected comparisons have no mapped coordinates.' : 'No comparisons collected for this language yet.';
  applyConnectionStyles();
}
function filteredLocations() {
  const query = $('map-search').value.trim().toLocaleLowerCase();
  const level = $('map-level').value;
  return locations.filter(r => (level === 'all' || r.level === level) && (!query ||
    [languageSearchText(r), r.name, r.id, r.iso6393, r.glottocode, ...r.countries, ...r.countries.map(countryName)].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)));
}
function render() {
  const visible = filteredLocations();
  layer.clearLayers(); markers.clear();
  for (const group of groupLocations(visible)) {
    const marker = L.marker([group.latitude, group.longitude], { icon: markerIcon(group), title: group.records.map(r => r.label).join(', '), keyboard: true, bubblingMouseEvents: false });
    const label = el('span', group.records.map(r => r.label).join(', '));
    marker.bindTooltip(label, { direction: 'top', offset: [0, -23] }).bindPopup(popup(group), { maxWidth: 330, autoPan: true });
    marker.on('click', () => { void showClosest(group.records[0].id); });
    marker.addTo(layer);
    const item = { marker, group };
    for (const record of group.records) markers.set(record.id, item);
  }
  const list = $('language-list'); list.replaceChildren();
  for (const record of visible) {
    const button = el('button'); button.type = 'button'; button.dataset.language = record.id;
    button.setAttribute('aria-pressed', String(record.id === selected));
    button.append(el('span', record.label), el('small', record.iso6393 ?? record.level));
    button.onclick = () => showClosest(record.id); list.append(button);
  }
  if (!visible.length) list.append(el('p', 'No mapped languages match this search.'));
  $('map-summary').textContent = `${number(visible.length)} of ${number(locations.length)} mapped records shown`;
  $('fit-locations').disabled = visible.length === 0;
  drawConnections();
}
function focusLanguage(id: string, { zoom = true, history = true } = {}) {
  const record = locations.find(r => r.id === id);
  if (!record) { setStatus('This language has no usable mapped coordinates. Search for another language.'); return; }
  if (selected !== id) clearClosest({ history: false });
  selected = id;
  if (!markers.has(id)) { $('map-search').value = ''; $('map-level').value = 'all'; render(); }
  for (const { marker, group } of new Set(markers.values())) marker.setIcon(markerIcon(group));
  for (const button of $('language-list').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.language === id));
  const item = markers.get(id);
  if (zoom) map.setView([record.latitude, record.longitude], Math.max(5, map.getZoom()), { animate: false });
  item?.marker.openPopup(); setStatus('');
  if (history) {
    const url = new URL(window.location.href);
    if (url.searchParams.get('language') !== id) {
      url.searchParams.set('language', id); url.searchParams.delete('compare'); url.searchParams.delete('connections');
      window.history.pushState(null, '', url.href);
    }
  }
  updateGraphLink();
}
function fitLocations() {
  const visible = filteredLocations();
  if (!visible.length) return;
  if (visible.length === 1) map.setView([visible[0].latitude, visible[0].longitude], 5, { animate: false });
  else map.fitBounds(visible.map(r => [r.latitude, r.longitude] as [number, number]), { padding: [40, 40], maxZoom: 6, animate: false });
}
async function restoreSelection() {
  const id = new URL(window.location.href).searchParams.get('language');
  updateGraphLink();
  if (id) {
    focusLanguage(id, { history: false });
    const url = new URL(window.location.href);
    if (url.searchParams.get('connections') !== 'none' && locations.some(r => r.id === id)) {
      if (url.searchParams.get('connections') !== 'closest') {
        url.searchParams.set('connections', 'closest'); window.history.replaceState(null, '', url.href); updateGraphLink();
      }
      if (closest?.center === id) {
        const requested = url.searchParams.get('compare');
        activeConnection = closest.connections.some(c => c.target.id === requested) ? requested : null;
        hoveredConnection = null; drawConnections();
        if (activeConnection) connectionLines.get(activeConnection)?.line.openPopup();
      } else await showClosest(id, { history: false });
    } else clearClosest({ history: false });
  } else clearSelection({ history: false });
}
async function loadLocations() {
  if (loading) return;
  loading = true; setStatus('Loading language locations…');
  try {
    const data = prepareLocations(await dataLoader.json('/languages-enriched.json', { priority: 'high' }));
    locations = data.records;
    $('located-count').textContent = number(locations.length);
    $('unlocated-count').textContent = number(data.withoutLocation);
    render();
    if (!locations.length) setStatus('No records have valid coordinates. Run npm run map:languages to generate location data.');
    else { setStatus(''); fitLocations(); await restoreSelection(); }
  } catch (error) {
    $('map-summary').textContent = 'Location data could not be loaded.';
    dataLoader.invalidate('/languages-enriched.json');
    setStatus(`Could not load enriched languages (${errorMessage(error)}). Run npm run map:languages, then retry.`, true);
  } finally { loading = false; }
}
$('map-search').addEventListener('input', () => { render(); });
$('map-level').addEventListener('change', () => { render(); });
$('map-search').addEventListener('keydown', event => { if (event.key === 'Enter') $('language-list').querySelector('button')?.click(); });
$('fit-locations').onclick = fitLocations;
$('retry-locations').onclick = loadLocations;
map.on('click', () => clearSelection());
window.addEventListener('popstate', () => { void restoreSelection(); });
$('clear-closest').onclick = () => clearClosest();
$('retry-closest').onclick = () => { if (selected) void showClosest(selected); };
const resize = new ResizeObserver(() => map.invalidateSize({ pan: false }));
resize.observe($('geographic-map'));
window.addEventListener('pagehide', () => { resize.disconnect(); map.remove(); }, { once: true });
updateGraphLink();
await loadLocations();
