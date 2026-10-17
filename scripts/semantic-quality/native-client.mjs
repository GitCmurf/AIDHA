// SPDX-License-Identifier: Apache-2.0
/** Evaluation-only LLM seam; execute supplies the native process boundary. */
export function createNativeClient({ model, calls, execute }) {
  return { async generate(request) {
    if (calls.length >= 3) throw new Error('Evaluation permits at most three calls per case');
    const call = { request }; calls.push(call);
    const args = ['--safe-mode', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--no-session-persistence', '--output-format', 'json', '--model', model, '--effort', 'low',
      '--system-prompt', request.system, '--print'];
    if (request.responseFormat?.type === 'json_schema') {
      // This generated schema uses common object/enum constraints; the CLI rejects its dialect URI.
      const nativeSchema = { ...request.responseFormat.schema };
      delete nativeSchema.$schema;
      args.push('--json-schema', JSON.stringify(nativeSchema));
    }
    const response = await execute(args, request.user);
    call.nativeReply = response;
    call.modelUsage = response.modelUsage; call.usage = response.usage;
    call.durationMs = response.duration_ms;
    if (response.is_error) throw new Error(`Native CLI failed: ${response.subtype ?? 'unknown error'}`);
    const value = request.responseFormat?.type === 'json_schema'
      ? response.structured_output && JSON.stringify(response.structured_output)
      : response.result;
    if (typeof value !== 'string' || !value.trim()) throw new Error('Native CLI did not return the requested completion format');
    call.response = value;
    const usage = response.usage;
    const inputTokens = usage && ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
      .reduce((sum, key) => sum + (usage[key] ?? 0), 0);
    const outputTokens = usage?.output_tokens;
    return { ok: true, value, ...(Number.isFinite(inputTokens) && Number.isFinite(outputTokens) ? {
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    } : {}) };
  } };
}
