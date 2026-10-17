export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/decisions';

const CATEGORY_CHOICE_DESCRIPTIONS = {
  applies: 'The source substantively concerns the subject named in the question.',
  not_applicable: 'The source does not substantively concern the subject; negated or incidental mentions do not count.',
  unknown: 'The source does not provide enough context to decide reliably.',
};

function choiceValues(question) {
  if (!question || question.type !== 'choice') throw new TypeError('Only choice questions are supported');
  if (typeof question.instructions !== 'string' || !question.instructions.trim()) {
    throw new TypeError('Choice question needs nonempty instructions');
  }
  let choices;
  if (Array.isArray(question.choices)) {
    choices = question.choices.map(value => ({ value, ...(Object.hasOwn(CATEGORY_CHOICE_DESCRIPTIONS, value)
      ? { description: CATEGORY_CHOICE_DESCRIPTIONS[value] } : {}) }));
  } else if (question.criteria && typeof question.criteria === 'object' && !Array.isArray(question.criteria)) {
    choices = Object.entries(question.criteria).map(([value, description]) => ({ value, description }));
  } else throw new TypeError('Choice question needs choices or criteria');
  if (choices.length < 2 || choices.length > 255) throw new RangeError('Choice questions need 2–255 choices');
  if (choices.some(({ value, description }) => typeof value !== 'string' || !value.trim() ||
      (description !== undefined && (typeof description !== 'string' || !description.trim())))) {
    throw new TypeError('Choice values and descriptions must be nonempty strings');
  }
  if (new Set(choices.map(({ value }) => value)).size !== choices.length) {
    throw new TypeError('Choice values must be unique; duplicate choice');
  }
  return choices;
}

export function buildOpenAIPayload(request, model) {
  if (typeof model !== 'string' || !model.trim()) throw new TypeError('OpenAI model must be nonempty');
  if (!request || typeof request !== 'object' || !request.questions ||
      typeof request.questions !== 'object' || Array.isArray(request.questions) || request.state === undefined) {
    throw new TypeError('Decision request needs state and named questions');
  }
  const entries = Object.entries(request.questions);
  if (entries.length < 1 || entries.length > 200) throw new RangeError('Decisions need 1–200 questions');
  const questions = entries.map(([name, question]) => {
    if (!name.trim()) throw new TypeError('Decision question name must be nonempty');
    return { type: 'choice', name, instructions: question.instructions, choices: choiceValues(question) };
  });
  const input = JSON.stringify(request.state);
  if (typeof input !== 'string' || !input) throw new TypeError('Decision state must be JSON serializable');
  return { model, input, questions };
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validProbability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

function validateProbabilities(answer, options) {
  if (answer.confidence !== undefined && !validProbability(answer.confidence)) {
    throw new TypeError('Choice confidence must be a finite probability');
  }
  if (answer.probabilities === undefined) return;
  if (!Array.isArray(answer.probabilities) || answer.probabilities.length !== options.length) {
    throw new TypeError('Choice probabilities must cover every option');
  }
  const values = new Set();
  let total = 0;
  for (const entry of answer.probabilities) {
    if (!isRecord(entry) || typeof entry.value !== 'string' || !options.includes(entry.value) ||
        values.has(entry.value) || !validProbability(entry.probability)) {
      throw new TypeError('Choice probabilities contain an invalid value or probability');
    }
    values.add(entry.value);
    total += entry.probability;
  }
  if (Math.abs(total - 1) > 0.02) throw new TypeError('Choice probabilities must sum to one within rounding tolerance');
}

export function parseOpenAIReply(rawReply, request) {
  const payload = buildOpenAIPayload(request, '_request_validation_');
  const expected = new Map(payload.questions.map(question =>
    [question.name, question.choices.map(({ value }) => value)]));
  const resolvedModel = typeof rawReply?.model === 'string' && rawReply.model.trim() ? rawReply.model : null;
  const usage = isRecord(rawReply?.usage) ? rawReply.usage : null;
  const base = { answers: [], resolvedModel, usage, costUsd: null };
  const fail = message => ({ status: 'error', ...base, error: message });
  if (!isRecord(rawReply)) return fail('OpenAI reply must be an object');
  if (rawReply.error !== undefined && rawReply.error !== null) {
    const message = typeof rawReply.error?.message === 'string' ? rawReply.error.message : 'OpenAI returned an error';
    return fail(message);
  }
  if (!resolvedModel) return fail('OpenAI reply has no resolved model identity');
  if (rawReply.usage !== undefined && rawReply.usage !== null && !isRecord(rawReply.usage)) {
    return fail('OpenAI reply usage must be an object');
  }
  if (!Array.isArray(rawReply.answers) || rawReply.answers.length !== expected.size) {
    return fail('OpenAI reply must cover every named question exactly once');
  }
  const seen = new Map();
  try {
    for (const answer of rawReply.answers) {
      if (!isRecord(answer) || typeof answer.name !== 'string' || !expected.has(answer.name) ||
          seen.has(answer.name)) throw new TypeError('OpenAI reply has an unknown or duplicate question name');
      if (answer.type === 'refusal') {
        seen.set(answer.name, null);
        continue;
      }
      if (answer.type !== 'choice') throw new TypeError('OpenAI reply expected a choice or refusal');
      const options = expected.get(answer.name);
      if (typeof answer.choice !== 'string' || !options.includes(answer.choice)) {
        throw new TypeError('OpenAI reply choice is not a supplied typed option');
      }
      validateProbabilities(answer, options);
      seen.set(answer.name, answer.choice);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const answers = [...expected.keys()].filter(name => seen.get(name) !== null)
    .map(questionId => ({ questionId, choice: seen.get(questionId) }));
  return { status: answers.length === expected.size ? 'ok' : 'refusal', answers, resolvedModel, usage, costUsd: null };
}
