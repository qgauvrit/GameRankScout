import { normalizeTitle } from './dictionary.js';
import type { Dictionary, DictionaryEntry } from './dictionary.js';

export interface Mention {
  gameId: string;
  /** The catalogue's spelling of the game. */
  name: string;
  /** The text exactly as it appeared, for auditing extraction. */
  surface: string;
  start: number;
  end: number;
}

interface Token {
  normalized: string;
  start: number;
  end: number;
}

/**
 * Splits text into tokens, keeping each token's offsets in the original string
 * so a match can be checked for capitalisation and quoting afterwards.
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /[\p{L}\p{N}]+(?:['’`][\p{L}\p{N}]+)*/gu;

  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const normalized = normalizeTitle(raw);
    if (!normalized) continue;
    tokens.push({
      normalized,
      start: match.index,
      end: match.index + raw.length,
    });
  }
  return tokens;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  fail: TrieNode | null;
  /** Entries whose full token sequence ends at this node. */
  outputs: DictionaryEntry[];
  depth: number;
}

function createNode(depth: number): TrieNode {
  return { children: new Map(), fail: null, outputs: [], depth };
}

export interface CompiledMatcher {
  root: TrieNode;
}

const matcherCache = new WeakMap<Dictionary, CompiledMatcher>();

/**
 * Builds an Aho-Corasick automaton over *token sequences* rather than
 * characters. Matching on tokens means word boundaries are structural — a
 * pattern can never match inside a longer word — and one pass over the text
 * finds every title regardless of dictionary size.
 */
export function compileMatcher(dictionary: Dictionary): CompiledMatcher {
  const cached = matcherCache.get(dictionary);
  if (cached) return cached;

  const root = createNode(0);

  for (const entry of dictionary.entries) {
    let node = root;
    for (const token of entry.tokens) {
      let next = node.children.get(token);
      if (!next) {
        next = createNode(node.depth + 1);
        node.children.set(token, next);
      }
      node = next;
    }
    node.outputs.push(entry);
  }

  // Breadth-first failure links.
  const queue: TrieNode[] = [];
  for (const child of root.children.values()) {
    child.fail = root;
    queue.push(child);
  }

  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const [token, child] of node.children) {
      let fail = node.fail;
      while (fail && !fail.children.has(token)) fail = fail.fail;
      child.fail = fail?.children.get(token) ?? root;
      // Inherit outputs so a suffix pattern is not missed.
      child.outputs = [...child.outputs, ...(child.fail?.outputs ?? [])];
      queue.push(child);
    }
  }

  const compiled = { root };
  matcherCache.set(dictionary, compiled);
  return compiled;
}

const QUOTE_CHARS = new Set(['"', "'", '“', '”', '‘', '’', '«', '»', '`']);

/** True when the surface text is quoted, e.g. `"portal"`. */
function isQuoted(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 2), start).trim().slice(-1);
  const after = text.slice(end, end + 2).trim().slice(0, 1);
  return QUOTE_CHARS.has(before) && QUOTE_CHARS.has(after);
}

/**
 * True when the surface is written as a title: each significant word
 * capitalised, or the whole thing in caps ("LIMBO", "TW3").
 */
function isTitleCased(surface: string): boolean {
  const words = surface.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  const significant = words.filter((w) => /[\p{L}]/u.test(w));
  if (significant.length === 0) {
    // All-numeric surface — no capitalisation signal available.
    return false;
  }

  return significant.every((word) => {
    const first = word[0]!;
    // Short connectives inside a title are conventionally lower case.
    if (word.length <= 3 && /^(of|the|and|a|an|to|in|on|at|is)$/i.test(word)) return true;
    return first === first.toUpperCase() && first !== first.toLowerCase();
  });
}

export interface ExtractOptions {
  /** Overrides the default guard behaviour; used by the precision harness. */
  requireEvidenceForAmbiguous?: boolean;
}

/**
 * Finds game mentions in free text.
 *
 * Strategy per KTD3: a single automaton pass produces candidate spans, then
 * guards decide which survive. Guards are applied after matching rather than
 * during it, so a rejected ambiguous title cannot mask a longer real title that
 * overlaps it.
 */
export function extractMentions(
  text: string,
  dictionary: Dictionary,
  options: ExtractOptions = {},
): Mention[] {
  const { requireEvidenceForAmbiguous = true } = options;
  if (!text) return [];

  const tokens = tokenize(text);
  if (tokens.length === 0) return [];

  const { root } = compileMatcher(dictionary);

  interface Candidate {
    entry: DictionaryEntry;
    startToken: number;
    endToken: number;
  }
  const candidates: Candidate[] = [];

  let node = root;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!.normalized;
    while (node !== root && !node.children.has(token)) node = node.fail ?? root;
    node = node.children.get(token) ?? root;

    for (const entry of node.outputs) {
      candidates.push({
        entry,
        startToken: i - entry.tokens.length + 1,
        endToken: i,
      });
    }
  }

  // Apply guards before overlap resolution.
  const surviving = candidates.filter((candidate) => {
    const start = tokens[candidate.startToken]!.start;
    const end = tokens[candidate.endToken]!.end;
    const surface = text.slice(start, end);

    if (!requireEvidenceForAmbiguous) return true;

    // A multi-word title is distinctive enough to stand on its own, even in
    // lower case — "fallout 4" or "days gone" is not something you type by
    // accident. A single word is not: the stoplist can never enumerate every
    // English word that is also a game title (hook, risen, lost, gravitas all
    // appeared in the sample), so capitalisation evidence is required for all
    // of them rather than only the ones anyone thought to list.
    const needsEvidence = candidate.entry.ambiguous || candidate.entry.tokens.length === 1;
    if (!needsEvidence) return true;

    return isTitleCased(surface) || isQuoted(text, start, end);
  });

  // Leftmost-longest: a longer title wins over a shorter one it contains.
  surviving.sort((a, b) => {
    if (a.startToken !== b.startToken) return a.startToken - b.startToken;
    return b.endToken - b.startToken - (a.endToken - a.startToken);
  });

  const mentions: Mention[] = [];
  const seenGames = new Set<string>();
  let consumedThrough = -1;

  for (const candidate of surviving) {
    if (candidate.startToken <= consumedThrough) continue;
    consumedThrough = candidate.endToken;

    if (seenGames.has(candidate.entry.gameId)) continue;
    seenGames.add(candidate.entry.gameId);

    const start = tokens[candidate.startToken]!.start;
    const end = tokens[candidate.endToken]!.end;
    mentions.push({
      gameId: candidate.entry.gameId,
      name: candidate.entry.name,
      surface: text.slice(start, end),
      start,
      end,
    });
  }

  return mentions;
}
