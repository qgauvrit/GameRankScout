import type { StoreLink } from '../../corpus/schema.js';

/**
 * The one third-party image host the app talks to. Exported so a test can assert
 * it matches the host allowed in `public/_headers` — a mismatch would silently
 * darken every hero under the production CSP (the two must not drift).
 */
export const STEAM_IMAGE_HOST = 'cdn.cloudflare.steamstatic.com';

/** The only host a Steam store link is trusted to point at. */
const STEAM_STORE_HOST = 'store.steampowered.com';

/**
 * The Steam header-image URL for a game, or `null` when one cannot be derived.
 *
 * Store links come out of the corpus, which is built from Reddit/Lemmy posts —
 * the app's trust boundary — and `storeLinkSchema` only checks the `store` enum
 * and that the URL is http(s). So a `store: 'steam'` link is not trusted to be a
 * real Steam URL: the host must be {@link STEAM_STORE_HOST} and the app id must
 * be a run of digits in the `/app/<id>/` segment. Anything else returns `null`
 * rather than shaping a request out of untrusted text.
 */
export function steamHeaderImage(storeLinks: StoreLink[]): string | null {
  const steam = storeLinks.find((link) => link.store === 'steam');
  if (!steam) return null;

  let host: string;
  let pathname: string;
  try {
    const url = new URL(steam.url);
    host = url.hostname;
    pathname = url.pathname;
  } catch {
    return null;
  }

  if (host !== STEAM_STORE_HOST) return null;

  const match = pathname.match(/\/app\/(\d+)(?:\/|$)/);
  if (!match) return null;

  return `https://${STEAM_IMAGE_HOST}/steam/apps/${match[1]}/header.jpg`;
}
