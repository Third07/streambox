# Streambox

Streambox is a responsive, build-free movie, TV, and anime catalog powered by TMDB. Its RTNW-themed frontend remains in the project root (`index.html`, `app.js`, and `styles.css`) and is deployed together with a small Cloudflare Worker.

## Included features

- Full search results with shareable query, type, genre, year, rating, sort, and page state.
- Filtered and sortable Movies and TV catalog pages.
- Search suggestions with a complete-results action.
- Device-local watchlist filtering and sorting.
- Continue Watching remembers the exact TV season, episode, and selected playback source.
- A clear-history action for Continue Watching.
- Named playback sources, a Try Next Source action, slow-source feedback, and remembered source preference.
- VidLink and VidLove integrations with provider-specific options, origin-checked player events, progress resume, and conflict-free episode switching.
- A best-effort Skip Intro action for VidLove TV playback while the episode is near its beginning.
- A dedicated anime destination and home-page anime rail.
- Aired episode metadata with names, thumbnails, dates, and future-episode filtering.
- Responsive TMDB image `srcset` values and browser/edge API caching.
- Cloudflare static-asset security headers and API no-index headers.
- One production origin: `https://streambox.rtnw.online/`.

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

   For compatibility, a 32-character v3 API key stored under `TMDB_TOKEN` is detected automatically. Values copied with surrounding quotes or a `Bearer ` prefix are normalized before use.

3. Confirm Wrangler is signed in to the Cloudflare account that owns the `rtnw.online` zone:

   ```bash
   npx wrangler whoami
   ```

4. Deploy the Worker and static assets:

   ```bash
   npx wrangler deploy
   ```

The `routes` entry in `wrangler.jsonc` attaches `streambox.rtnw.online` as a Worker Custom Domain. Because `rtnw.online` already uses Cloudflare nameservers, Cloudflare creates the subdomain DNS record and TLS certificate during setup. No Hostinger DNS record is needed. If the zone and Worker are in different Cloudflare accounts, move the Worker or zone into the same account before deploying.

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
├── _headers            # Security headers for Cloudflare static assets
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

Streambox keeps the currently configured external playback sources and displays their real names. VidLink and VidLove messages are accepted only from the current iframe and the provider's exact origin, preventing stale events when a viewer changes servers. Streambox disables provider-owned next-episode controls on these integrations so its season, episode, URL, and Continue Watching state remain aligned.

VidLove documents external seeking, so Streambox can offer an 85-second best-effort Skip Intro action near the beginning of TV episodes. Neither provider publishes exact title-specific intro markers, so this is intentionally a timed shortcut rather than scene detection. VidLink playback resumes through its documented `startAt` option. Sources without event APIs retain load feedback and a manual Try Next Source control.

Streambox does not host media files. The obsolete third-party downloader was removed. When TMDB supplies a Philippines watch-provider destination, the watch page links to that regional availability page instead.
