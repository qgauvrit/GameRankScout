/**
 * Stone's typefaces (R5): Figtree for body and labels, Montserrat for headings.
 *
 * @fontsource ships the woff2 files inside the package; importing its CSS here
 * declares the @font-face rules with URLs that Vite bundles into the app's own
 * `dist/assets`, so the faces are served from this origin and precached with the
 * shell — nothing at runtime reaches a third-party font host. Stone also names
 * JetBrains Mono for code, but GRS renders none, so that face is not vendored.
 *
 * Weights match the ones the Stone theme actually asks for: regular and
 * semibold body, semibold and bold headings.
 */
import '@fontsource/figtree/400.css';
import '@fontsource/figtree/600.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
