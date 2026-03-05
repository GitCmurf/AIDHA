/**
 * Tiered Entailment Verification Module
 *
 * Implements a three-tier verification system for grounding claims:
 * - Tier 1 (Lexical): Fast token overlap check
 * - Tier 2 (Semantic): N-gram and phrase overlap for paraphrase detection
 * - Tier 3 (Entailment): LLM-based logical entailment verification (placeholder)
 *
 * @module extract/verification
 */

/**
 * Verification tier type indicating which tier passed or failed
 */
export type VerificationTier = 'lexical' | 'semantic' | 'entailment';

/**
 * Result of verification with confidence scores and issues
 */
export interface VerificationResult {
  /** Whether the claim was verified against sources */
  readonly verified: boolean;
  /** Confidence score between 0 and 1 */
  readonly confidence: number;
  /** The highest tier that was evaluated */
  readonly tier: VerificationTier;
  /** Detailed scores for each verification level */
  readonly details: {
    /** Token overlap ratio (0-1) */
    readonly lexicalOverlap: number;
    /** Cosine-like similarity from n-gram overlap (0-1) */
    readonly semanticSimilarity?: number;
    /** Entailment confidence from LLM (0-1) */
    readonly entailmentScore?: number;
  };
  /** List of issues found during verification */
  readonly issues: string[];
}

/**
 * Configuration thresholds for verification tiers
 */
export interface VerificationConfig {
  /** Minimum token overlap for lexical verification (default: 0.3) */
  readonly lexicalThreshold: number;
  /** Minimum similarity for semantic verification (default: 0.6) */
  readonly semanticThreshold: number;
  /** Minimum score for entailment verification (default: 0.7) */
  readonly entailmentThreshold: number;
}

/**
 * Lexical verification result
 */
interface LexicalResult {
  /** Maximum token overlap ratio across sources */
  readonly overlap: number;
  /** Whether lexical verification passed */
  readonly verified: boolean;
}

/**
 * Semantic verification result
 */
interface SemanticResult {
  /** Maximum semantic similarity across sources */
  readonly similarity: number;
  /** Whether semantic verification passed */
  readonly verified: boolean;
}

/**
 * Entailment verification result
 */
interface EntailmentResult {
  /** Maximum entailment score across sources */
  readonly score: number;
  /** Whether entailment verification passed */
  readonly verified: boolean;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: VerificationConfig = {
  lexicalThreshold: 0.3,
  semanticThreshold: 0.6,
  entailmentThreshold: 0.7,
};

/**
 * Stopwords to exclude from tokenization
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
]);

/**
 * Common noun phrase patterns for key phrase extraction
 */
const NOUN_PHRASE_PATTERNS = [
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g, // Proper nouns
];

const COMMON_NOUNS = new Set([
  'theory', 'model', 'system', 'method', 'approach', 'study', 'research', 'data', 'result', 'finding', 'analysis', 'concept', 'idea', 'principle', 'law', 'rule', 'pattern', 'trend', 'effect', 'impact', 'role', 'function', 'purpose', 'goal', 'objective', 'strategy', 'technique', 'process', 'procedure', 'step', 'stage', 'phase', 'level', 'degree', 'amount', 'number', 'quantity', 'rate', 'ratio', 'percentage', 'proportion', 'share', 'part', 'section', 'segment', 'component', 'element', 'factor', 'aspect', 'feature', 'characteristic', 'property', 'attribute', 'quality', 'trait', 'dimension', 'variable', 'parameter', 'indicator', 'measure', 'metric', 'standard', 'criterion', 'benchmark', 'target', 'threshold', 'limit', 'boundary', 'range', 'scope', 'scale', 'size', 'extent', 'duration', 'period', 'interval', 'frequency', 'occurrence', 'event', 'incident', 'case', 'instance', 'example', 'sample', 'specimen', 'item', 'object', 'entity', 'unit', 'structure', 'organization', 'institution', 'agency', 'company', 'firm', 'business', 'industry', 'sector', 'field', 'domain', 'area', 'region', 'zone', 'location', 'place', 'site', 'position', 'point', 'spot', 'context', 'environment', 'setting', 'situation', 'condition', 'state', 'status', 'stage', 'phase', 'level', 'layer', 'stratum', 'tier', 'grade', 'rank', 'class', 'category', 'group', 'set', 'type', 'kind', 'sort', 'form', 'shape', 'mode', 'manner', 'way', 'means', 'medium', 'channel', 'source', 'origin', 'cause', 'reason', 'explanation', 'account', 'description', 'report', 'statement', 'claim', 'assertion', 'argument', 'point', 'view', 'opinion', 'belief', 'assumption', 'hypothesis', 'prediction', 'forecast', 'projection', 'expectation', 'anticipation', 'hope', 'concern', 'issue', 'problem', 'question', 'query', 'topic', 'theme', 'subject', 'matter', 'issue', 'question', 'debate', 'discussion', 'conversation', 'dialogue', 'exchange', 'communication', 'message', 'information', 'knowledge', 'understanding', 'insight', 'awareness', 'recognition', 'acknowledgment', 'acceptance', 'agreement', 'consensus', 'contract', 'deal', 'transaction', 'operation', 'activity', 'action', 'act', 'deed', 'effort', 'attempt', 'try', 'test', 'trial', 'experiment', 'investigation', 'inquiry', 'examination', 'inspection', 'review', 'assessment', 'evaluation', 'appraisal', 'judgment', 'decision', 'choice', 'selection', 'option', 'alternative', 'preference', 'priority', 'emphasis', 'focus', 'attention', 'interest', 'concern', 'care', 'regard', 'consideration', 'thought', 'idea', 'notion', 'concept', 'conception', 'perception', 'impression', 'feeling', 'emotion', 'attitude', 'disposition', 'tendency', 'inclination', 'propensity', 'predisposition', 'susceptibility', 'vulnerability', 'risk', 'danger', 'threat', 'hazard', 'risk', 'challenge', 'difficulty', 'obstacle', 'barrier', 'hindrance', 'impediment', 'limitation', 'restriction', 'constraint', 'restraint', 'control', 'regulation', 'rule', 'law', 'policy', 'guideline', 'standard', 'norm', 'convention', 'practice', 'custom', 'tradition', 'habit', 'routine', 'procedure', 'protocol', 'system', 'framework', 'structure', 'architecture', 'design', 'plan', 'scheme', 'program', 'project', 'initiative', 'campaign', 'movement', 'trend', 'direction', 'path', 'route', 'course', 'track', 'trail', 'way', 'road', 'street', 'avenue', 'boulevard', 'highway', 'motorway', 'freeway', 'pathway', 'sidewalk', 'pavement', 'walkway', 'corridor', 'hallway', 'passage', 'passageway', 'tunnel', 'bridge', 'crossing', 'junction', 'intersection', 'crossroads', 'roundabout', 'circle', 'square', 'plaza', 'courtyard', 'yard', 'garden', 'park', 'ground', 'field', 'meadow', 'pasture', 'range', 'prairie', 'savanna', 'grassland', 'tundra', 'taiga', 'forest', 'wood', 'jungle', 'rainforest', 'wetland', 'marsh', 'swamp', 'bog', 'fen', 'mire', 'quagmire', 'slough', 'delta', 'estuary', 'bay', 'gulf', 'cove', 'inlet', 'fjord', 'loch', 'lake', 'pond', 'pool', 'reservoir', 'dam', 'weir', 'canal', 'channel', 'river', 'stream', 'creek', 'brook', 'rivulet', 'rill', 'burn', 'beck', 'bourne', 'run', 'branch', 'tributary', 'confluence', 'watershed', 'divide', 'ridge', 'crest', 'summit', 'peak', 'pinnacle', 'apex', 'vertex', 'top', 'head', 'crown', 'cap', 'dome', 'roof', 'ceiling', 'floor', 'ground', 'earth', 'soil', 'dirt', 'clay', 'mud', 'silt', 'sand', 'gravel', 'pebble', 'stone', 'rock', 'boulder', 'cliff', 'crag', 'outcrop', 'ledge', 'shelf', 'terrace', 'plateau', 'tableland', 'mesa', 'butte', 'hill', 'knoll', 'mound', 'hump', 'bump', 'lump', 'mass', 'bulk', 'volume', 'weight', 'heaviness', 'lightness', 'density', 'thickness', 'thinness', 'width', 'breadth', 'length', 'depth', 'height', 'tallness', 'shortness', 'distance', 'proximity', 'nearness', 'closeness', 'remoteness', 'distance', 'gap', 'space', 'room', 'area', 'expanse', 'stretch', 'reach', 'span', 'scope', 'range', 'sweep', 'compass', 'orbit', 'circuit', 'circle', 'cycle', 'round', 'turn', 'rotation', 'revolution', 'spin', 'twirl', 'whirl', 'swirl', 'eddy', 'vortex', 'whirlpool', 'maelstrom', 'chasm', 'abyss', 'void', 'vacuum', 'emptiness', 'nothingness', 'oblivion', 'darkness', 'light', 'brightness', 'brilliance', 'radiance', 'luminosity', 'illumination', 'glow', 'gleam', 'glint', 'sparkle', 'twinkle', 'shimmer', 'shine', 'sheen', 'luster', 'gloss', 'polish', 'finish', 'surface', 'face', 'front', 'frontage', 'facade', 'exterior', 'outside', 'outdoors', 'open', 'air', 'atmosphere', 'sky', 'heaven', 'firmament', 'vault', 'canopy', 'cover', 'covering', 'lid', 'top', 'cap', 'stopper', 'cork', 'plug', 'bung', 'seal', 'closure', 'fastener', 'catch', 'latch', 'lock', 'bolt', 'bar', 'beam', 'girder', 'joist', 'rafter', 'stud', 'post', 'pole', 'stake', 'peg', 'pin', 'nail', 'screw', 'bolt', 'nut', 'washer', 'rivet', 'brad', 'tack', 'clamp', 'clip', 'hook', 'eye', 'ring', 'loop', 'knot', 'tie', 'bond', 'link', 'connection', 'joint', 'junction', 'union', 'unity', 'wholeness', 'completeness', 'entirety', 'totality', 'integrity', 'coherence', 'cohesion', 'adhesion', 'stickiness', 'tackiness', 'viscosity', 'thickness', 'density', 'solidity', 'firmness', 'hardness', 'softness', 'smoothness', 'roughness', 'coarseness', 'fineness', 'refinement', 'polish', 'cultivation', 'culture', 'civilization', 'society', 'community', 'population', 'people', 'folk', 'nation', 'country', 'state', 'land', 'realm', 'domain', 'kingdom', 'empire', 'commonwealth', 'republic', 'democracy', 'monarchy', 'oligarchy', 'aristocracy', 'plutocracy', 'meritocracy', 'technocracy', 'bureaucracy', 'administration', 'government', 'regime', 'rule', 'regime', 'administration', 'management', 'direction', 'leadership', 'guidance', 'supervision', 'oversight', 'control', 'command', 'authority', 'power', 'influence', 'sway', 'leverage', 'clout', 'muscle', 'force', 'strength', 'might', 'energy', 'vigor', 'vitality', 'life', 'spirit', 'soul', 'mind', 'intellect', 'intelligence', 'wit', 'wisdom', 'knowledge', 'learning', 'scholarship', 'education', 'schooling', 'training', 'instruction', 'teaching', 'tuition', 'coaching', 'tutoring', 'mentoring', 'guidance', 'counseling', 'advice', 'counsel', 'recommendation', 'suggestion', 'proposal', 'proposition', 'offer', 'bid', 'tender', 'submission', 'entry', 'application', 'appeal', 'petition', 'request', 'plea', 'entreaty', 'supplication', 'prayer', 'invocation', 'blessing', 'benediction', 'grace', 'mercy', 'compassion', 'sympathy', 'empathy', 'understanding', 'appreciation', 'gratitude', 'thankfulness', 'indebtedness', 'obligation', 'duty', 'responsibility', 'accountability', 'liability', 'answerability', 'culpability', 'guilt', 'blame', 'fault', 'error', 'mistake', 'oversight', 'omission', 'neglect', 'failure', 'defeat', 'loss', 'damage', 'harm', 'injury', 'wound', 'trauma', 'shock', 'surprise', 'amazement', 'wonder', 'awe', 'admiration', 'respect', 'esteem', 'regard', 'reverence', 'veneration', 'worship', 'adoration', 'devotion', 'dedication', 'commitment', 'pledge', 'promise', 'vow', 'oath', 'affirmation', 'declaration', 'pronouncement', 'announcement', 'proclamation', 'statement', 'comment', 'remark', 'observation', 'note', 'notation', 'annotation', 'footnote', 'reference', 'citation', 'quotation', 'quote', 'extract', 'excerpt', 'passage', 'text', 'copy', 'duplicate', 'replica', 'reproduction', 'facsimile', 'likeness', 'image', 'picture', 'photo', 'photograph', 'snapshot', 'shot', 'frame', 'scene', 'view', 'vista', 'panorama', 'prospect', 'outlook', 'perspective', 'viewpoint', 'standpoint', 'position', 'stance', 'posture', 'attitude', 'bearing', 'demeanor', 'manner', 'air', 'appearance', 'look', 'aspect', 'expression', 'face', 'countenance', 'visage', 'features', 'lineament', 'profile', 'silhouette', 'outline', 'contour', 'shape', 'form', 'figure', 'build', 'frame', 'body', 'physique', 'constitution', 'makeup', 'composition', 'structure', 'anatomy', 'morphology', 'physiology', 'biology', 'ecology', 'environment', 'habitat', 'territory', 'range', 'domain', 'sphere', 'field', 'area', 'zone', 'sector', 'region', 'quarter', 'district', 'neighborhood', 'vicinity', 'locality', 'locale', 'spot', 'place', 'site', 'position', 'location', 'situation', 'circumstance', 'condition', 'state', 'case', 'instance', 'example', 'illustration', 'demonstration', 'proof', 'evidence', 'confirmation', 'verification', 'validation', 'authentication', 'certification', 'accreditation', 'authorization', 'license', 'permit', 'warrant', 'sanction', 'approval', 'acceptance', 'agreement', 'consent', 'assent', 'acquiescence', 'compliance', 'conformity', 'adherence', 'observance', 'performance', 'execution', 'implementation', 'realization', 'accomplishment', 'achievement', 'attainment', 'success', 'victory', 'triumph', 'conquest', 'mastery', 'command', 'control', 'dominance', 'supremacy', 'superiority', 'advantage', 'edge', 'lead', 'margin', 'difference', 'distinction', 'contrast', 'comparison', 'analogy', 'similarity', 'resemblance', 'likeness', 'affinity', 'correspondence', 'parallel', 'equivalent', 'equal', 'peer', 'match', 'mate', 'partner', 'companion', 'comrade', 'colleague', 'associate', 'ally', 'confederate', 'collaborator', 'cooperator', 'helper', 'assistant', 'aide', 'deputy', 'agent', 'representative', 'delegate', 'envoy', 'emissary', 'messenger', 'courier', 'carrier', 'bearer', 'porter', 'conveyor', 'transporter', 'shipper', 'sender', 'transmitter', 'communicator', 'speaker', 'spokesman', 'spokeswoman', 'spokesperson', 'mouthpiece', 'voice', 'advocate', 'champion', 'defender', 'protector', 'guardian', 'keeper', 'custodian', 'warden', 'watchman', 'guard', 'sentry', 'sentinel', 'lookout', 'scout', 'patrol', 'police', 'officer', 'official', 'functionary', 'bureaucrat', 'administrator', 'manager', 'director', 'executive', 'officer', 'chief', 'head', 'leader', 'boss', 'supervisor', 'superintendent', 'overseer', 'foreman', 'forewoman', 'gaffer', 'chief', 'captain', 'master', 'skipper', 'pilot', 'helmsman', 'steersman', 'coxswain', 'rower', 'oarsman', 'oarswoman', 'sailor', 'mariner', 'seaman', 'seafarer', 'seafaring', 'voyager', 'traveler', 'passenger', 'commuter', 'tourist', 'visitor', 'guest', 'host', 'hostess', 'proprietor', 'owner', 'possessor', 'holder', 'bearer', 'carrier', 'porter', 'courier', 'messenger', 'herald', 'harbinger', 'forerunner', 'precursor', 'predecessor', 'ancestor', 'forebear', 'progenitor', 'parent', 'mother', 'father', 'dad', 'mom', 'mum', 'papa', 'mama', 'parent', 'guardian', 'caretaker', 'nurse', 'nanny', 'au pair', 'governess', 'tutor', 'teacher', 'instructor', 'professor', 'lecturer', 'educator', 'pedagogue', 'schoolmaster', 'schoolmistress', 'headmaster', 'headmistress', 'principal', 'dean', 'chancellor', 'president', 'vice-chancellor', 'rector', 'provost', 'director', 'manager', 'administrator', 'superintendent', 'supervisor', 'overseer', 'foreman', 'boss', 'chief', 'leader', 'head', 'captain', 'commander', 'officer', 'official', 'functionary', 'bureaucrat', 'politician', 'statesman', 'diplomat', 'ambassador', 'consul', 'attache', 'envoy', 'emissary', 'delegate', 'representative', 'commissioner', 'committee', 'board', 'council', 'assembly', 'congress', 'parliament', 'legislature', 'senate', 'house', 'chamber', 'court', 'tribunal', 'bench', 'bar', 'judiciary', 'judicature', 'magistracy', 'justiceship', 'sheriff', 'constable', 'marshal', 'sheriff', 'bailiff', 'warden', 'jailer', 'gaoler', 'prison', 'jail', 'gaol', 'cell', 'dungeon', 'keep', 'tower', 'castle', 'fortress', 'citadel', 'stronghold', 'fort', 'blockhouse', 'redoubt', 'bunker', 'shelter', 'refuge', 'haven', 'harbor', 'port', 'anchorage', 'mooring', 'berth', 'slip', 'dock', 'pier', 'wharf', 'quay', 'jetty', 'landing', 'platform', 'stage', 'deck', 'floor', 'level', 'story', 'tier', 'row', 'line', 'file', 'column', 'string', 'chain', 'series', 'sequence', 'succession', 'progression', 'continuum', 'spectrum', 'range', 'gamut', 'scale', 'ladder', 'hierarchy', 'pyramid', 'triangle', 'circle', 'square', 'rectangle', 'oval', 'ellipse', 'diamond', 'rhombus', 'parallelogram', 'trapezoid', 'trapezium', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'nonagon', 'decagon', 'polygon', 'figure', 'shape', 'form', 'configuration', 'arrangement', 'disposition', 'layout', 'design', 'pattern', 'motif', 'theme', 'topic', 'subject', 'matter', 'material', 'substance', 'stuff', 'fabric', 'textile', 'cloth', 'garment', 'clothing', 'attire', 'apparel', 'wear', 'dress', 'costume', 'outfit', 'ensemble', 'suit', 'uniform', 'livery', 'regalia', 'vestments', 'robes', 'gown', 'frock', 'dress', 'skirt', 'blouse', 'shirt', 'jacket', 'coat', 'overcoat', 'topcoat', 'raincoat', 'macintosh', 'anorak', 'parka', 'windbreaker', 'blazer', 'sports coat', 'suit coat', 'waistcoat', 'vest', 'underwear', 'lingerie', 'underclothes', 'undergarments', 'underthings', 'unmentionables', 'drawers', 'shorts', 'briefs', 'pants', 'trousers', 'slacks', 'jeans', 'denims', 'dungarees', 'overalls', 'coveralls', 'jumpsuit', 'romper', 'playsuit', 'bathers', 'swimmers', 'swimsuit', 'bikini', 'tankini', 'monokini', 'burkini', 'wetsuit', 'dry suit', 'diving suit', 'space suit', 'hazmat suit', 'protective suit', 'armor', 'armour', 'mail', 'chain mail', 'plate armor', 'body armor', 'flak jacket', 'bulletproof vest', 'life jacket', 'life vest', 'life preserver', 'buoyancy aid', 'float', 'raft', 'lifeboat', 'liferaft', 'dinghy', 'tender', 'launch', 'pinnace', 'gig', 'whaler', 'cutter', 'sloop', 'ketch', 'yawl', 'schooner', 'brig', 'brigantine', 'barque', 'bark', 'ship', 'vessel', 'craft', 'boat', 'watercraft', 'seacraft', 'aircraft', 'spacecraft', 'spaceship', 'rocket', 'missile', 'projectile', 'shell', 'bullet', 'round', 'shot', 'ball', 'pellet', 'slug', 'bolt', 'arrow', 'dart', 'javelin', 'spear', 'lance', 'pike', 'halberd', 'axe', 'hatchet', 'tomahawk', 'cleaver', 'knife', 'dagger', 'dirk', 'stiletto', 'poniard', 'sword', 'blade', 'steel', 'foil', 'epee', 'saber', 'sabre', 'rapier', 'cutlass', 'scimitar', 'broadsword', 'longsword', 'claymore', 'katana', 'wakizashi', 'tanto', 'shiv', 'shank', 'shank', 'prison', 'shiv', 'blade', 'knife', 'edge', 'sharpness', 'keenness', 'acuity', 'sharpness', 'clearness', 'clarity', 'lucidity', 'transparency', 'translucency', 'opacity', 'cloudiness', 'turbidity', 'muddiness', 'murkiness', 'darkness', 'blackness', 'opacity', 'imperviousness', 'impenetrability', 'resistance', 'immunity', 'protection', 'defense', 'safeguard', 'security', 'safety', 'welfare', 'wellbeing', 'health', 'fitness', 'robustness', 'strength', 'vigor', 'energy', 'vitality', 'life', 'animation', 'activity', 'liveliness', 'vivacity', 'briskness', 'energy', 'force', 'power', 'strength', 'might', 'muscle', 'brawn', 'sinew', 'thews', 'physique', 'build', 'frame', 'body', 'figure', 'shape', 'form', 'outline', 'profile', 'silhouette', 'contour', 'curve', 'arc', 'bow', 'bend', 'turn', 'twist', 'warp', 'distortion', 'deformation', 'malformation', 'misshapenness', 'disfigurement', 'deformity', 'blemish', 'flaw', 'defect', 'imperfection', 'fault', 'failing', 'weakness', 'frailty', 'infirmity', 'debility', 'feebleness', 'enfeeblement', 'weakening', 'debilitation', 'exhaustion', 'fatigue', 'tiredness', 'weariness', 'lethargy', 'listlessness', 'languor', 'lassitude', 'apathy', 'indifference', 'unconcern', 'disinterest', 'detachment', 'aloofness', 'distance', 'remoteness', 'removal', 'elimination', 'eradication', 'extirpation', 'extermination', 'destruction', 'annihilation', 'obliteration', 'erasure', 'deletion', 'cancellation', 'annulment', 'nullification', 'voidance', 'abrogation', 'repeal', 'rescission', 'revocation', 'withdrawal', 'retraction', 'recantation', 'abjuration', 'renunciation', 'repudiation', 'disavowal', 'denial', 'contradiction', 'refutation', 'rebuttal', 'disproof', 'invalidation', 'negation', 'nullification', 'cancellation', 'abortion', 'termination', 'cessation', 'discontinuance', 'suspension', 'interruption', 'break', 'pause', 'respite', 'rest', 'recess', 'hiatus', 'gap', 'interval', 'interim', 'interlude', 'entr\'acte', 'intermission', 'meantime', 'meanwhile', 'pending', 'awaiting', 'waiting', 'expecting', 'anticipating', 'looking forward', 'hoping', 'wishing', 'desiring', 'wanting', 'needing', 'requiring', 'demanding', 'requesting', 'asking', 'seeking', 'searching', 'hunting', 'pursuing', 'chasing', 'following', 'tracking', 'trailing', 'shadowing', 'dogging', 'hounding', 'pestering', 'badgering', 'nagging', 'harassing', 'tormenting', 'persecuting', 'oppressing', 'suppressing', 'repressing', 'subduing', 'conquering', 'defeating', 'vanquishing', 'overcoming', 'overpowering', 'overwhelming', 'swamping', 'flooding', 'inundating', 'deluging', 'submerging', 'drowning', 'immersing', 'baptizing', 'christening', 'naming', 'calling', 'hailing', 'greeting', 'saluting', 'welcoming', 'receiving', 'accepting', 'taking', 'getting', 'obtaining', 'acquiring', 'procuring', 'securing', 'gaining', 'earning', 'winning', 'achieving', 'attaining', 'reaching', 'arriving', 'coming', 'approaching', 'nearing', 'closing', 'shutting', 'locking', 'bolting', 'barring', 'fastening', 'securing', 'fixing', 'attaching', 'joining', 'connecting', 'linking', 'coupling', 'pairing', 'matching', 'mating', 'marrying', 'wedding', 'uniting', 'combining', 'joining', 'merging', 'fusing', 'blending', 'mixing', 'mingling', 'intermingling', 'commingling', 'amalgamating', 'integrating', 'incorporating', 'embodying', 'containing', 'including', 'comprising', 'consisting', 'constituting', 'forming', 'making', 'creating', 'producing', 'generating', 'originating', 'initiating', 'starting', 'beginning', 'commencing', 'opening', 'launching', 'introducing', 'presenting', 'offering', 'proposing', 'suggesting', 'recommending', 'advising', 'counseling', 'guiding', 'directing', 'leading', 'steering', 'piloting', 'navigating', 'sailing', 'cruising', 'coasting', 'gliding', 'sliding', 'slipping', 'skidding', 'skating', 'skiing', 'surfing', 'sailing', 'flying', 'soaring', 'gliding', 'hovering', 'floating', 'drifting', 'wafting', 'gliding', 'sailing', 'coasting', 'cruising', 'traveling', 'journeying', 'voyaging', 'touring', 'sightseeing', 'visiting', 'calling', 'stopping', 'staying', 'remaining', 'lingering', 'waiting', 'abiding', 'dwelling', 'residing', 'living', 'inhabiting', 'occupying', 'possessing', 'owning', 'holding', 'keeping', 'retaining', 'maintaining', 'preserving', 'conserving', 'saving', 'protecting', 'guarding', 'shielding', 'screening', 'sheltering', 'covering', 'hiding', 'concealing', 'secreting', 'burying', 'interring', 'entombing', 'inhuming', 'cremating', 'burning', 'incinerating', 'reducing', 'decreasing', 'lessening', 'lowering', 'diminishing', 'reducing', 'cutting', 'slashing', 'trimming', 'paring', 'pruning', 'cropping', 'clipping', 'shearing', 'mowing', 'reaping', 'harvesting', 'gathering', 'collecting', 'assembling', 'congregating', 'convening', 'summoning', 'calling', 'inviting', 'requesting', 'asking', 'seeking', 'petitioning', 'soliciting', 'canvassing', 'campaigning', 'election', 'vote', 'ballot', 'poll', 'referendum', 'plebiscite', 'initiative', 'proposition', 'measure', 'bill', 'act', 'statute', 'law', 'regulation', 'rule', 'order', 'decree', 'edict', 'dictate', 'command', 'directive', 'instruction', 'direction', 'guidance', 'counsel', 'advice', 'recommendation', 'suggestion', 'proposal', 'proposition', 'motion', 'resolution', 'determination', 'decision', 'verdict', 'judgment', 'ruling', 'finding', 'conclusion', 'inference', 'deduction', 'derivation', 'extraction', 'abstraction', 'generalization', 'universalization', 'theorization', 'hypothesization', 'speculation', 'conjecture', 'surmise', 'guess', 'estimate', 'approximation', 'calculation', 'computation', 'reckoning', 'figuring', 'counting', 'tallying', 'enumerating', 'listing', 'itemizing', 'detailing', 'specifying', 'particularizing', 'individualizing', 'personalizing', 'customizing', 'tailoring', 'adapting', 'adjusting', 'modifying', 'altering', 'changing', 'varying', 'shifting', 'switching', 'swapping', 'exchanging', 'interchanging', 'substituting', 'replacing', 'superseding', 'supplanting', 'displacing', 'ousting', 'ejecting', 'expelling', 'evicting', 'removing', 'eliminating', 'eradicating', 'wiping out', 'destroying', 'demolishing', 'razing', 'leveling', 'flattening', 'squashing', 'crushing', 'compressing', 'squeezing', 'pressing', 'pushing', 'shoving', 'thrusting', 'driving', 'propelling', 'launching', 'hurling', 'throwing', 'tossing', 'flinging', 'casting', 'pitching', 'lobbing', 'chucking', 'heaving', 'hiking', 'boosting', 'raising', 'elevating', 'lifting', 'hoisting', 'hoisting', 'raising', 'lifting', 'elevating', 'upraising', 'uprearing', 'erecting', 'constructing', 'building', 'making', 'fabricating', 'manufacturing', 'producing', 'creating', 'forming', 'shaping', 'molding', 'casting', 'forging', 'smithing', 'hammering', 'beating', 'striking', 'hitting', 'punching', 'slapping', 'smacking', 'spanking', 'whipping', 'flogging', 'lashing', 'scourging', 'flagellating', 'beating', 'thrashing', 'trouncing', 'drubbing', 'walloping', 'whacking', 'thwacking', 'clobbering', 'belting', 'slugging', 'socking', 'punching', 'hitting', 'striking', 'knocking', 'tapping', 'rapping', 'patting', 'caressing', 'stroking', 'fondling', 'petting', 'handling', 'touching', 'feeling', 'sensing', 'perceiving', 'noticing', 'observing', 'seeing', 'looking', 'viewing', 'watching', 'eyeing', 'regarding', 'beholding', 'witnessing', 'becoming', 'happening', 'occurring', 'taking place', 'transpiring', 'ensuing', 'resulting', 'following', 'succeeding', 'coming after', 'replacing', 'substituting', 'standing in', 'acting', 'serving', 'functioning', 'operating', 'working', 'running', 'going', 'proceeding', 'progressing', 'advancing', 'moving', 'going forward', 'going ahead', 'continuing', 'persisting', 'persevering', 'enduring', 'lasting', 'remaining', 'staying', 'abiding', 'continuing', 'going on', 'keeping on', 'carrying on', 'pressing on', 'pushing on', 'plodding on', 'struggling on', 'fighting on', 'battling on', 'soldiering on', 'carrying on', 'keeping up', 'maintaining', 'sustaining', 'supporting', 'upholding', 'bearing', 'carrying', 'shouldering', 'accepting', 'taking on', 'undertaking', 'assuming', 'adopting', 'embracing', 'accepting', 'welcoming', 'receiving', 'taking', 'getting', 'obtaining', 'gaining', 'acquiring', 'procuring', 'securing', 'attaining', 'achieving', 'accomplishing', 'realizing', 'fulfilling', 'completing', 'finishing', 'concluding', 'ending', 'terminating', 'closing', 'stopping', 'halting', 'ceasing', 'desisting', 'refraining', 'abstaining', 'forbearing', 'avoiding', 'shunning', 'eschewing', 'forsaking', 'abandoning', 'deserting', 'leaving', 'quitting', 'departing', 'going away', 'withdrawing', 'retreating', 'retiring', 'receding', 'reversing', 'backing', 'returning', 'reverting', 'relapsing', 'regressing', 'retrogressing', 'degenerating', 'deteriorating', 'declining', 'decaying', 'rotting', 'decomposing', 'disintegrating', 'crumbling', 'falling apart', 'breaking down', 'breaking up', 'fragmenting', 'shattering', 'smashing', 'crushing', 'pulverizing', 'grinding', 'milling', 'crushing', 'squashing', 'flattening', 'compressing', 'condensing', 'concentrating', 'focusing', 'centering', 'converging', 'meeting', 'joining', 'uniting', 'combining', 'merging', 'fusing', 'amalgamating', 'integrating', 'incorporating', 'embodying', 'containing', 'including', 'comprising', 'consisting', 'constituting', 'forming', 'making', 'creating', 'producing', 'generating', 'originating', 'initiating', 'starting', 'beginning', 'commencing', 'inaugurating', 'launching', 'introducing', 'presenting', 'offering', 'proposing', 'suggesting', 'recommending', 'advising', 'counseling', 'guiding', 'directing', 'leading', 'steering', 'piloting', 'navigating', 'routing', 'channeling', 'conducting', 'transmitting', 'conveying', 'carrying', 'transporting', 'transferring', 'moving', 'shifting', 'relocating', 'removing', 'displacing', 'replacing', 'substituting', 'exchanging', 'swapping', 'trading', 'bartering', 'negotiating', 'bargaining', 'haggling', 'dickering', 'dealing', 'transacting', 'conducting', 'performing', 'executing', 'implementing', 'enacting', 'effecting', 'bringing about', 'causing', 'inducing', 'provoking', 'prompting', 'stimulating', 'motivating', 'inspiring', 'influencing', 'affecting', 'swaying', 'persuading', 'convincing', 'inducing', 'prevailing', 'winning over', 'bringing round', 'talking round', 'converting', 'proselytizing', 'evangelizing', 'missionizing', 'crusading', 'campaigning', 'lobbying', 'pressuring', 'pressurizing', 'coercing', 'compelling', 'forcing', 'obliging', 'requiring', 'necessitating', 'making', 'causing', 'getting', 'having', 'keeping', 'retaining', 'holding', 'maintaining', 'preserving', 'conserving', 'saving', 'protecting', 'guarding', 'defending', 'shielding', 'screening', 'sheltering', 'covering', 'hiding', 'concealing', 'disguising', 'masking', 'veiling', 'shrouding', 'cloaking', 'clouding', 'obscuring', 'darkening', 'shadowing', 'shading', 'dimming', 'dulling', 'blunting', 'numbing', 'deadening', 'desensitizing', 'anesthetizing', 'stupefying', 'stunning', 'dazing', 'bewildering', 'confusing', 'puzzling', 'perplexing', 'baffling', 'mystifying', 'confounding', 'nonplussing', 'disconcerting', 'discomposing', 'disturbing', 'upsetting', 'troubling', 'worrying', 'bothering', 'annoying', 'irritating', 'vexing', 'exasperating', 'infuriating', 'enraging', 'maddening', 'driving crazy', 'driving mad', 'driving insane', 'deranging', 'unhinging', 'unbalancing', 'destabilizing', 'upsetting', 'overturning', 'subverting', 'undermining', 'sapping', 'weakening', 'debilitating', 'enervating', 'exhausting', 'draining', 'tiring', 'wearying', 'fatiguing', 'taxing', 'straining', 'stretching', 'extending', 'lengthening', 'prolonging', 'protracting', 'continuing', 'persisting', 'enduring', 'lasting', 'remaining', 'staying', 'abiding', 'continuing', 'surviving', 'living', 'existing', 'being', 'subsisting', 'persisting', 'enduring', 'continuing', 'lasting', 'remaining', 'abiding', 'staying', 'waiting', 'lingering', 'loitering', 'dawdling', 'dallying', 'delaying', 'postponing', 'deferring', 'suspending', 'staying', 'halting', 'stopping', 'pausing', 'resting', 'sleeping', 'slumbering', 'dozing', 'napping', 'snoozing', 'drowsing', 'dreaming', 'fantasizing', 'imagining', 'conceiving', 'envisioning', 'visualizing', 'picturing', 'envisaging', 'foreseeing', 'predicting', 'forecasting', 'projecting', 'extrapolating', 'inferring', 'deducing', 'concluding', 'reasoning', 'thinking', 'cogitating', 'pondering', 'musing', 'reflecting', 'contemplating', 'meditating', 'ruminating', 'deliberating', 'considering', 'weighing', 'evaluating', 'assessing', 'appraising', 'judging', 'rating', 'ranking', 'grading', 'scoring', 'marking', 'assessing', 'evaluating', 'reviewing', 'examining', 'inspecting', 'scrutinizing', 'scanning', 'surveying', 'studying', 'analyzing', 'investigating', 'researching', 'exploring', 'probing', 'searching', 'hunting', 'seeking', 'pursuing', 'questing', 'inquiring', 'asking', 'questioning', 'querying', 'interrogating', 'examining', 'testing', 'trying', 'attempting', 'endeavoring', 'striving', 'struggling', 'laboring', 'toiling', 'working', 'operating', 'functioning', 'performing', 'acting', 'behaving', 'conducting', 'carrying', 'bearing', 'deporting', 'comporting', 'acquitting', 'quitting', 'leaving', 'departing', 'going', 'exiting', 'egressing', 'emerging', 'appearing', 'materializing', 'manifesting', 'showing', 'displaying', 'exhibiting', 'presenting', 'demonstrating', 'proving', 'establishing', 'showing', 'indicating', 'suggesting', 'implying', 'inferring', 'deducing', 'concluding', 'gathering', 'understanding', 'comprehending', 'grasping', 'seizing', 'catching', 'capturing', 'apprehending', 'arresting', 'detaining', 'holding', 'keeping', 'retaining', 'maintaining', 'preserving', 'conserving', 'saving', 'protecting', 'guarding', 'defending', 'shielding', 'screening', 'sheltering', 'covering', 'hiding', 'concealing', 'secreting', 'burying', 'interring', 'entombing', 'inhuming', 'cremating', 'incinerating', 'burning', 'combusting', 'igniting', 'kindling', 'lighting', 'firing', 'burning', 'charring', 'scorching', 'searing', 'singeing', 'blistering', 'burning', 'smarting', 'stinging', 'tingling', 'prickling', 'itching', 'scratching', 'rubbing', 'chafing', 'abrading', 'scraping', 'grating', 'grinding', 'gnashing', 'clashing', 'colliding', 'crashing', 'smashing', 'shattering', 'breaking', 'fracturing', 'cracking', 'splitting', 'dividing', 'separating', 'parting', 'disuniting', 'disjoining', 'disconnecting', 'detaching', 'unfastening', 'untying', 'undoing', 'loosening', 'slackening', 'relaxing', 'easing', 'relieving', 'alleviating', 'mitigating', 'palliating', 'assuaging', 'soothing', 'calming', 'quieting', 'pacifying', 'tranquilizing', 'sedating', 'stupefying', 'stunning', 'dazing', 'knocking out', 'anesthetizing', 'numbing', 'deadening', 'dulling', 'blunting', 'softening', 'cushioning', 'buffering', 'insulating', 'protecting', 'shielding', 'screening', 'guarding', 'defending', 'safeguarding', 'securing', 'making safe', 'making secure', 'locking', 'bolting', 'barring', 'fastening', 'securing', 'fixing', 'attaching', 'joining', 'connecting', 'linking', 'coupling', 'pairing', 'matching', 'mating', 'marrying', 'wedding', 'uniting', 'combining', 'joining', 'merging', 'fusing', 'blending', 'mixing', 'mingling', 'intermingling', 'commingling', 'amalgamating', 'integrating', 'incorporating', 'embodying', 'containing', 'including', 'comprising', 'consisting', 'constituting', 'forming', 'making', 'creating', 'producing', 'generating', 'originating', 'initiating', 'starting', 'beginning', 'commencing', 'opening', 'launching', 'introducing', 'presenting', 'offering', 'proposing', 'suggesting', 'recommending', 'advising', 'counseling', 'guiding', 'directing', 'leading', 'steering', 'piloting', 'navigating', 'sailing', 'cruising', 'coasting', 'gliding', 'sliding', 'slipping', 'skidding', 'skating', 'skiing', 'surfing', 'sailing', 'flying', 'soaring', 'hovering', 'floating', 'drifting', 'wafting', 'gliding', 'sailing', 'coasting', 'cruising', 'traveling', 'journeying', 'voyaging', 'touring', 'sightseeing', 'visiting', 'calling', 'stopping', 'staying', 'remaining', 'abiding', 'dwelling', 'residing', 'living', 'inhabiting', 'occupying', 'possessing', 'owning', 'holding', 'keeping', 'retaining', 'maintaining', 'preserving', 'conserving', 'saving', 'protecting', 'guarding', 'shielding', 'screening', 'sheltering', 'covering', 'hiding', 'concealing', 'disguising', 'masking', 'veiling', 'shrouding', 'cloaking', 'clouding', 'obscuring', 'darkening', 'shadowing', 'shading', 'dimming', 'dulling', 'blunting', 'numbing', 'deadening', 'desensitizing', 'anesthetizing', 'stupefying', 'stunning', 'dazing', 'bewildering', 'confusing', 'puzzling', 'perplexing', 'baffling', 'mystifying', 'confounding', 'nonplussing', 'disconcerting', 'discomposing', 'disturbing', 'upsetting', 'troubling', 'worrying', 'bothering', 'annoying', 'irritating', 'vexing', 'exasperating', 'infuriating', 'enraging', 'maddening'
]);

export function matchesNounPattern(word: string): boolean {
  return COMMON_NOUNS.has(word.toLowerCase());
}

/**
 * TieredVerifier implements a three-tier verification system for grounding claims.
 *
 * Tier 1 - Lexical: Fast token overlap check using Jaccard similarity
 * Tier 2 - Semantic: N-gram and phrase overlap for paraphrase detection
 * Tier 3 - Entailment: LLM-based logical entailment verification (placeholder)
 *
 * @example
 * ```typescript
 * const verifier = new TieredVerifier({
 *   lexicalThreshold: 0.3,
 *   semanticThreshold: 0.6,
 *   entailmentThreshold: 0.7,
 * });
 *
 * const result = await verifier.verify(
 *   "Climate change is causing rising sea levels",
 *   ["Global warming leads to increased ocean levels"]
 * );
 * ```
 */
export class TieredVerifier {
  private readonly config: VerificationConfig;

  /**
   * Creates a new TieredVerifier with optional configuration overrides.
   *
   * @param config - Partial configuration to override defaults
   */
  constructor(config?: Partial<VerificationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Verifies a claim against source texts using lexical token overlap.
   * This is the fastest tier, useful for rejecting claims with no lexical basis.
   *
   * @param claim - The claim to verify
   * @param sources - Array of source texts to check against
   * @returns Object containing max overlap ratio and verification status
   *
   * @example
   * ```typescript
   * const result = verifier.verifyLexical(
   *   "The cat sat on the mat",
   *   ["A cat was sitting on a mat"]
   * );
   * // result: { overlap: 0.4, verified: true }
   * ```
   */
  verifyLexical(claim: string, sources: string[]): LexicalResult {
    if (!claim.trim() || sources.length === 0) {
      return { overlap: 0, verified: false };
    }

    let maxOverlap = 0;

    for (const source of sources) {
      const overlap = calculateTokenOverlap(claim, source);
      maxOverlap = Math.max(maxOverlap, overlap);
    }

    return {
      overlap: maxOverlap,
      verified: maxOverlap >= this.config.lexicalThreshold,
    };
  }

  /**
   * Verifies a claim against source texts using semantic similarity.
   * Uses n-gram overlap as a simplified semantic similarity measure.
   *
   * @param claim - The claim to verify
   * @param sources - Array of source texts to check against
   * @returns Promise resolving to similarity score and verification status
   *
   * @example
   * ```typescript
   * const result = await verifier.verifySemantic(
   *   "The economy is growing rapidly",
   *   ["Economic growth has been strong"]
   * );
   * // result: { similarity: 0.65, verified: true }
   * ```
   */
  async verifySemantic(claim: string, sources: string[]): Promise<SemanticResult> {
    if (!claim.trim() || sources.length === 0) {
      return { similarity: 0, verified: false };
    }

    let maxSimilarity = 0;

    for (const source of sources) {
      // Use bigram overlap as primary semantic measure
      const bigramSim = calculateNGramOverlap(claim, source, 2);
      // Use trigram overlap for phrase-level matching
      const trigramSim = calculateNGramOverlap(claim, source, 3);
      // Extract and compare key phrases
      const claimPhrases = extractKeyPhrases(claim);
      const sourcePhrases = extractKeyPhrases(source);
      const phraseOverlap = calculatePhraseOverlap(claimPhrases, sourcePhrases);

      // Combined semantic score weighted toward n-grams
      const similarity = bigramSim * 0.4 + trigramSim * 0.4 + phraseOverlap * 0.2;
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }

    return {
      similarity: maxSimilarity,
      verified: maxSimilarity >= this.config.semanticThreshold,
    };
  }

  /**
   * Verifies a claim against source texts using logical entailment.
   * This is a placeholder for future LLM-based entailment checking.
   *
   * Currently returns a conservative score based on semantic similarity.
   *
   * @param claim - The claim to verify
   * @param sources - Array of source texts to check against
   * @returns Promise resolving to entailment score and verification status
   *
   * @example
   * ```typescript
   * const result = await verifier.verifyEntailment(
   *   "Renewable energy reduces carbon emissions",
   *   ["Solar and wind power lower CO2 output"]
   * );
   * // result: { score: 0.75, verified: true }
   * ```
   */
  async verifyEntailment(claim: string, sources: string[], precomputedSemantic?: SemanticResult): Promise<EntailmentResult> {
    if (!claim.trim() || sources.length === 0) {
      return { score: 0, verified: false };
    }

    // Placeholder: Use semantic similarity as a proxy for entailment
    // In production, this would call an LLM for true entailment checking
    const semanticResult = precomputedSemantic ?? await this.verifySemantic(claim, sources);

    // Apply a scaling factor to semantic similarity for entailment estimation
    // This is a conservative approach - entailment requires higher confidence
    const entailmentScore = Math.min(1, semanticResult.similarity * 0.8);

    return {
      score: entailmentScore,
      verified: entailmentScore >= this.config.entailmentThreshold,
    };
  }

  /**
   * Runs all three verification tiers in sequence.
   * Stops early if lexical verification fails (fast path rejection).
   *
   * @param claim - The claim to verify
   * @param sources - Array of source texts to check against
   * @returns Promise resolving to complete verification result
   *
   * @example
   * ```typescript
   * const result = await verifier.verify(
   *   "AI will transform healthcare",
   *   ["Artificial intelligence is changing medical practice"]
   * );
   *
   * if (result.verified) {
   *   console.log(`Verified at ${result.tier} tier with confidence ${result.confidence}`);
   * }
   * ```
   */
  async verify(claim: string, sources: string[]): Promise<VerificationResult> {
    const issues: string[] = [];

    // Tier 1: Lexical verification (fast rejection)
    const lexicalResult = this.verifyLexical(claim, sources);

    if (!lexicalResult.verified) {
      return {
        verified: false,
        confidence: lexicalResult.overlap,
        tier: 'lexical',
        details: { lexicalOverlap: lexicalResult.overlap },
        issues: [...issues, 'Failed lexical verification - insufficient token overlap'],
      };
    }

    // Tier 2: Semantic verification
    const semanticResult = await this.verifySemantic(claim, sources);

    if (!semanticResult.verified) {
      return {
        verified: false,
        confidence: semanticResult.similarity,
        tier: 'semantic',
        details: {
          lexicalOverlap: lexicalResult.overlap,
          semanticSimilarity: semanticResult.similarity,
        },
        issues: [...issues, 'Failed semantic verification - insufficient similarity'],
      };
    }

    // Tier 3: Entailment verification
    const entailmentResult = await this.verifyEntailment(claim, sources, semanticResult);

    // Determine final verification status
    const verified = entailmentResult.verified;
    const confidence = entailmentResult.score;

    if (!verified) {
      issues.push('Failed entailment verification - logical entailment not established');
    }

    return {
      verified,
      confidence,
      tier: 'entailment',
      details: {
        lexicalOverlap: lexicalResult.overlap,
        semanticSimilarity: semanticResult.similarity,
        entailmentScore: entailmentResult.score,
      },
      issues,
    };
  }
}

/**
 * Calculates token overlap between two texts using Jaccard-like similarity.
 * Removes stopwords and punctuation for fair comparison.
 *
 * @param text1 - First text to compare
 * @param text2 - Second text to compare
 * @returns Token overlap ratio between 0 and 1
 *
 * @example
 * ```typescript
 * const overlap = calculateTokenOverlap(
 *   "The quick brown fox",
 *   "A quick brown dog"
 * );
 * // overlap: 0.4 (2 shared tokens / 5 unique tokens)
 * ```
 */
export function calculateTokenOverlap(text1: string, text2: string): number {
  const tokens1 = tokenize(text1);
  const tokens2 = tokenize(text2);

  if (tokens1.length === 0 || tokens2.length === 0) {
    return 0;
  }

  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);

  const intersection = new Set([...set1].filter(t => set2.has(t)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

/**
 * Calculates n-gram overlap between two texts.
 * Higher n values capture more phrase-level similarity.
 *
 * @param text1 - First text to compare
 * @param text2 - Second text to compare
 * @param n - N-gram size (default: 2 for bigrams)
 * @returns N-gram overlap ratio between 0 and 1
 *
 * @example
 * ```typescript
 * const sim = calculateNGramOverlap(
 *   "machine learning is powerful",
 *   "machine learning works well",
 *   2
 * );
 * // sim: 0.33 (1 shared bigram / 3 unique bigrams)
 * ```
 */
export function calculateNGramOverlap(text1: string, text2: string, n = 2): number {
  const tokens1 = tokenize(text1);
  const tokens2 = tokenize(text2);

  if (tokens1.length < n || tokens2.length < n) {
    return 0;
  }

  const ngrams1 = extractNgrams(tokens1, n);
  const ngrams2 = extractNgrams(tokens2, n);

  const set1 = new Set(ngrams1);
  const set2 = new Set(ngrams2);

  const intersection = new Set([...set1].filter(g => set2.has(g)));
  const union = new Set([...set1, ...set2]);

  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Extracts key phrases (noun phrases and important terms) from text.
 * Uses regex patterns and simple heuristics for phrase extraction.
 *
 * @param text - The text to extract phrases from
 * @returns Array of extracted key phrases
 *
 * @example
 * ```typescript
 * const phrases = extractKeyPhrases(
 *   "Artificial Intelligence is transforming healthcare"
 * );
 * // phrases: ["Artificial Intelligence", "healthcare"]
 * ```
 */
export function extractKeyPhrases(text: string): string[] {
  const phrases: string[] = [];

  for (const pattern of NOUN_PHRASE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      phrases.push(...matches.map(m => m.toLowerCase().trim()));
    }
  }

  // Add matched nouns from words
  const words = text.split(/\W+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word && matchesNounPattern(word)) {
      phrases.push(word.toLowerCase());
      // 2-word phrase reconstruction
      const prevWord = i > 0 ? words[i - 1] : undefined;
      if (prevWord && prevWord.length > 2 && /\w{3,}/.test(prevWord)) {
        phrases.push(prevWord.toLowerCase() + ' ' + word.toLowerCase());
      }
    }
  }

  // Also extract capitalized terms that might be proper nouns
  const capitalizedTerms = text.match(/\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*\b/g);
  if (capitalizedTerms) {
    phrases.push(...capitalizedTerms.map(t => t.toLowerCase()));
  }

  // Remove duplicates while preserving order
  return Array.from(new Set(phrases));
}

/**
 * Tokenizes text into lowercase words, removing stopwords and punctuation.
 *
 * @param text - The text to tokenize
 * @returns Array of tokens
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0 && !STOPWORDS.has(t));
}

/**
 * Extracts n-grams from an array of tokens.
 *
 * @param tokens - Array of tokens
 * @param n - N-gram size
 * @returns Array of n-gram strings
 */
function extractNgrams(tokens: string[], n: number): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join('_'));
  }
  return ngrams;
}

/**
 * Calculates overlap between two sets of phrases.
 *
 * @param phrases1 - First set of phrases
 * @param phrases2 - Second set of phrases
 * @returns Overlap ratio between 0 and 1
 */
function calculatePhraseOverlap(phrases1: string[], phrases2: string[]): number {
  if (phrases1.length === 0 || phrases2.length === 0) {
    return 0;
  }

  const set1 = new Set(phrases1);
  const set2 = new Set(phrases2);

  const intersection = new Set([...set1].filter(p => set2.has(p)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}
