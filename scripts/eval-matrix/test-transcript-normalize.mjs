import assert from "node:assert";
import { normalizeTranscriptDocument, validateNormalizedTranscript } from "./transcript-normalize-lib.mjs";

console.log("Running transcript normalization tests...");

// Test clamping of negative values
const payload = {
    videoId: "test",
    segments: [
        { start: -1, duration: 5, text: "hello" },
        { start: 10, duration: -5, text: "world" }
    ]
};

const normalized = normalizeTranscriptDocument(payload);

assert.strictEqual(normalized.segments[0].start, 0, "Negative start should be clamped to 0");
assert.strictEqual(normalized.segments[1].duration, 0, "Negative duration should be clamped to 0");

// Test validation
assert.strictEqual(validateNormalizedTranscript(normalized), true, "Clamped transcript should be valid");

const invalidPayload = {
    videoId: "test",
    language: "en",
    fullText: "hello world",
    segments: [
        { start: -1, duration: 5, text: "hello" }
    ]
};

assert.strictEqual(validateNormalizedTranscript(invalidPayload), false, "Explicit negative start should be invalid");

console.log("All transcript normalization tests passed!");
