/**
 * Adds the DOM-shaped assertions the component tests read with. Safe to load for
 * every suite: it only extends `expect`, and never touches a document at import
 * time, so the node-environment tests are unaffected.
 *
 * Component suites opt into a DOM with a `@vitest-environment jsdom` docblock
 * rather than a config glob, so the environment a file needs is visible in the
 * file itself.
 */
import '@testing-library/jest-dom/vitest';

/**
 * Node 26 ships its own `localStorage` global that reads as `undefined` unless
 * the process was started with `--localstorage-file`, and it shadows the one
 * jsdom installs. A component test would therefore see no storage at all — and
 * the offline corpus cache is precisely what those tests exist to exercise.
 *
 * So the DOM suites get their storage from jsdom explicitly. Borrowing a real
 * `Storage` rather than hand-rolling one keeps the quota and key-coercion
 * behaviour the app actually runs against. `sessionStorage` is the tell that a
 * DOM is present at all; the node-environment suites are left alone.
 */
if (typeof globalThis.sessionStorage !== 'undefined') {
  const { JSDOM } = await import('jsdom');
  const { window } = new JSDOM('', { url: 'http://localhost:5173/' });
  Object.defineProperty(globalThis, 'localStorage', {
    value: window.localStorage,
    configurable: true,
    writable: true,
  });

  // jsdom does not implement matchMedia, but Astryx components query it (for
  // reduced-motion and responsive behaviour), so every themed render would
  // throw without this. The conventional no-match stub: nothing matches, and
  // listener registration is a no-op.
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string): MediaQueryList =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    });
  }

  // jsdom does not implement the <dialog> modal methods, but the Astryx Dialog
  // (the filter and evidence sheets) calls them. The conventional polyfill
  // toggles the `open` attribute the methods reflect, so open/close is testable.
  const dialogProto = globalThis.HTMLDialogElement?.prototype;
  if (dialogProto && typeof dialogProto.showModal !== 'function') {
    dialogProto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    dialogProto.show = function show(this: HTMLDialogElement) {
      this.open = true;
    };
    dialogProto.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
}
