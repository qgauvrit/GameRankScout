/**
 * Game titles that are also ordinary English words or phrases.
 *
 * These are not excluded from the dictionary — they are real games and people
 * genuinely recommend them. They are marked *ambiguous*, which means a match
 * only counts when the surrounding text supplies evidence that a title was
 * meant: title-case or all-caps capitalisation, or explicit quoting.
 *
 * Entries are stored in normalized form (see `normalizeTitle`).
 */
export const AMBIGUOUS_TITLES: ReadonlySet<string> = new Set([
  // Single ordinary words that are well-known titles.
  'limbo',
  'portal',
  'control',
  'journey',
  'inside',
  'braid',
  'fez',
  'rust',
  'prey',
  'grounded',
  'raft',
  'spore',
  'bastion',
  'transistor',
  'everything',
  'worms',
  'trine',
  'risk',
  'doom',
  'rage',
  'evolve',
  'destiny',
  'division',
  'anthem',
  'brink',
  'smite',
  'rift',
  'tera',
  'blade',
  'hunt',
  'dust',
  'drift',
  'flow',
  'flower',
  'unravel',
  'observation',
  'soma',
  'alien',
  'catherine',
  'persona',
  'rime',
  'forced',
  'torment',
  'quest',
  'legend',
  'hero',
  'myth',
  'saga',
  'arena',
  'fall',
  'rise',
  'dawn',
  'dusk',
  'void',
  'core',
  'echo',
  'pulse',
  'drive',
  'sky',
  'ocean',
  'island',
  'tower',
  'bridge',
  'gate',
  'star',
  'moon',
  'fire',
  'storm',
  'wave',
  'stone',
  'iron',
  'steel',
  'gold',
  'silver',
  'shelter',
  'home',
  'refuge',
  'among',
  'spirit',
  'ghost',
  'shadow',
  'reflection',
  'balance',
  'pitfall',
  'contrast',
  'closure',
  'gravity',
  'osmos',
  'antichamber',
  'reset',
  'recompile',
  'induction',
  'manifold',
  'exit',
  'entry',
  'descent',
  'ascent',
  'outcast',
  'renegade',
  'sacrifice',
  'darkness',
  'silence',
  'reverie',
  'solace',
  'haven',
  'refunct',

  // Ordinary phrases that are also titles.
  'the forest',
  'the crew',
  'the room',
  'the witness',
  'the division',
  'the hunter',
  'the long dark',
  'the beginner',
  'gone home',
  'state of mind',
  'dead end',
  'first light',
  'the end',
  'the game',
  'the last one',
  'no man',
  'the swapper',
  'the talos principle',

  // Genre vocabulary that is also a catalogue title. Readers use these words to
  // describe what they want, not to name a game — "looking for a walking
  // simulator" is a request, not a recommendation.
  'walking simulator',
  'visual novel',
  'battle royale',

  // Platform products in the games catalogue. "Steam link" is overwhelmingly a
  // developer posting the URL to their store page, which is exactly the shape
  // of post the recommendation communities are full of.
  'steam link',
  'steam controller',
]);

/**
 * Ordinary English words, frequent enough that a title built entirely from them
 * reads as prose far more often than as a game.
 *
 * This enumerates *English*, not game titles — which is why it can be a fixed
 * list where a stoplist of titles cannot. "Last Year" is a real game and was
 * ranking first in the default view off phrases like "I played it last year";
 * every token being an ordinary word is the property that catches it, and
 * catches the next one nobody thought to list.
 */
const COMMON_WORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'after', 'again', 'all', 'almost', 'also', 'always', 'an', 'and', 'another',
  'any', 'are', 'around', 'as', 'at', 'away', 'back', 'bad', 'be', 'because', 'been', 'before',
  'best', 'better', 'big', 'both', 'but', 'by', 'came', 'can', 'come', 'could', 'day', 'days',
  'did', 'do', 'does', 'down', 'each', 'end', 'even', 'ever', 'every', 'few', 'find', 'first',
  'for', 'from', 'full', 'game', 'games', 'get', 'go', 'going', 'gone', 'good', 'got', 'great',
  'had', 'half', 'has', 'have', 'he', 'her', 'here', 'high', 'him', 'his', 'hour', 'hours',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'keep', 'kind', 'know', 'last',
  'least', 'left', 'less', 'life', 'like', 'little', 'long', 'look', 'lot', 'made', 'make',
  'man', 'many', 'may', 'me', 'might', 'mind', 'minute', 'minutes', 'money', 'month', 'months',
  'more', 'most', 'much', 'must', 'my', 'name', 'need', 'never', 'new', 'next', 'nice', 'night',
  'no', 'not', 'nothing', 'now', 'of', 'off', 'often', 'oh', 'ok', 'old', 'on', 'once', 'one',
  'only', 'or', 'other', 'our', 'out', 'over', 'own', 'part', 'people', 'place', 'play', 'point',
  'pretty', 'put', 'real', 'really', 'right', 'said', 'same', 'saw', 'say', 'see', 'set',
  'she', 'short', 'should', 'side', 'since', 'small', 'so', 'some', 'something', 'still',
  'stuff', 'such', 'sure', 'take', 'than', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'thing', 'things', 'think', 'this', 'those', 'though', 'thought', 'three',
  'time', 'times', 'to', 'today', 'together', 'too', 'took', 'top', 'try', 'turn', 'two', 'up',
  'us', 'use', 'used', 'very', 'want', 'was', 'way', 'we', 'week', 'weeks', 'well', 'went',
  'were', 'what', 'when', 'where', 'which', 'while', 'who', 'why', 'will', 'with', 'without',
  'word', 'work', 'world', 'would', 'year', 'years', 'yes', 'yet', 'you', 'your',
]);

/**
 * Words that open a noun phrase. A title starting with one of these is a phrase
 * before it is a name, which is what makes it collide with running prose.
 */
const DETERMINERS: ReadonlySet<string> = new Set(['the', 'a', 'an']);

/**
 * Above this length a determiner-led title stops reading as an incidental
 * phrase. Every prose collision measured on a real corpus was exactly two
 * tokens — "the front", "the bridge", "the medium", "the lab", "the test",
 * "the ball" — because prose says those constantly. A third token is already
 * enough specificity that lower case is safe: "the witcher 3" and "the long
 * dark" are nobody's stray phrase, and gating them would cost real recall on
 * the casual lower-case mentions people actually write.
 */
const DETERMINER_PHRASE_MAX_TOKENS = 2;

/**
 * True when a match needs capitalisation or quoting before it counts.
 *
 * Three shapes qualify: a listed ordinary-English title, a title every token of
 * which is an ordinary English word, and a short title led by a determiner.
 *
 * That last rule exists because the second one is stricter than it looks —
 * requiring *every* token to be common means a title is unguarded as soon as
 * its head noun is uncommon, even when the phrase is plainly prose. `The Front`
 * reached first place in the default view on lower-case "the front"; `The Lab`,
 * `The Test` and `The Ball` were matched by prose on every occurrence they had.
 * Enumerating those titles cannot work, because the next one is always a noun
 * nobody listed — the determiner is the part that generalises.
 *
 * Marking a real title ambiguous only costs recall on lower-case mentions,
 * which is the cheap direction to be wrong in — precision is what is gated.
 */
/** Whether a single word is ordinary English rather than a proper noun. */
export function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word.toLowerCase().replace(/[^a-z]/gi, ''));
}

export function isAmbiguousTitle(normalized: string): boolean {
  if (AMBIGUOUS_TITLES.has(normalized)) return true;

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return false;
  if (tokens.every((token) => COMMON_WORDS.has(token))) return true;

  return tokens.length <= DETERMINER_PHRASE_MAX_TOKENS && DETERMINERS.has(tokens[0]!);
}
