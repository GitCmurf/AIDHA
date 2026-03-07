/**
 * Mock implementation of compromise for testing
 */

const COMMON_NOUNS = new Set([
  'dog', 'cat', 'company', 'product', 'machine', 'ball', 'task', 'door', 'home',
  'scientists', 'species', 'investors', 'market', 'analysis', 'insights',
  'weather', 'ocean', 'transcript', 'sentence', 'word', 'test',
  'sponsor', 'link', 'website', 'channel', 'bell', 'icon', 'merch', 'store',
  'discount', 'code', 'video', 'patreon', 'support', 'today', 'info',
  'neural', 'networks', 'layers', 'image', 'classification', 'accuracy',
  'artificial', 'intelligence', 'machine', 'learning', 'technology',
  'cell', 'mitochondria', 'powerhouse', 'data', 'science', 'learning',
  'columbus', 'hand', 'john', 'amazon', 'rainforest', 'economy', 'day',
  'keyword', 'pattern', 'content', 'promo', 'ad', 'advertisement',
  'referral', 'affiliate', 'purchase', 'buy', 'watching', 'thanks', 'thank',
  'follow', 'share', 'comment', 'like', 'subscribe', 'click', 'check',
  'visit', 'support',
  'cat', 'dog', 'company', 'product', 'market', 'change', 'success',
  'amazon', 'rainforest', 'book', 'table', 'house', 'car', 'tree',
]);
const COMMON_VERBS = new Set([
  'runs', 'run', 'is', 'was', 'launched', 'launch', 'sleeps', 'sleep',
  'discovered', 'discover', 'transforms', 'transform', 'thrown', 'throw',
  'finished', 'finish', 'adapted', 'adapt', 'excited', 'excite',
  'jumps', 'jump', 'sailed', 'sail', 'reveals', 'reveal', 'changed', 'change',
  'include', 'includes', 'check', 'visit', 'click', 'subscribe', 'hit', 'am',
  'buy', 'purchase', 'support', 'use', 'thanks', 'thank', 'follow',
  'share', 'comment', 'like', 'are', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could', 'get', 'got',
  'make', 'made', 'take', 'took', 'come', 'came', 'see', 'saw',
  'know', 'knew', 'think', 'thought', 'look', 'looked', 'want', 'wanted',
  'give', 'gave', 'find', 'found', 'tell', 'told', 'ask', 'asked',
  'work', 'worked', 'seem', 'seemed', 'feel', 'felt', 'try', 'tried',
  'leave', 'left', 'call', 'called', 'keep', 'kept', 'let', 'say', 'said',
  'help', 'helped', 'show', 'showed', 'hear', 'heard', 'play', 'played',
  'move', 'moved', 'live', 'lived', 'believe', 'believed', 'bring', 'brought',
  'happen', 'happened', 'write', 'wrote', 'provide', 'provided', 'sit', 'sat',
  'stand', 'stood', 'lose', 'lost', 'add', 'added', 'spend', 'spent',
  'grow', 'grew', 'open', 'opened', 'walk', 'walked', 'offer', 'offered',
  'remember', 'remembered', 'love', 'loved', 'consider', 'considered',
  'appear', 'appeared', 'buy', 'bought', 'wait', 'waited', 'serve', 'served',
  'die', 'died', 'send', 'sent', 'expect', 'expected', 'build', 'built',
  'stay', 'stayed', 'fall', 'fell', 'cut', 'reach', 'reached', 'kill', 'killed',
  'remain', 'remained', 'understand', 'understood', 'working', 'adapt', 'adapts',
  'slept', 'ran', 'launched', 'discovered', 'transforms', 'transformed',
]);

const ADJECTIVES = new Set([
  'big', 'quick', 'brown', 'lazy', 'new', 'economic', 'scientific',
  'technological', 'artificial', 'intelligent', 'important', 'pleasant',
  'blue', 'excited', 'beautiful', 'happy', 'sad', 'angry',
  'tired', 'bored', 'interested', 'boring', 'interesting', 'amazing',
  'wonderful', 'terrible', 'awful', 'excellent', 'perfect', 'horrible',
  'quick', 'great', 'little', 'good', 'bad', 'small', 'old', 'young',
  'high', 'low', 'long', 'short', 'different', 'large', 'local', 'social',
  'national', 'right', 'early', 'possible', 'political', 'able', 'public',
  'second', 'late', 'available', 'financial', 'whole', 'free', 'health',
  'former', 'lower', 'military', 'original', 'successful', 'electric',
  'new',
]);

const DETERMINERS = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'our', 'my', 'your']);
const PREPOSITIONS = new Set(['in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'over', 'out', 'below']);
const CONJUNCTIONS = new Set(['and', 'but', 'or', 'nor', 'yet', 'so']);
const PRONOUNS = new Set([
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
]);
const ADVERBS = new Set([
  'quickly', 'slowly', 'carefully', 'well', 'hard', 'very', 'really',
  'quite', 'rather', 'pretty', 'fairly', 'already', 'always', 'never',
  'sometimes', 'often', 'usually', 'here', 'there', 'everywhere', 'somewhere',
  'now', 'then', 'today', 'tomorrow', 'yesterday', 'soon', 'early', 'late',
  'however', 'therefore', 'thus', 'hence', 'consequently', 'meanwhile',
  'finally', 'eventually', 'suddenly', 'fortunately', 'unfortunately',
  'dramatically', 'properly', 'successfully', 'correctly', 'yesterday',
]);

const BOILERPLATE_KEYWORDS = new Set([
  'sponsor', 'sponsored', 'ad', 'advertisement', 'promo', 'code', 'discount',
  'link', 'subscribe', 'like', 'comment', 'share', 'follow', 'click', 'check',
  'visit', 'support', 'patreon', 'merch', 'store', 'buy', 'purchase',
  'affiliate', 'referral', 'thanks', 'thank', 'watching', 'channel',
]);

function inferTags(word: string, position?: { index: number; total: number }): string[] {
  // Strip punctuation for tagging
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  const tags: string[] = [];

  if (DETERMINERS.has(clean)) tags.push('Determiner');
  if (PREPOSITIONS.has(clean)) tags.push('Preposition');
  if (CONJUNCTIONS.has(clean)) tags.push('Conjunction');
  if (PRONOUNS.has(clean)) tags.push('Pronoun');

  // Adverbs - check before adjectives
  if (ADVERBS.has(clean)) {
    tags.push('Adverb');
  }

  if (ADJECTIVES.has(clean)) {
    tags.push('Adjective');
  }

  // Words ending in 'ly' are often adverbs
  if (clean.endsWith('ly') && clean.length > 3) {
    if (!tags.includes('Adverb')) {
      tags.push('Adverb');
    }
  }

  if (/^\d+$/.test(word)) {
    tags.push('Value');
    tags.push('Number');
  }

  // Verbs
  if (COMMON_VERBS.has(clean)) {
    tags.push('Verb');
    if (['is', 'are', 'was', 'were', 'be', 'been', 'being', 'am'].includes(clean)) {
      tags.push('Copula');
    }
    if (['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did'].includes(clean)) {
      tags.push('Auxiliary');
    }
  }

  // Check for verb patterns
  if ((clean.endsWith('ed') || clean.endsWith('ing')) && clean.length > 3) {
    if (!tags.includes('Verb')) {
      tags.push('Verb');
    }
  }

  // Nouns - if no other tags or it's in our noun list
  // For SVO extraction, we need Noun tags even for determiners at sentence start
  if (COMMON_NOUNS.has(clean) || tags.length === 0) {
    tags.push('Noun');
  }

  return tags.length > 0 ? tags : ['Noun'];
}

class MockDocument {
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  sentences() {
    const self = this;
    const sentences = this.text
      .split(/[.!?]+/)
      .filter(s => s.trim().length > 0)
      .map(s => s.trim());

    return {
      json: () => sentences.map(s => ({ text: s, terms: self.parseTerms(s) })),
    };
  }

  nouns() {
    const words = this.text.toLowerCase().match(/\b[a-z]+\b/g) || [];
    const nounWords = words.filter(w => {
      const tags = inferTags(w);
      return tags.includes('Noun') && w.length > 2;
    });

    return {
      out: (format: string) => {
        if (format === 'array') {
          return nounWords;
        }
        return nounWords.join(' ');
      },
    };
  }

  json() {
    const terms = this.parseTerms(this.text);
    return [{ terms }];
  }

  private parseTerms(text: string): Array<{ text: string; tags: string[] }> {
    const words = text.split(/\s+/).filter(Boolean);
    return words.map((word, index) => ({
      text: word,
      tags: inferTags(word, { index, total: words.length }),
    }));
  }
}

export default function compromise(text: string) {
  return new MockDocument(text);
}

// Export for testing
export { BOILERPLATE_KEYWORDS, inferTags, COMMON_VERBS, COMMON_NOUNS };
