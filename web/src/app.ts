import type { GraphData, LanguageNode, LayoutNode, RenderEdge, Grouping } from './types.js';
import type { Selection, Simulation } from 'd3';
import { byId as $, el, errorMessage } from './dom.js';
import { languageGroup, groupColor, languageSearchText } from './family-groups.js';
import { makeMovablePanel } from './movable-panel.js';
import { collapseComparisonGroups } from './comparison-groups.js';
import { neighborShape } from './node-shapes.js';
import { normalizeGraph, normalizeLanguageGraph, graphView, neighborhoodView, comparisonBetween, defaultMinimumSimilarity } from './model.js';
import { anchorSelection, viewportTransform, comparisonDistance, constrainConnectionLengths, placeUncomparedNodes, placeDescendantNodes, arrangeBranchSectors } from './layout.js';
import { readUrlState, writeUrlState } from './url-state.js';
import { similarityWidth } from './edge-style.js';
import { createJsonLoader } from './data-loader.js';
import { sitePath } from './site-path.js';
import { readLanguageData } from './page-data.js';
makeMovablePanel($('group-settings'), $('group-settings-handle'));
const d3 = window.d3;
const svg = d3.select<SVGSVGElement, unknown>('#graph');
const layer = svg.append('g');
const edgeLayer = layer.append('g');
const nodeLayer = layer.append('g');
const map = document.querySelector<HTMLElement>('.map')!;
const tooltip = $('tooltip');
const pct = (n: number) => `${Math.round(n * 100)}%`;
const number = (n: number) => n.toLocaleString();
let graph: GraphData | null = null, selected: string | null = null, compared: string | null = null;
let simulation: Simulation<LayoutNode, RenderEdge> | null = null;
let nodes: LayoutNode[] = [], edges: RenderEdge[] = [];
let nodeSelection: Selection<SVGGElement, LayoutNode, SVGGElement, unknown> | null = null;
let edgeSelection: Selection<SVGLineElement, RenderEdge, SVGGElement, unknown> | null = null;
let catalog: LanguageNode[] = [], graphCenter: string | null = null, optionIndex = -1, navigationVersion = 0;
const graphFiles = new Map<string, string>(), pendingGraphs = new Map<string, Promise<GraphData>>();
const branchGraphs = new Map<string, GraphData>();
const dataLoader = createJsonLoader();
window.addEventListener('pagehide', () => dataLoader.dispose());
const expandedGroups = new Set<string>();
let expansionCenter: string | null = null, expansionGrouping: Grouping = 'branch';
let groupLanguages = false;
let levels = 1; let grouping: Grouping = 'branch';
let width = map.clientWidth, height = map.clientHeight, threshold = .1, automaticThreshold = true, frame = 0;
const zoom = d3.zoom<SVGSVGElement, unknown>().extent(() => [[0, 0], [width, height]]).scaleExtent([.03, 6])
  .on('zoom', e => { layer.attr('transform', e.transform); hideTooltip(); });
svg.call(zoom).on('dblclick.zoom', null);

function syncUrl(method: 'push' | 'replace' = 'push') {
  const href = writeUrlState(window.location.href, { center: selected, compare: compared, similarity: automaticThreshold ? null : Math.round(threshold * 100), levels, grouping, groupLanguages });
  if (href !== window.location.href) window.history[`${method}State`](null, '', href);
  $('geography-link').href = `${sitePath('/map/')}${new URL(href).search}`;
}
async function restoreUrl({ keepLayout = false } = {}) {
  if (!catalog.length) return;
  const version = ++navigationVersion;
  const state = readUrlState(window.location.href, catalog.map(n => n.id));
  selected = state.center; compared = state.compare;
  levels = state.levels; grouping = state.grouping; groupLanguages = state.groupLanguages;
  $('group-languages').checked = groupLanguages;
  $('grouping').disabled = !groupLanguages;
  $('grouping').value = grouping;
  $('levels').value = String(levels); $('levels-value').textContent = String(levels);
  if (expansionCenter !== selected || expansionGrouping !== grouping) {
    expandedGroups.clear(); expansionCenter = selected; expansionGrouping = grouping;
  }
  if (compared) {
    const language = catalog.find(n => n.id === compared);
    if (language) expandedGroups.add(languageGroup(language, grouping).key);
  }
  const preserveCamera = Boolean(graph) && graphCenter === selected;
  automaticThreshold = state.similarity === null;
  threshold = (state.similarity ?? 10) / 100;
  $('threshold').value = String(threshold * 100); $('threshold-value').textContent = pct(threshold);
  syncUrl('replace');
  cancelAnimationFrame(frame);
  if (!selected) {
    graph = null; graphCenter = null;
    renderGroups(); renderDetails(); draw(); return;
  }
  if (graphCenter !== selected || !graph) {
    const center = selected;
    graph = null; graphCenter = null;
    simulation?.stop();
    $('start-panel').hidden = true;
    svg.style('display', 'none');
    setMessage('Loading comparisons…');
    try {
      const next = await ensureGraph(center);
      if (version !== navigationVersion) return;
      graph = next; graphCenter = center;
    } catch (error) {
      if (version === navigationVersion) throw error;
      return;
    }
  }
  if (!graph) return;
  if (automaticThreshold) {
    threshold = defaultMinimumSimilarity(graph, selected) / 100;
    $('threshold').value = String(Math.round(threshold * 100)); $('threshold-value').textContent = pct(threshold);
  }
  if (levels > 1) {
    try { await loadBranches(version); }
    catch (error) { if (version === navigationVersion) throw error; else return; }
    if (version !== navigationVersion) return;
  }
  // An inspected language with no collected pair still needs a node and a label.
  if (compared && !graph.nodes.some(n => n.id === compared)) {
    graph = { ...graph, nodes: [...graph.nodes, catalog.find(n => n.id === compared)!] };
  }
  $('coverage').textContent = `${number(graph.edges.length)} / ${number(catalog.length - 1)} comparisons for ${catalog.find(n => n.id === selected)!.label}`;
  renderDetails();
  if (keepLayout && nodes.some(n => n.id === compared)) highlight(); else draw({ preserveCamera });
}
async function ensureGraph(center: string) {
  if (!pendingGraphs.has(center)) {
    const request = (async () => {
      const path = graphFiles.get(center);
      if (!path) throw new Error('No graph file found for this language. Rebuild the graph files.');
      try { return normalizeLanguageGraph(await dataLoader.json(path), center, catalog); }
      catch (error) { dataLoader.invalidate(path); throw error; }
    })().finally(() => { pendingGraphs.delete(center); });
    pendingGraphs.set(center, request);
  }
  return pendingGraphs.get(center)!;
}
async function loadBranches(version: number) {
  for (let depth = 1; depth < levels && version === navigationVersion; depth++) {
    const view = neighborhoodView(graph!, threshold, selected!, automaticThreshold ? 20 : 1500, compared, catalog, branchGraphs, depth);
    if (view.edges.length >= 1500) break;
    const queue = view.nodes.filter(n => n.level === depth && !branchGraphs.has(n.id)).map(n => n.id);
    if (!queue.length) continue;
    setMessage(`Loading neighbor level ${depth + 1}…`);
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length && version === navigationVersion) {
        const id = queue.shift()!;
        const branch = await ensureGraph(id);
        if (version === navigationVersion) branchGraphs.set(id, branch);
      }
    }));
  }
}
function loadError(error: unknown) {
  $('start-panel').hidden = false;
  $('start-status').textContent = `Could not load comparisons: ${errorMessage(error)}. Choose a language to retry.`;
  setMessage('');
}
async function startLanguage(id: string) {
  selected = id; compared = null;
  syncUrl();
  $('start-search').value = '';
  closeOptions();
  try { await restoreUrl(); } catch (error) { loadError(error); }
}
function closeOptions() {
  $('start-results').hidden = true;
  $('start-search').setAttribute('aria-expanded', 'false');
  $('start-search').removeAttribute('aria-activedescendant');
  optionIndex = -1;
}
function startOptions() {
  const query = $('start-search').value.trim().toLocaleLowerCase();
  const matches = catalog.filter(n => languageSearchText(n).includes(query)).slice(0, 15);
  const results = $('start-results'); results.replaceChildren(); optionIndex = -1;
  results.hidden = false; $('start-search').setAttribute('aria-expanded', 'true');
  $('start-search').removeAttribute('aria-activedescendant');
  if (!matches.length) results.append(el('p', 'No matching languages.'));
  for (const [i, n] of matches.entries()) {
    const button = el('button', n.label); button.type = 'button'; button.id = `language-option-${i}`;
    button.setAttribute('role', 'option'); button.setAttribute('aria-selected', 'false');
    button.onclick = () => startLanguage(n.id); results.append(button);
  }
}
function hideTooltip() { tooltip.hidden = true; }
function showTooltip(event: MouseEvent, title: string, description: string) {
  tooltip.replaceChildren(el('strong', title), el('span', description));
  tooltip.hidden = false;
  const box = map.getBoundingClientRect();
  tooltip.style.left = `${Math.max(10, Math.min(width - tooltip.offsetWidth - 10, event.clientX - box.left + 15))}px`;
  tooltip.style.top = `${Math.max(10, Math.min(height - tooltip.offsetHeight - 10, event.clientY - box.top + 15))}px`;
}
function setMessage(text: string) {
  const message = $('map-message');
  message.textContent = text; message.hidden = !text;
  // Keep empty-state guidance clear of the focused language at the center.
  message.style.top = selected ? '90px' : '';
  message.style.transform = selected ? 'translateX(-50%)' : '';
}
function toggleGroup(key: string) {
  if (expandedGroups.has(key)) {
    expandedGroups.delete(key);
    if (compared && languageGroup(catalog.find(n => n.id === compared)!, grouping).key === key) {
      compared = null; syncUrl(); renderDetails();
    }
  } else expandedGroups.add(key);
  // End any in-flight pan/zoom before rebuilding, then pin the camera to the center.
  svg.interrupt();
  draw({ preserveCamera: true });
}
function renderGroups(visible = catalog) {
  const groups = new Map<string, { key: string; label: string; count: number }>();
  for (const language of visible.filter(n => !n.missingComparison)) {
    const group = languageGroup(language, grouping);
    if (!groups.has(group.key)) groups.set(group.key, { ...group, count: 0 });
    groups.get(group.key)!.count++;
  }
  const legend = $('family-legend'); legend.replaceChildren();
  for (const group of [...groups.values()].sort((a, b) => a.label.localeCompare(b.label))) {
    const row = el('li'); const swatch = el('span', undefined, 'group-swatch');
    swatch.style.backgroundColor = groupColor(group.key);
    const label = el('button', group.label); label.type = 'button';
    label.disabled = !groupLanguages || !selected || group.key === 'unclassified';
    label.setAttribute('aria-expanded', String(expandedGroups.has(group.key)));
    label.onclick = () => toggleGroup(group.key);
    row.append(swatch, label, el('span', number(group.count), 'group-count'));
    legend.append(row);
  }
}
function draw({ preserveCamera = false } = {}) {
  if (preserveCamera) svg.interrupt();
  simulation?.stop(); hideTooltip();
  $('start-panel').hidden = Boolean(selected);
  document.querySelector<HTMLElement>('.map-bottom')!.hidden = !selected;
  svg.style('display', () => selected ? null : 'none');
  if (!selected || !graph) {
    simulation = null; nodes = []; edges = [];
    edgeLayer.selectAll('*').remove(); nodeLayer.selectAll('*').remove();
    $('edge-count').textContent = 'Choose a language to see its connections';
    setMessage('');
    return;
  }
  const languageView = levels > 1
    ? neighborhoodView(graph, threshold, selected, automaticThreshold ? 20 : 1500, compared, catalog, branchGraphs, levels)
    : graphView(graph, threshold, selected, automaticThreshold ? 20 : 1500, compared, catalog);
  renderGroups(languageView.nodes);
  $('grouping').disabled = !groupLanguages;
  const hint = document.querySelector<HTMLElement>('.map-hint')!;
  hint.replaceChildren(document.createTextNode(`Drag to explore · Scroll to zoom · ${groupLanguages ? 'Click a group to expand' : 'Select a language'}`));
  const visible = groupLanguages ? collapseComparisonGroups(languageView, selected, grouping, expandedGroups) : languageView;
  const old = new Map(nodes.map(n => [n.id, n]));
  const degree = new Map();
  visible.edges.forEach(e => { degree.set(e.source, (degree.get(e.source) || 0) + 1); degree.set(e.target, (degree.get(e.target) || 0) + 1); });
  nodes = visible.nodes.map(n => ({ ...n, groupKey: languageGroup(n, grouping).key, x: old.get(n.id)?.x ?? NaN, y: old.get(n.id)?.y ?? NaN,
    radius: selected ? Math.min(20, 12 + Math.sqrt(degree.get(n.id) || 0) * 2) : 14, color: groupColor(languageGroup(n, grouping).key) }));
  anchorSelection(nodes, selected, width, height);
  edges = visible.edges.map(e => ({ ...e })) as unknown as RenderEdge[];
  edgeLayer.selectAll('*').remove(); nodeLayer.selectAll('*').remove();
  edgeSelection = edgeLayer.selectAll<SVGLineElement, RenderEdge>('line').data(edges).join('line').attr('class', 'edge')
    .attr('stroke', e => d3.interpolateRgb('#344c5a', '#92bfa7')(e.similarity))
    .attr('stroke-width', e => similarityWidth(e.similarity))
    .on('pointermove', (event, e) => showTooltip(event, `${e.source.label} ↔ ${e.target.label}`, `${e.source.collapsedGroup || e.target.collapsedGroup ? 'Strongest member: ' : ''}${pct(e.similarity)} similarity · ${e.distance.toFixed(2)} distance`))
    .on('pointerleave', hideTooltip);
  nodeSelection = nodeLayer.selectAll<SVGGElement, LayoutNode>('g').data(nodes).join('g').attr('class', 'node').attr('tabindex', 0)
    .attr('role', 'button').attr('aria-label', n => `Explore ${n.label}`)
    .on('click', (event, n) => { event.stopPropagation(); n.collapsedGroup ? toggleGroup(n.collapsedGroup.key) : select(n.id); })
    .on('keydown', (event, n) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); n.collapsedGroup ? toggleGroup(n.collapsedGroup.key) : select(n.id); } })
    .on('pointermove', (event, n) => showTooltip(event, n.label, n.collapsedGroup ? `${number(n.collapsedGroup.count)} languages · Click to expand` : n.missingComparison
      ? 'No comparison collected with the centered language · Click to explore'
      : `${languageGroup(n, grouping).label} · ${degree.get(n.id) || 0} visible connections · Click to explore`))
    .on('pointerleave', hideTooltip)
    .call(d3.drag<SVGGElement, LayoutNode>().filter(event => Boolean(selected) && !event.ctrlKey && !event.button).on('start', (event, n) => {
      if (n.id === selected) return;
      hideTooltip(); if (!event.active) simulation!.alphaTarget(.15).restart(); n.fx = n.x; n.fy = n.y;
    }).on('drag', (event, n) => { if (n.id !== selected) { n.fx = event.x; n.fy = event.y; } })
      .on('end', (event, n) => { if (n.id === selected) return; if (!event.active) simulation!.alphaTarget(0); n.fx = null; n.fy = null; }));
  nodeSelection.attr('data-language-group', n => n.collapsedGroup?.key ?? null)
    .attr('aria-expanded', n => n.collapsedGroup ? 'false' : null);
  nodeSelection.attr('data-neighbor-level', n => n.level == null ? null : String(n.level));
  nodeSelection.each(function(n) {
    const group = d3.select(this);
    const shape = (cls: string, radius: number) => {
      const element = group.append((n.level ?? 0) >= 2 ? 'path' : 'circle').attr('class', cls);
      if ((n.level ?? 0) >= 2) element.attr('d', neighborShape(n.level!, radius));
      else element.attr('r', radius);
      return element;
    };
    shape('halo', n.radius + 13).attr('stroke', n.color);
    shape('core', n.radius).attr('fill', d3.color(n.color)!.darker(1.8).toString()).attr('stroke', n.color);
  });
  nodeSelection.append('circle').attr('r', 3).attr('fill', n => n.color).attr('opacity', .8);
  nodeSelection.append('text').attr('y', n => n.radius + 22).attr('text-anchor', 'middle').text(n => n.collapsedGroup ? `${n.label} (${n.collapsedGroup.count}) +` : n.label);
  simulation = null;
  if (selected) {
    simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink<LayoutNode, RenderEdge>(edges).id(n => n.id).distance(e => comparisonDistance(e.similarity)).strength(e => .08 + e.similarity * .65))
    .force('charge', d3.forceManyBody().strength(-600))
    .force('collide', d3.forceCollide<LayoutNode>().radius(n => n.radius + 38))
    .force('x', d3.forceX(width / 2).strength(.025))
    .force('y', d3.forceY(height / 2).strength(.035))
    .on('tick', tick);
    const neighbors = new Map();
    for (const e of visible.edges) {
      if (e.source === selected) neighbors.set(e.target, e.similarity);
      if (e.target === selected) neighbors.set(e.source, e.similarity);
    }
    simulation.force('focus', d3.forceRadial<LayoutNode>(n => comparisonDistance(neighbors.get(n.id) ?? 0), width / 2, height / 2)
      .strength(n => neighbors.has(n.id) ? .45 : 0));
    // Settle the focused map; the overview never runs a force simulation.
    simulation.stop(); for (let i = 0; i < 180; i++) simulation.tick();
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) simulation.alpha(.08).restart();
  }
  tick();
  fit(false, preserveCamera);
  $('edge-count').textContent = !selected ? 'No language selected · choose one to see its connections' : languageView.total > languageView.edges.length
    ? `${number(languageView.edges.length)} of ${number(languageView.total)} matching comparisons · strongest first`
    : `${number(languageView.edges.length)} comparisons · ${number(visible.nodes.filter(n => n.collapsedGroup).length)} collapsed groups`;
  const hasComparisons = selected ? graph.edges.some(e => e.source === selected || e.target === selected) : graph.edges.length > 0;
  setMessage(!selected ? '' : !hasComparisons
    ? selected ? 'No comparisons collected for this language yet. Search for another language or clear the selection.' : 'No comparisons collected yet. Import a graph with comparison results.'
    : !edges.length ? 'No connections at this similarity. Lower the minimum to explore more.' : '');
  highlight();
}
function tick() {
  // Forces arrange angles; preserve exact similarity radii despite repulsion/collision.
  constrainConnectionLengths(nodes, edges, selected);
  arrangeBranchSectors(nodes, edges, selected);
  placeDescendantNodes(nodes, selected);
  placeUncomparedNodes(nodes, selected);
  edgeSelection?.attr('x1', e => e.source.x).attr('y1', e => e.source.y).attr('x2', e => e.target.x).attr('y2', e => e.target.y);
  nodeSelection?.attr('transform', n => `translate(${n.x},${n.y})`);
}
function fit(animate = true, preserveScale = false) {
  if (!nodes.length) return;
  const anchor = nodes.find(n => n.id === selected);
  const k = d3.zoomTransform(svg.node()!).k;
  const camera = preserveScale && anchor
    ? { x: width / 2 - k * anchor.x, y: height / 2 - k * anchor.y, k }
    : viewportTransform(nodes, anchor, width, height);
  if (!camera) return;
  const transform = d3.zoomIdentity.translate(camera.x, camera.y).scale(camera.k);
  svg.interrupt();
  (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? svg.transition().duration(400) : svg).call(zoom.transform, transform);
}
function highlight() {
  if (!nodeSelection || !edgeSelection) return;
  const pair = (e: RenderEdge) => Boolean(compared) && ((e.source.id === selected && e.target.id === compared) || (e.target.id === selected && e.source.id === compared));
  const neighbors = new Set([selected]);
  edges.forEach(e => { neighbors.add(e.source.id); neighbors.add(e.target.id); });
  nodeSelection.attr('opacity', n => n.collapsedGroup ? (compared ? .22 : n.missingComparison ? .22 : 1) : compared ? n.id === selected || n.id === compared ? 1 : .22 : !selected || neighbors.has(n.id) ? 1 : .22)
    .attr('data-missing-comparison', n => n.missingComparison ? 'true' : null)
    .attr('aria-pressed', n => n.id === selected ? 'true' : 'false')
    .attr('data-comparison', n => n.id === compared ? 'true' : null)
    .attr('aria-label', n => n.collapsedGroup ? `Expand ${n.label}, ${n.collapsedGroup.count} languages` : n.id === selected ? `${n.label}, centered language` : n.id === compared ? `${n.label}, comparison selected; select again to center` : `Explore ${n.label}`);
  nodeSelection.select('.halo').style('opacity', n => n.id === selected || n.id === compared ? .8 : .12);
  nodeSelection.select('.core').attr('stroke', n => n.id === compared ? '#efcd8b' : n.color);
  edgeSelection.classed('compared', pair)
    .attr('stroke', e => pair(e) ? '#efcd8b' : d3.interpolateRgb('#344c5a', '#92bfa7')(e.similarity))
    .attr('stroke-width', e => similarityWidth(e.similarity))
    .attr('opacity', e => compared ? pair(e) ? 1 : .12 : !selected ? .25 + e.similarity * .55 : .95);
}
function select(id: string | null) {
  if (!graph) { if (id) void startLanguage(id); return; }
  const previous = selected;
  if (!id) { selected = null; compared = null; }
  else if (!selected || compared === id || id === selected) { selected = id; compared = null; }
  else compared = id;
  syncUrl();
  // Inspecting a visible neighbor should not move the graph or its camera.
  void restoreUrl({ keepLayout: selected === previous && Boolean(compared) }).catch(loadError);
}
function renderDetails() {
  const details = $('details'); details.replaceChildren();
  if (!selected || !graph) {
    details.append(el('div', 'FOLLOW YOUR CURIOSITY', 'detail-kicker'), el('h2', 'Every language has a story.'), el('p', 'Select a language to center it. Select a neighbor to highlight their comparison.'));
    return;
  }
  const node = graph.nodes.find(n => n.id === selected)!;
  const head = el('div', undefined, 'details-header'); const text = el('div');
  text.append(el('div', 'LANGUAGE SPOTLIGHT', 'detail-kicker'), el('h2', node.label));
  const clear = el('button', '×', 'clear-selection'); clear.setAttribute('aria-label', 'Clear language selection'); clear.onclick = () => select(null);
  head.append(text, clear); details.append(head);
  const classification = catalog.find(n => n.id === selected)?.classification;
  details.append(el('p', languageGroup({ classification }, grouping).label, 'language-family'));
  if (classification?.ancestors?.length) details.append(el('p', classification.ancestors.map(a => a.name).join(' → '), 'classification-path'));
  if (compared) {
    const other = graph.nodes.find(n => n.id === compared)!;
    const pair = comparisonBetween(graph, selected, compared);
    const card = el('section', undefined, 'comparison-card');
    card.append(el('div', 'SELECTED COMPARISON', 'detail-kicker'), el('h3', `${node.label} ↔ ${other.label}`));
    if (pair) {
      card.append(el('strong', `${pct(pair.similarity)} similarity`), el('p', `Distance: ${pair.distance.toFixed(2)}${pair.similarity < threshold ? ' · Below the minimum filter; shown for this comparison.' : ''}`));
      if (pair.sourceUrl) { const a = el('a', 'View comparison ↗'); a.href = pair.sourceUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; card.append(a); }
    } else card.append(el('p', 'No comparison collected for these two languages yet.'));
    card.append(el('p', `Select ${other.label} again to make it the center.`));
    details.append(card);
  } else details.append(el('p', 'Select another language to inspect its connection.'));
  const related = graph.edges.filter(e => e.source === selected || e.target === selected).slice(0, 5);
  details.append(el('p', related.length ? 'Closest measured matches' : 'No comparisons collected for this language yet.'));
  related.forEach(e => {
    const otherId = e.source === selected ? e.target : e.source;
    const other = graph!.nodes.find(n => n.id === otherId)!;
    const row = el('div', undefined, 'neighbor'); const button = el('button', other.label);
    button.onclick = () => select(otherId); row.append(button, el('span', pct(e.similarity)));
    if (e.sourceUrl) { const a = el('a', `Distance ${e.distance.toFixed(2)} · View comparison ↗`); a.href = e.sourceUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; row.append(a); }
    details.append(row);
  });
}
function search() {
  const query = $('search').value.trim().toLocaleLowerCase(); const results = $('search-results'); results.replaceChildren();
  if (!query) return;
  const matches = catalog.filter(n => languageSearchText(n).includes(query)).slice(0, 8);
  if (!matches.length) results.append(el('p', 'No matching languages in this dataset.'));
  matches.forEach(n => { const button = el('button', n.label); button.onclick = () => {
    select(n.id); $('search').value = ''; results.replaceChildren();
  }; results.append(button); });
}
window.addEventListener('popstate', () => { void restoreUrl().catch(loadError); });
$('start-search').addEventListener('input', startOptions);
$('start-search').addEventListener('focus', startOptions);
$('start-search').addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeOptions(); return; }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if ($('start-results').hidden) startOptions();
    const options = [...$('start-results').querySelectorAll('button')];
    if (!options.length) return;
    optionIndex = optionIndex < 0 ? event.key === 'ArrowUp' ? options.length - 1 : 0
      : (optionIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options.forEach((option, i) => option.setAttribute('aria-selected', String(i === optionIndex)));
    $('start-search').setAttribute('aria-activedescendant', options[optionIndex].id);
    options[optionIndex].scrollIntoView?.({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if ($('start-results').hidden) { startOptions(); return; }
    $('start-results').querySelectorAll('button')[Math.max(0, optionIndex)]?.click();
  }
});
document.addEventListener('click', event => { if (!$('start-panel').contains(event.target as Node)) closeOptions(); });
$('search').addEventListener('input', search);
$('search').addEventListener('keydown', event => { if (event.key === 'Enter') $('search-results').querySelector('button')?.click(); if (event.key === 'Escape') { $('search').value = ''; search(); } });
document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '')) { event.preventDefault(); $('search').focus(); } });
$('threshold').addEventListener('input', event => {
  automaticThreshold = false;
  threshold = Number((event.currentTarget as HTMLInputElement).value) / 100; $('threshold-value').textContent = pct(threshold);
  syncUrl('replace');
  cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
    if (graph && graphCenter === selected) void restoreUrl().catch(loadError);
  });
});
$('group-languages').addEventListener('change', () => {
  groupLanguages = $('group-languages').checked;
  expandedGroups.clear();
  if (compared) expandedGroups.add(languageGroup(catalog.find(n => n.id === compared)!, grouping).key);
  syncUrl();
  draw({ preserveCamera: true });
});
$('grouping').addEventListener('change', event => {
  grouping = (event.currentTarget as HTMLSelectElement).value as Grouping; syncUrl();
  renderGroups();
  void restoreUrl().catch(loadError);
});
$('levels').addEventListener('input', event => {
  levels = Number((event.currentTarget as HTMLInputElement).value);
  $('levels-value').textContent = String(levels);
  syncUrl();
  void restoreUrl().catch(loadError);
});
$('zoom-in').onclick = () => svg.transition().duration(200).call(zoom.scaleBy, 1.3);
$('zoom-out').onclick = () => svg.transition().duration(200).call(zoom.scaleBy, 1 / 1.3);
$('reset').onclick = () => fit();
new ResizeObserver(() => {
  const resized = width !== map.clientWidth || height !== map.clientHeight;
  width = map.clientWidth; height = map.clientHeight; svg.attr('viewBox', `0 0 ${width} ${height}`);
  if (resized && graph && graphCenter === selected) draw();
}).observe(map);
try {
  // The language index arrives with the page; only comparison graphs need fetching.
  const metadata = readLanguageData();
  catalog = normalizeGraph({ nodes: metadata.languages, edges: [] }).nodes;
  for (const language of metadata.languages) {
    if (!/^\/graphs\/[a-f0-9]{64}\.json$/.test(language.graphFile)) throw new Error('Invalid language graph index. Rebuild the graph files.');
    graphFiles.set(language.id, language.graphFile);
  }
  $('start-search').disabled = false;
  $('start-status').textContent = `${number(catalog.length)} languages available. Search by name.`;
  await restoreUrl();
} catch (error) { loadError(error); renderDetails(); }
