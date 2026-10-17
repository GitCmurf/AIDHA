// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';

export const AGY_SELECTOR = 'gemini-3.8-flash-low';

/** Process boundary. Report incomplete capture if forced termination never closes stdio. */
export function runAgyProcess({ executable, args, input, cwd, timeoutMs = 90000,
  killGraceMs = 2000, closeWaitMs = 2000, spawnProcess = spawn }) {
  return new Promise(resolve => {
    let child;
    try { child = spawnProcess(executable, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (error) {
      resolve({ stdout: '', stderr: '', exitCode: null, signal: null, timedOut: false,
        spawnError: error instanceof Error ? error.message : String(error) });
      return;
    }
    let stdout = ''; let stderr = ''; let timedOut = false; let spawnError = null; let settled = false;
    let killTimer; let closeTimer;
    const finish = (exitCode, signal, captureIncomplete = false) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(killTimer); clearTimeout(closeTimer);
      resolve({ stdout, stderr, exitCode, signal, timedOut, spawnError,
        ...(captureIncomplete ? { captureIncomplete: true } : {}) });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // `close` fires after stdio drains. Resolving at SIGKILL would lose late bytes.
      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
        // A pathological child may never emit `close`; this record is then partial.
        closeTimer = setTimeout(() => {
          // A descendant may still hold inherited stdio. The capture is incomplete;
          // release those handles so the manual CLI can stop after saving the record.
          child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
          child.unref?.();
          finish(null, 'SIGKILL', true);
        }, closeWaitMs);
      }, killGraceMs);
    }, timeoutMs);
    // Node's StringDecoder preserves UTF-8 characters split across pipe chunks.
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => { stdout += text; });
    child.stderr.on('data', text => { stderr += text; });
    child.on('error', error => { spawnError = error instanceof Error ? error.message : String(error); });
    child.on('close', finish);
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

const failure = message => ({ ok: false, error: new Error(message) });
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Grounding is advisory in the production miner; native failures still end this evaluation. */
export const mustStopAgyEvaluation = (report, calls) =>
  report.sourceDistillation?.failedClosed === true || calls.some(call => call.outcome !== 'ok');

function parseTranscript(stdout) {
  const lines = stdout.trim().split('\n').filter(Boolean);
  if (!lines.length) throw new Error('AGY returned no NDJSON');
  try { return lines.map(line => JSON.parse(line)); }
  catch { throw new Error('AGY returned malformed NDJSON'); }
}

function responseJson(response) {
  if (typeof response !== 'string') throw new Error('AGY result has no response');
  const value = response.trim();
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const content = fenced ? fenced[1].trim() : value;
  const parsed = JSON.parse(content);
  if (!isRecord(parsed)) throw new Error('AGY response must be one JSON object');
  return content;
}

/** Evaluation-only LLM client. The caller injects the native process and retains every call. */
export function createAgyClient({ model = AGY_SELECTOR, calls, execute }) {
  if (model !== AGY_SELECTOR) throw new Error(`Unsupported AGY selector: ${model}`);
  if (!Array.isArray(calls) || typeof execute !== 'function') throw new TypeError('AGY needs calls and execute');
  return { async generate(request) {
    if (calls.length >= 3) {
      const call = { request, requestedSelector: model, executed: false,
        outcome: 'error', error: 'Evaluation permits at most three calls per case' };
      calls.push(call);
      return failure(call.error);
    }
    const call = { request, requestedSelector: model, executed: true };
    calls.push(call);
    const failCall = message => { call.outcome = 'error'; call.error = message; return failure(message); };
    const args = ['--model', model, '--mode', 'plan', '--sandbox', '--disable-slash-commands',
      '--print-timeout', '60s', '--input-format', 'stream-json', '--output-format', 'stream-json'];
    // Native schema enforcement is not established by the recorded smoke. The existing
    // production parser validates the source-grounded response after this prompt-only call.
    const schema = request.responseFormat?.type === 'json_schema'
      ? `\nRequired JSON schema (host validates it): ${JSON.stringify(request.responseFormat.schema)}` : '';
    const content = `${request.system}\nUse only the supplied source. Do not use tools, browse, delegate, run commands, or access files. Return exactly one JSON object with no other text.${schema}\n${request.user}`;
    const input = JSON.stringify({ event: 'user', message: { content } }) + '\n';
    let raw;
    try { raw = await execute(args, input); }
    catch (error) {
      call.executionError = error instanceof Error ? error.message : String(error);
      return failCall(`AGY process boundary failed: ${call.executionError}`);
    }
    call.raw = raw; // Capture before exit, status, identity or response validation.
    let events;
    try { events = parseTranscript(raw.stdout); }
    catch (error) { call.parseError = error.message; }
    if (events) {
      const inits = events.filter(value => value.event === 'init');
      const results = events.filter(value => value.event === 'result');
      call.reportedModel = inits.length === 1 && typeof inits[0].init?.model === 'string'
        ? inits[0].init.model : null;
      call.result = results.length === 1 ? results[0].result : null;
      call.usage = call.result?.usage ?? null;
    }
    if (raw.spawnError) return failCall(`AGY spawn failed: ${raw.spawnError}`);
    if (raw.captureIncomplete) return failCall('AGY capture incomplete after forced termination');
    if (raw.timedOut) return failCall('AGY timed out');
    if (raw.exitCode !== 0) return failCall(`AGY exited ${raw.exitCode}`);
    if (!events) return failCall(call.parseError);
    const results = events.filter(value => value.event === 'result');
    if (!call.reportedModel) return failCall('AGY result has no reported model identity');
    if (call.reportedModel !== model) return failCall(`AGY reported unexpected model identity: ${call.reportedModel}`);
    const outsideSource = events.some(value =>
      !['init', 'step_update', 'result'].includes(value.event) ||
      (value.event === 'step_update' && (value.step_update?.subagent_info ||
        !['user_input', 'agent_response'].includes(value.step_update?.step_type))));
    if (outsideSource) return failCall('AGY used a tool or delegated outside supplied source');
    if (results.length !== 1) return failCall('AGY did not return exactly one result');
    const result = results[0].result;
    if (result?.status !== 'SUCCESS') return failCall(`AGY result status ${result?.status ?? 'missing'}`);
    const usage = result.usage;
    if (!isRecord(usage) || !Number.isFinite(usage.input_tokens) || usage.input_tokens < 0 ||
        !Number.isFinite(usage.output_tokens) || usage.output_tokens < 0 ||
        !Number.isFinite(usage.total_tokens) || usage.total_tokens < usage.input_tokens + usage.output_tokens) {
      return failCall('AGY result has unknown or invalid usage');
    }
    let value;
    try { value = responseJson(result.response); }
    catch (error) { return failCall(`AGY returned invalid JSON: ${error.message}`); }
    call.response = value;
    call.outcome = 'ok';
    return { ok: true, value, usage: { inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens, totalTokens: usage.total_tokens } };
  } };
}
