# Streambox

Streambox is a responsive, build-free movie and TV catalog powered by TMDB. The frontend remains in the project root (`index.html`, `app.js`, and `styles.css`) and is deployed together with a small Cloudflare Worker.

## Included features

- Full search results with shareable query, type, genre, year, rating, sort, and page state.
- Filtered and sortable Movies and TV catalog pages.
- Search suggestions with a complete-results action.
- Device-local watchlist filtering and sorting.
- Continue Watching remembers the exact TV season, episode, and selected playback source.
- A clear-history action for Continue Watching.
- Named playback sources, a Try Next Source action, slow-source feedback, and remembered source preference.
- Aired episode metadata with names, thumbnails, dates, and future-episode filtering.
- Responsive TMDB image `srcset` values and browser/edge API caching.
- One production origin: `https://streambox.robpertua.workers.dev/`.

## Cloudflare deployment

The Worker serves the static site and handles allowlisted requests under `/api/tmdb/*`. TMDB credentials are never stored in frontend JavaScript or committed configuration.

1. Rotate the TMDB credential that was previously exposed in `app.js` from your TMDB account.
2. From this directory, store the replacement credential as a Cloudflare secret:

   ```bash
   npx wrangler secret put TMDB_TOKEN
   ```

   A TMDB API Read Access Token is recommended. The Worker also supports a v3 key through `TMDB_API_KEY` if required:

   ```bash
   npx wrangler secret put TMDB_API_KEY
   ```

3. Deploy the Worker and static assets:

   ```bash
   npx wrangler deploy
   ```

For local Worker development, copy `.dev.vars.example` to `.dev.vars`, add a replacement credential, and run:

```bash
npx wrangler dev
```

Never commit `.dev.vars`.

## Project structure

```text
Streambox/
├── index.html          # App shell and production metadata
├── app.js              # Catalog, search, playback, and saved-state logic
├── styles.css          # Complete responsive design system
├── worker.mjs          # Allowlisted TMDB proxy and edge cache
├── wrangler.jsonc      # Worker and static-assets configuration
├── .assetsignore       # Files excluded from public static assets
├── .dev.vars.example   # Local secret-name example only
├── favicon.ico
├── favicon.svg
├── apple-touch-icon.png
├── og-image.jpeg
├── robots.txt
└── sitemap.xml
```

## Playback notes

Streambox keeps the currently configured external playback sources and displays their real names. Cross-origin iframe restrictions prevent the app from proving that a video itself started, so a slow-source message and manual Try Next Source control are provided. A source preference is saved only after its iframe finishes loading.

Streambox does not host media files. Playback and download links are provided by independent third parties and may change or be unavailable by title or region.
