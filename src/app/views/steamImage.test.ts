import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { STEAM_IMAGE_HOST, steamHeaderImage } from './steamImage.js';
import type { StoreLink } from '../../corpus/schema.js';

const steam = (url: string): StoreLink[] => [{ store: 'steam', url }];

describe('steamHeaderImage', () => {
  it('builds the header URL from a canonical Steam store link', () => {
    expect(steamHeaderImage(steam('https://store.steampowered.com/app/292030/The_Witcher_3/'))).toBe(
      `https://${STEAM_IMAGE_HOST}/steam/apps/292030/header.jpg`,
    );
  });

  it('handles a Steam link with no trailing slug segment', () => {
    expect(steamHeaderImage(steam('https://store.steampowered.com/app/570'))).toBe(
      `https://${STEAM_IMAGE_HOST}/steam/apps/570/header.jpg`,
    );
  });

  it('returns null when there is no Steam link', () => {
    expect(steamHeaderImage([{ store: 'gog', url: 'https://www.gog.com/game/foo' }])).toBeNull();
  });

  it('rejects a store:steam link whose host is not the Steam store', () => {
    expect(steamHeaderImage(steam('https://evil.example.com/app/123/'))).toBeNull();
  });

  it('rejects a non-numeric or path-traversal app id', () => {
    expect(steamHeaderImage(steam('https://store.steampowered.com/app/..%2f..%2fx/'))).toBeNull();
    expect(steamHeaderImage(steam('https://store.steampowered.com/app/abc/'))).toBeNull();
  });

  it('returns null when the URL has no /app/<id>/ segment', () => {
    expect(steamHeaderImage(steam('https://store.steampowered.com/'))).toBeNull();
  });

  it('returns null for a malformed URL', () => {
    expect(steamHeaderImage(steam('not a url'))).toBeNull();
  });
});

describe('CSP host guard', () => {
  it('the pinned image host is the one allowed in public/_headers (no drift)', () => {
    const headers = readFileSync(
      fileURLToPath(new URL('../../../public/_headers', import.meta.url)),
      'utf8',
    );
    const csp = headers.split('\n').find((line) => line.includes('Content-Security-Policy'));
    expect(csp).toBeDefined();
    expect(csp).toContain(`img-src 'self' data: https://${STEAM_IMAGE_HOST}`);
  });
});
