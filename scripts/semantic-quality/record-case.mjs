// SPDX-License-Identifier: Apache-2.0
/** Preserve unsuccessful runtime attempts as well as returned reports. */
export async function recordCase({ caseId, calls, provenance, run, save }) {
  let result;
  try { result = await run(); }
  catch (error) {
    await save({ ...provenance, caseId, calls, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  await save({ ...provenance, calls, ...result });
  return result;
}
