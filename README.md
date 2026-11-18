# eLinguistics graph data scraper

## Interactive web app

```sh
npm install
npm run dev
```

All editable frontend files live in **`web/src/`**, including TypeScript, CSS, and
HTML templates. `web/dist/` is completely disposable and Git-ignored. Both
`npm run build` and `npm run dev` delete it first and regenerate it from sources,
installed dependencies, and the datasets under `data/`.

`npm run dev` completes an initial build, then runs **`tsc --watch`** alongside the local server. Editing a `.ts` file
regenerates its browser `.js`, `.js.map`, and `.d.ts` files in `web/dist/`; refresh the
browser to see changes. CSS and HTML template edits automatically regenerate the built files. Changes to
`data/graph/index.json` or `data/languages-enriched.json` also rebuild the HTML,
including its embedded catalog and language/comparison counts. Outputs of
renamed or deleted source files are removed after each compiler cycle. Ctrl+C stops
the compiler, asset watcher, and server. Type errors appear in the terminal
and prevent emitting broken JavaScript. `npm run build` performs one compilation and
prepares the static pages and assets. `npm run typecheck` checks both frontend and
scraper code; `npm test` compiles the frontend before running the tests.

Production builds use `tsconfig.web.prod.json`: TypeScript emits only `.js` files,
without generating source maps or declarations. HTML, CSS, vendor assets, and JSON
datasets are also included in `web/dist/`. Development retains source maps and declarations.

### GitHub Pages

The workflow in `.github/workflows/pages.yml` builds and deploys on pushes to `main`,
and can also be run manually from Actions. In repository **Settings → Pages**, set
**Build and deployment → Source** to **GitHub Actions** before the first run.
The default URL is **https://maaaartin.github.io/language-map/**.

CI downloads `comparisons.tar.gz` from the `comparison-data-v1` release using the
workflow token, installs dependencies, regenerates graph exports offline, runs the
checks, and publishes `web/dist/`. That release must exist before deployment;
use `npm run compress:comparisons` and `npm run upload:comparisons` to create it.
No scraping runs during deployment.

The build uses the Pages base path for assets, navigation, and data requests,
including the nested geographic page. To build for that path locally:

```sh
SITE_BASE_PATH=/language-map npm run build
```

Never edit or commit files under `web/dist/`. Keep the sources in `web/src/`, including
`web/src/browser.d.ts` (the handwritten browser-global types).
Imports intentionally use `.js` extensions so compiled ES modules load in browsers;
TypeScript resolves those imports to the corresponding source `.ts` files.

D3 and Leaflet are npm **dev dependencies**, needed when building or developing.
The build copies D3's browser bundle and Leaflet's JavaScript, CSS, and images from
`node_modules/` into `web/dist/vendor/`. The generated app loads those local files;
it does not load either library from a CDN or require `node_modules/` in the browser.

Open **http://localhost:5173**. The D3 force graph places languages with stronger
similarity closer together. Drag nodes, pan and zoom, search for a language, or adjust
the minimum similarity. Selecting a node shows its closest measured matches and links
to the original comparisons. Colors and adjacent branches group languages by Glottolog
family and subgroup (for example Indo-European / Germanic or Indo-European / Slavic).
Use **Group languages by** to switch between families and subgroups; this is saved as
`grouping=family` in the URL. The legend and language details show group names, and
search accepts family/subgroup names. Unmatched languages are **Unclassified**;
language isolates have their own category. Similarity edges remain measured comparisons.

The page opens with a searchable language selector and no graph. Search by name, then
click an option or use Arrow Up/Down and Enter. The graph loads after that choice.
The first language, search result, or measured
neighbor you select becomes the pinned center. Selecting a second language highlights
the connection between the two and shows their similarity in the sidebar, keeping the
first language centered. Select that second language again to make it the new center
and clear the comparison highlight. Selecting a different language updates the
comparison while keeping the current center.

The selected view shows only the centered language and
its direct comparisons above the threshold, so a previous hub cannot keep its unrelated
connections in the focused graph. Similar neighbors are pulled closer. The focus
survives filtering and resizing.
An explicitly inspected comparison remains visible even if it falls below the filter;
the sidebar explains when it does. Missing comparisons are reported without inventing
an edge. Use the clear-selection button to return to the starting selector. Clicking the
background keeps the centered language and comparison selected.
Pan and zoom remain available;
the fit button recenters the selected language and its visible neighbors.

The build embeds the language index into both pages as a non-executable
`<script id="language-data" type="application/json">` block. JavaScript parses it once
and reuses the resulting object, without fetching `/languages.json`. The local server
injects the latest index on every HTML request, so reloading picks up new scrape counts
without rebuilding. Static builds contain a snapshot until the next build.
The map still preloads its coordinate dataset, `/languages-enriched.json`, and both
pages preload their JavaScript module dependencies. When the URL selects a valid language, the local
server also sends a preload hint for its graph; map URLs with `connections=none` skip it.
Styles and vendor scripts already load directly from the HTML head; font hosts are
preconnected. The server uses ETags and cache revalidation to detect changed files.

Comparisons remain in separate `/graphs/<language-hash>.json` files. Neighbor graphs
load only when needed for a newly centered language or the selected neighbor depth;
there is no background, hover, or focus prefetching. A per-page cache shares in-flight
downloads and retains up to 32 JSON responses for 15 seconds. Back/Forward and returning
to a cached language reuse them. Reloading validates the current files.
Failed requests retry on demand. No aggregate graph is downloaded,
and slow responses cannot replace a newer selection. Static hosting supports the
HTML preload hints; URL-selected graph hints require the local server.

The centered language, comparison language, and minimum similarity live in URL parameters.
Without an explicit `similarity`, the minimum adapts to each centered language to show
its nearest 20 compared neighbors (or fewer if less data exists). Ties at the cutoff
are capped at 20. Moving the slider saves an explicit percentage and removes that cap.
Languages with missing comparisons remain separate nodes in the outer ring.

The **Neighbor levels** slider selects 1–5 hops (1, direct neighbors, is the default).
Deeper levels progressively load the displayed frontier's graph files, with at most
four requests at once. The similarity filter applies at every level; the automatic
default limits each branch to 20 comparisons, with 1,500 edges overall. Each language
appears at its shortest hop, with one strongest parent in the previous level.
Nested branch sectors keep the automatic tree layout free of edge crossings.
Shapes identify levels: 1 circle, 2 diamond, 3 triangle, 4 square, 5 hexagon.
The selection is saved as `levels=2` through `levels=5` in the URL and restored on
reload and Back/Forward.

```text
http://localhost:5173/?language=English&compare=German&similarity=20
```

`language` and `compare` use the scraper's exact language IDs. `similarity` is a percentage
from 0 to 100; omitting it uses the automatic nearest-20 default. Selections update the URL immediately; refresh, shared
links, and Back/Forward restore the same state. Invalid IDs return to the selector without
fetching comparisons. Shared URLs use the local server's current dataset on reload.

Development is local only. The server binds to `127.0.0.1`; no hosting or deployment is configured.

The local server reads `data/graph/index.json` and individual files under
`data/graph/languages/` directly; it never scans the aggregate graph for a request.
Restart `npm run dev` after upgrading to this endpoint layout. Refresh or choose a new
center after collecting more pairs.
The graph loads the scraper's generated data from the server and shows up to 1,500
connections above the selected threshold to keep larger
datasets responsive, and reports when connections are limited. Node details still use
all collected comparisons. Selecting a language shows only its qualifying direct
connections. The selector also includes languages without collected comparisons; a focused
language with no qualifying comparisons remains centered, with uncompared languages in the outer ring.

`npm run build` prepares the standalone static app in `web/dist`, including the language
index, individual graph files, and a local D3 bundle. Serve that folder with any static web server. No backend
or API key is needed. Fonts have system fallbacks if Google Fonts is unavailable.

Existing datasets are split automatically on the first build. To explicitly regenerate
the per-language files from an existing aggregate export, without any web requests:

```sh
npm run graph:split
# Or for another dataset:
npm run graph:split -- --data-dir data/other
```

Builds preserve an existing per-language index, including newer importer checkpoints.
If an importer was force-killed, resume it or run `compare --export-only` (after resolving
its stale lock) to recover any saved comparisons that had not reached a checkpoint.
The combined `data/graph.json` and CSV files remain available for analysis in external tools.

## Geographic map (`/map`)

Open **http://localhost:5173/map**, or choose **Map** in the header. This page uses Leaflet
and OpenStreetMap tiles to display the reference coordinates from
`data/languages-enriched.json`. If needed, generate that file first:

```sh
npm run map:languages
npm run dev
```

The page plots matched records with valid numeric latitude and longitude. Unmatched
records and missing coordinates are counted but never placed at a guessed location.
Pins at exactly the same coordinates are grouped with a count; their popup lists every
record. Click a pin or a language in the searchable list to see country associations,
ISO/Glottolog codes, record type, coordinates, and a link to its comparison graph.
Search also supports country names/codes, and a record-type filter distinguishes
languages, dialects, and families. **Show all locations** fits the current results.

Selecting a map pin or a language in the list automatically loads and highlights its
closest languages. It fetches the lightweight comparison index once, then only that
language's graph file. The map draws links to its **10 most
similar mapped matches**, ranks them by similarity in a sidebar, and dims unrelated pins.
Comparisons without mapped coordinates are counted and skipped before choosing the ten
matches. Identical reference locations are listed explicitly. Search/type filters also
control which connection endpoints are visible.

Hover a link or click a sidebar match to highlight that pair and see its score. Link
popups open the same pair in the comparison graph. Both the map and graph share the same
increasing line-width scale: more similar languages have substantially thicker links.
Selection changes color/opacity while preserving the score-based width. Click the map
background to deselect the language, close the popup, and clear all links and highlights.
Pin, link, and popup clicks do not trigger background deselection. **Clear connections**
removes only the links while keeping the language selected; this explicitly disabled
view is stored as `connections=none`. Select a language again to show its links.

Map connection state is shareable, for example
`/map?language=English&connections=closest&compare=German`. Reload/Back/Forward restore
the closest-link view and highlighted pair. Selecting a different language clears the
previous links, and its popup can load a fresh set; stale responses are ignored.

The selected language is stored in the `language` URL parameter. Navigation between
Graph and Map carries the current selection. These are Glottolog reference points,
including family centroids and historical records; they do not show a language's full
geographic extent or necessarily its present-day distribution.

`/languages-enriched.json` reads the current local enrichment file directly, so refresh
after remapping. Static builds copy it alongside locally bundled Leaflet assets; the
generated country-enrichment JSON, graph exports, browser dataset copies, rendered
HTML, and vendor assets are Git-ignored. Edit the templates in `web/src/index.html`
and `web/src/map/index.html`; application TypeScript and CSS also live in `web/src/`.
The application remains local, while
OpenStreetMap basemap tiles require internet access and display their attribution.
No API key is required. Restart the dev server after upgrading to add the new route.

## Map languages to countries and coordinates

`npm ci` (or `npm install`) first extracts `comparisons.tar.gz` into
`data/comparisons/`, then runs the mapper through `postinstall`, using the
repository's **`data/glottolog/languages.csv`** and **`data/languages.json`**. It
regenerates `data/languages-enriched.json` and prints match counts without downloading
any datasets. Missing or invalid source files fail installation.

Run `npm run decompress:comparisons` to restore deleted comparison JSON files
from `comparisons.tar.gz`. The command checks that the archive is a readable file
before extracting and does not delete existing JSON files. Files present in the
archive overwrite their local copies; files outside the archive are preserved.

Store the comparison archive as a GitHub Release asset with these commands
(requires the GitHub CLI, installed with `brew install gh`, and `gh auth login`):

```sh
npm run compress:comparisons
npm run upload:comparisons
# On another checkout, before npm install/ci:
npm run download:comparisons
npm ci
# Or just extract the downloaded archive:
npm run decompress:comparisons
```

The release commands default to `Maaaartin/language-map` and tag
`comparison-data-v1`. Override them with, for example,
`npm run upload:comparisons -- --tag comparison-data-v2 --repo OWNER/REPO`.
Use the same tag when downloading. Upload creates the release from remote `main`
if missing; an existing asset with the same name is rejected, so use a new tag for
updated data. Downloads replace the local archive only after a successful download.
Private repository downloads require GitHub authentication and repository access.
These commands do not commit or push Git history. Release storage also requires
removing the archive from any unpushed commits and ignoring it to avoid GitHub's
regular Git file limit.

Keep the reference CSV and its source/checksum metadata in version control, along
with `data/glottolog/classification.nex` and its metadata, scraped `data/languages.json`,
and `data/comparisons/*.json`. Derived mapping
outputs remain Git-ignored. The downloader is available only as an explicit command
to refresh [Glottolog's languages.csv](https://github.com/glottolog/glottolog-cldf/blob/master/cldf/languages.csv).

```sh
npm ci
# Optional: rerun setup without reinstalling dependencies:
npm run postinstall
# Optional: regenerate the mapping and print every matched/unmatched language:
npm run map:languages
# Explicitly download or refresh the reference CSV:
npm run download:glottolog
npm run download:glottolog -- --force
# Explicitly download or refresh the subgroup classification reference:
npm run download:classification
npm run download:classification -- --force
npm run postinstall
```

The TypeScript mapper reads `data/languages.json`, prints every matched and unmatched
language, and writes **`data/languages-enriched.json`**. It preserves the original input.
Matching requires exact, case-sensitive equality between the stored `label` and the
CSV's `Name` column: no trimming, case folding, aliases, fuzzy matching, word reordering,
or removal of dialect qualifiers. Multiple records with the same exact name are reported
as unmatched/ambiguous instead of selecting one arbitrarily.

The mapper also resolves the CSV's `Family_ID` and the local Glottolog
[`classification.nex`](https://github.com/glottolog/glottolog-cldf/blob/master/cldf/classification.nex)
tree into `classification.family`, `classification.branch`, and the full family
ancestry. Familiar Indo-European subgroup labels are selected from actual ancestors;
other groups use their first available subgroup. Dialects follow `Language_ID` for
classification only; missing geography is never inherited. If the optional tree is
absent, top-level families from the CSV remain available. Installation never downloads
the tree. Restart `npm run dev` after updating the server to enable enriched catalog
responses; static builds merge classification with the language index as well.

Matched entries retain their original ID and label and add:

```json
{
  "matchStatus": "matched",
  "glottolog": {
    "glottocode": "abkh1244",
    "name": "Abkhaz",
    "level": "language",
    "iso6393": "abk",
    "latitude": 43.056218,
    "longitude": 41.159115,
    "countries": ["GE", "RU", "TR"]
  }
}
```

Countries are the CSV's ISO 3166-1 alpha-2 country codes; coordinates describe the
Glottolog record, not each country's geographic center. Empty coordinates/ISO codes
become `null`; empty country lists become `[]`. Nothing is inherited from parent records.
The source includes families and dialects as well as languages: exact name matches
preserve that distinction in `level`, including group-level coordinates for families.
Historical records are not evidence that a language is currently spoken in a country.

Unmatched entries have `glottolog: null`, a reason (`no_exact_name` or
`multiple_exact_names`), and candidate Glottocodes for ambiguous names. The output also
records match counts, missing-geography counts, source files, and the CSV's SHA-256.

```sh
# Map another language list while reusing the shared reference CSV:
npm run map:languages -- --data-dir data/other
# Use another CSV or output path:
npm run map:languages -- --csv data/glottolog/languages.csv --output data/mapping.json
```

Glottolog is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The download metadata retains the source repository, URL, download time, and checksum;
see the repository's README for version-specific citation information. This mapping
step is independent of comparison scraping and does not alter the app's graph files.

## Collect comparison data

Two TypeScript scripts fetch the language dropdowns and detailed pairwise results from
[eLinguistics](http://elinguistics.net/Compare_Languages.aspx). Runs on Node.js 22+.

```sh
npm install
npm run languages
npm run compare -- --languages 'Altai,Uzbek,English,German' --limit 6
```

The first command saves the complete list in `data/languages.json`. Language IDs match
the site's option values exactly, including underscores and parentheses. Labels replace
underscores with spaces. `--languages` accepts comma-separated **IDs** from this file.
Omit it to select every language.

Inspect the scope before collecting the full dataset:

```sh
npm run compare -- --dry-run
npm run compare -- --limit 100
# Continue: existing successful comparisons are reused automatically.
npm run compare -- --limit 100
# Create the full queue and export all language nodes without making requests:
npm run import:all -- --queue-only
# Start/resume the queue for ALL languages in data/languages.json:
npm run import:all
```

In a terminal, the importer detects and displays the **latest successfully downloaded
comparison and its fetch time** for the selected languages/source, then shows:

```text
Choose an import action:
  1. Update all — download every selected pair again
  2. Continue from latest — skip saved pairs and retry gaps (default)
```

Enter `1` or `2`; pressing Enter selects Continue. Latest is determined by the saved
fetch timestamp, with the comparison file's modification time as a fallback. Continuing
checks every pair, so missing results before the latest download are also retried.
Update all bypasses saved comparison JSON and replaces each result only
after a successful fetch. Failed refreshes keep the old result available in the graph.

HTML responses are parsed once in memory and discarded. Only compact comparison JSON
is retained for resume; HTML files are never written. At startup, the collector deletes
legacy `.html` files under the selected data directory's `raw/` folder. Parser fixtures
under `tests/fixtures` are kept. Scraped language lists and parsed comparison results
are eligible for version control. Graph JSON exports, browser dataset copies,
country-enrichment outputs, analysis CSVs, queues, runtime logs/locks, and bundled dependencies are Git-ignored, including in the
nested `web/` repository. The rules also cover dataset subdirectories under `data/`.

Progress distinguishes **saved this run** from **available comparisons** and marks each
result as `Refreshed` or `New`. Refreshing an existing pair replaces its saved data; it
does not increase the available count. That count grows only when a missing pair is
collected. `queue-progress.json` also records `refreshedThisRun` and `addedThisRun`.

For commands without a menu:

```sh
npm run import:all -- --mode continue
npm run import:all -- --mode all
```

Noninteractive runs default to Continue. `--queue-only`, `--export-only` and `--dry-run`
never prompt or fetch. `queue-progress.json` also records the mode and latest downloaded
pair. In Update all mode, `completed` counts successful refreshes in this run;
`availableComparisons` includes previous results still available to the app. Choosing
Continue after a partial refresh fills missing comparisons while retaining all saved
results; choose Update all to refresh every pair again.

The live list contained 596 languages on November 14, 2026: **177,310 unique pairs**.
At the default one-second interval, a complete run takes at least about 49 hours,
plus response time and retries. Start with a subset or a limit. The fetch queue defaults
to **one active job**; it never starts every request at once. `--delay-ms 2000` increases
the shared interval between request starts. Timeouts are 30 seconds, with up to three
retries for network errors, HTTP 429, and server errors. `Retry-After` is respected.

The immutable queue plan is saved in `data/queues/<hash>.json`. It lists every unique
language pair; successfully saved comparison files acknowledge completed jobs. On resume,
the script reconciles the plan with those files and processes only unfinished pairs,
including failures from the previous run, when using Continue. A changed language selection or source URL
gets its own queue. Queue workers take the next pair only after finishing their current
job; retries use that same worker slot.

`data/queue-progress.json` reports completed, pending, active, and failed counts after
each attempt. The language index includes **every selected language immediately**.
Every 25 finished attempts, only the affected per-language graph files are rewritten
atomically; each comparison appears in both endpoint files. The index is updated after
the files. Use `--checkpoint-every 10` for more frequent updates. Combined graph/CSV
exports are written at startup and graceful shutdown, rather than at every checkpoint.

```sh
# Process at most 100 unfinished pairs, then exit; rerun to continue:
npm run import:all -- --limit 100
# Optional bounded concurrency; request starts still share a 1-second interval:
npm run import:all -- --concurrency 2 --delay-ms 1000
```

`import:all` uses every language by default; `compare` remains available for explicit
subsets with `--languages`. Neither command publishes or starts the web app.

## Output

| File | Contents |
| --- | --- |
| `data/languages.json` | Complete source language list, IDs, labels, source URL, fetch time |
| `data/comparisons/<hash>.json` | One detailed comparison: distance, similarity, word scores, consonants, spellings, comments, statistics, references and source URL |
| `data/graph.json` | Selected language nodes and all successfully collected edges for that selection |
| `data/graph/index.json` | Lightweight language index, graph-file URLs, and total comparison count |
| `data/graph/languages/<language-hash>.json` | One language and its direct comparisons; updated incrementally |
| `data/nodes.csv`, `data/edges.csv` | UTF-8 CSV exports for graph tools and analysis |
| `data/failures.jsonl` | Append-only error history; failed comparisons are attempted on subsequent runs |
| `data/queues/<hash>.json` | Persistent plan of unique language pairs for this selection and source |
| `data/queue-progress.json` | Latest collector's completed, pending, active and failed counts |

An edge looks like this (additional provenance and statistical fields omitted):

```json
{
  "source": "Altai",
  "target": "Uzbek",
  "distance": 18.43,
  "similarity": 0.8157,
  "wordCount": 18
}
```

`distance` is the site's score from 0 to 100: smaller values mean closer matches.
`similarity = 1 - distance / 100` is a derived weight from 0 to 1: larger means closer.
Use similarity for link strength, or distance for graph layout distance. Zero-distance
pairs retain a real edge. Missing or failed pairs have **no edge**, rather than a zero
score. `expectedPairs`, `completedPairs`, and `complete` describe coverage.

The graph treats comparison distances as undirected and fetches one ordering per pair,
using lexically sorted IDs. Self-comparisons are omitted. This is a graph of the site's
lexical comparison scores; it does not independently establish language ancestry.
The original statistics and references remain available for interpretation.

For D3's conventional `links` property:

```ts
const graph = JSON.parse(await readFile('data/graph.json', 'utf8'));
const d3Data = { nodes: graph.nodes, links: graph.edges };
// d3.forceLink(d3Data.links).id(node => node.id)
```

## Resume, export, and options

`--limit N` bounds pair-processing attempts in that invocation, including failures.
In Continue mode, cached JSON comparisons do not count against
it. In Update all mode, refreshing a cached pair counts as an attempt. Every run
exports all available comparisons for the selected languages, including cached ones.
Exporting a different selection replaces the graph and CSV exports; detailed comparison
files remain available.

```sh
# Rebuild exports from cached comparison JSON only; no requests:
npm run compare -- --export-only
# Keep a different dataset in its own directory:
npm run languages -- --data-dir data/other
npm run compare -- --data-dir data/other --languages 'English,German'
```

Both scripts accept `--data-dir`, `--base-url` and `--delay-ms`. Pass the same base URL
to both scripts when overriding it. Cache filenames hash the entire comparison URL.

Ctrl+C stops dequeuing jobs, finishes active pairs, and writes exports before exiting. Individual JSON
files are written atomically. Successful comparisons are reused on subsequent
runs. A lock prevents simultaneous collectors in the same data directory. If a process
is force-killed, confirm it is no longer running and remove `data/.compare.lock` before
resuming or regenerating its graph with `--export-only`.
Failed runs exit with status 1 after exporting successful edges; inspect `failures.jsonl`.
Failed pages are not saved and are fetched again on retry. To refresh a successful pair,
remove its comparison JSON or choose Update all. Missing comparison JSON is refetched;
it cannot be rebuilt from an HTML cache. Avoid simultaneous writers to the same data directory.

```sh
npm run typecheck
npm test
```

Tests cover real saved HTML, Unicode and decimal parsing, rejected incomplete results,
URL encoding, queue concurrency and limits, shared request spacing, failures, cancellation,
and local HTTP fixture runs that check all-language plans, exports, locking, resume,
latest-download detection and fresh updates that preserve old results on failure.
