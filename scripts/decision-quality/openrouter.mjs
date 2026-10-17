// SPDX-License-Identifier: Apache-2.0
export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';

const CATEGORY_CRITERIA = {
  applies: 'The source substantively concerns the subject named in the question.',
  not_applicable: 'The source does not substantively concern the subject; negated or incidental mentions do not count.',
  unknown: 'The source does not provide enough context to decide reliably.',
};
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && Boolean(value.trim());

function choiceCriteria(question) {
  if (Array.isArray(question.choices)) {
    const keys = Object.keys(CATEGORY_CRITERIA);
    if (question.choices.length !== keys.length ||
        new Set(question.choices).size !== keys.length ||
        !question.choices.every(choice => Object.hasOwn(CATEGORY_CRITERIA, choice))) {
      throw new TypeError('Unsupported choice array; expected applies/not_applicable/unknown');
    }
    return { ...CATEGORY_CRITERIA };
  }
  if (!isRecord(question.criteria) || Object.keys(question.criteria).length < 2 ||
      !Object.values(question.criteria).every(nonempty)) {
    throw new TypeError('Choice criteria must map at least two options to descriptions');
  }
  return { ...question.criteria };
}

/** Project the normalized public request onto the documented Decisions request fields. */
export function buildOpenRouterPayload(request, model) {
  if (!nonempty(model)) throw new TypeError('OpenRouter model must be nonempty');
  if (!isRecord(request) || !isRecord(request.state) || !isRecord(request.questions) ||
      !Object.keys(request.questions).length) throw new TypeError('Request needs state and questions');
  const questions = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
    if (!nonempty(id) || !isRecord(question) || question.type !== 'choice' ||
        !nonempty(question.instructions)) throw new TypeError(`Invalid choice question ${id}`);
    return [id, { type: 'choice', instructions: question.instructions, criteria: choiceCriteria(question) }];
  }));
  return { model: model.trim(), state: structuredClone(request.state), questions };
}

/** Interpret a parsed native Decisions reply; the caller retains the raw reply separately. */
export function parseOpenRouterReply(rawReply, request) {
  let reply;
  try { reply = typeof rawReply === 'string' ? JSON.parse(rawReply) : rawReply; }
  catch { reply = null; }
  const resolvedModel = nonempty(reply?.model) ? reply.model : null;
  const usage = isRecord(reply?.usage) ? reply.usage : null;
  const costUsd = Number.isFinite(usage?.cost) && usage.cost >= 0 ? usage.cost : null;
  const failure = (status, error) => ({ status, answers: [], resolvedModel, usage, costUsd, error });
  if (!isRecord(reply)) return failure('error', 'Malformed OpenRouter reply');
  if (reply.refusal) return failure('refusal', 'OpenRouter returned an explicit refusal');
  if (reply.error) {
    const message = nonempty(reply.error?.message) ? reply.error.message : 'OpenRouter returned an error';
    return failure('error', message);
  }
  if (!resolvedModel) return failure('error', 'OpenRouter reply has no resolved model');
  if (!isRecord(request?.questions) || !Object.keys(request.questions).length || !isRecord(reply.answers)) {
    return failure('error', 'OpenRouter reply has no usable questions or answers');
  }
  const requestedIds = Object.keys(request.questions);
  const answerIds = Object.keys(reply.answers);
  if (answerIds.length !== requestedIds.length || requestedIds.some(id => !Object.hasOwn(reply.answers, id))) {
    return failure('error', 'OpenRouter reply has missing or unexpected answers');
  }
  const answers = [];
  for (const questionId of requestedIds) {
    const question = request.questions[questionId];
    const answer = reply.answers[questionId];
    const choices = Array.isArray(question?.choices) ? question.choices :
      isRecord(question?.criteria) ? Object.keys(question.criteria) : [];
    if (!choices.length || !isRecord(answer) || answer.type !== 'choice' ||
        typeof answer.choice !== 'string' || !choices.includes(answer.choice)) {
      return failure('error', `Invalid OpenRouter choice answer for ${questionId}`);
    }
    if (Object.hasOwn(answer, 'confidence') &&
        (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)) {
      return failure('error', `Invalid OpenRouter confidence for ${questionId}`);
    }
    if (Object.hasOwn(answer, 'probabilities')) {
      const probabilities = answer.probabilities;
      if (!isRecord(probabilities) || Object.keys(probabilities).length !== choices.length ||
          choices.some(choice => !Object.hasOwn(probabilities, choice) ||
            !Number.isFinite(probabilities[choice]) || probabilities[choice] < 0 || probabilities[choice] > 1) ||
          Math.abs(Object.values(probabilities).reduce((sum, probability) => sum + probability, 0) - 1) > 0.03) {
        return failure('error', `Invalid OpenRouter probabilities for ${questionId}`);
      }
    }
    answers.push({ questionId, choice: answer.choice });
  }
  return { status: 'ok', answers, resolvedModel, usage, costUsd };
}
