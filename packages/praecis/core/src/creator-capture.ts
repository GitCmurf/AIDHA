import { createHash } from 'node:crypto';
import { z } from 'zod';

export const CreatorNoteFailureReason = z.enum([
  'missing-tool', 'timeout', 'output-limit', 'invalid-data',
  'identity-mismatch', 'invalid-config', 'execution', 'aborted',
]);
export type CreatorNoteFailureReason = z.infer<typeof CreatorNoteFailureReason>;

/** Stored extraction withholds retained creator text after a material acquisition failure. */
export function hasFailedCreatorNoteAttempt(metadata: Record<string, unknown>): boolean {
  const attempt = metadata['creatorNoteCaptureAttempt'];
  return typeof attempt === 'object' && attempt !== null
    && 'state' in attempt && (attempt.state === 'failed' || attempt.state === 'not_configured');
}

/** Binds a capture protocol's persisted vocabulary to shared, provider-neutral behavior. */
export function createCreatorNoteProtocol<
  const TKind extends string,
  const TMethods extends readonly [string, ...string[]],
>(configuration: {
  readonly kind: TKind;
  readonly methods: TMethods;
  readonly legacyDefaultMethod: TMethods[number];
}) {
  const kind = configuration.kind;
  const legacyDefaultMethod = configuration.legacyDefaultMethod;
  if (kind.trim().length === 0) throw new Error('Capture kind must not be empty');
  const methods = [...configuration.methods] as [TMethods[number], ...TMethods[number][]];
  if (new Set(methods).size !== methods.length) throw new Error('Capture methods must be unique');
  if (!methods.includes(legacyDefaultMethod)) {
    throw new Error('Legacy default method must be in the configured method set');
  }
  Object.freeze(methods);

  const CreatorNoteMethod = z.enum(methods);
  const CreatorNoteAcquisition = z.discriminatedUnion('state', [
    z.object({ state: z.enum(['available', 'empty', 'unavailable']), method: CreatorNoteMethod.optional() }),
    z.object({ state: z.literal('failed'), reason: CreatorNoteFailureReason, method: CreatorNoteMethod.optional() }),
  ]);
  type CreatorNoteAcquisition = z.infer<typeof CreatorNoteAcquisition>;
  const CaptureHash = z.string().regex(/^[a-f0-9]{64}$/u);
  const CreatorNoteCaptureSchema = z.object({
    schemaVersion: z.literal(1), kind: z.literal(kind),
    sourceCanonicalId: z.string().min(1), sourceUrl: z.string().url(),
    state: z.enum(['available', 'empty', 'unavailable']), contentSha256: CaptureHash.nullable(),
    identitySha256: CaptureHash, capturedAt: z.string().datetime(),
  }).strict();
  const CreatorNoteCaptureAttemptSchema = z.discriminatedUnion('state', [
    z.object({ schemaVersion: z.literal(1), method: CreatorNoteMethod,
      state: z.literal('success'), attemptedAt: z.string().datetime() }).strict(),
    z.object({ schemaVersion: z.literal(1), method: CreatorNoteMethod,
      state: z.literal('failed'), reason: CreatorNoteFailureReason, attemptedAt: z.string().datetime() }).strict(),
    z.object({ schemaVersion: z.literal(1), method: CreatorNoteMethod,
      state: z.literal('not_configured'), attemptedAt: z.string().datetime() }).strict(),
  ]);
  type CreatorNoteCapture = z.infer<typeof CreatorNoteCaptureSchema>;

  function creatorNoteContentIdentity(
    input: Pick<CreatorNoteCapture, 'sourceCanonicalId' | 'sourceUrl' | 'state'>,
    description: string | undefined,
  ) {
    const contentSha256 = description === undefined ? null
      : createHash('sha256').update(description).digest('hex');
    const stable = {
      schemaVersion: 1, kind, sourceCanonicalId: input.sourceCanonicalId,
      sourceUrl: input.sourceUrl, state: input.state, contentSha256,
    };
    return { ...stable, identitySha256: createHash('sha256').update(JSON.stringify(stable)).digest('hex') };
  }

  function prepareCreatorNoteMetadata(input: {
    readonly description?: string;
    readonly acquisition?: CreatorNoteAcquisition;
    readonly storedRetrieval?: boolean;
    readonly sourceCanonicalId: string;
    readonly sourceUrl: string;
    readonly now: () => string;
  }): { description: string | undefined; metadata: Record<string, unknown> } {
    if (input.acquisition === undefined) {
      // Cached reconstruction must preserve the original receipt, including failed attempts.
      // Fresh legacy text is usable but is not verified by a previous acquisition receipt.
      return {
        description: input.description,
        metadata: {
          description: input.description,
          ...(!input.storedRetrieval && typeof input.description === 'string'
            ? { creatorNoteCapture: null, creatorNoteCaptureAttempt: null } : {}),
        },
      };
    }

    const parsed = CreatorNoteAcquisition.safeParse(input.acquisition);
    const acquired = parsed.success ? parsed.data : { state: 'failed' as const, reason: 'invalid-data' as const };
    const method = parsed.success ? parsed.data.method ?? legacyDefaultMethod : legacyDefaultMethod;
    const timestamp = input.now();
    if (acquired.state === 'failed') {
      return {
        description: undefined,
        metadata: {
          creatorNoteCaptureAttempt: {
            schemaVersion: 1, method, state: 'failed',
            reason: acquired.reason, attemptedAt: timestamp,
          },
        },
      };
    }

    const description = acquired.state === 'unavailable' ? undefined : input.description;
    if ((acquired.state === 'available' && (typeof description !== 'string' || description.length === 0))
      || (acquired.state === 'empty' && description !== '')) {
      return prepareCreatorNoteMetadata({
        ...input, acquisition: { state: 'failed', reason: 'invalid-data', method }, now: () => timestamp,
      });
    }
    const identity = creatorNoteContentIdentity({
      sourceCanonicalId: input.sourceCanonicalId, sourceUrl: input.sourceUrl, state: acquired.state,
    }, description);
    return {
      description,
      metadata: {
        description: description ?? null,
        creatorNoteCapture: { ...identity, capturedAt: timestamp },
        creatorNoteCaptureAttempt: {
          schemaVersion: 1, method, state: 'success', attemptedAt: timestamp,
        },
      },
    };
  }

  return {
    CreatorNoteAcquisition,
    CreatorNoteCaptureSchema,
    CreatorNoteCaptureAttemptSchema,
    creatorNoteContentIdentity,
    prepareCreatorNoteMetadata,
  };
}
