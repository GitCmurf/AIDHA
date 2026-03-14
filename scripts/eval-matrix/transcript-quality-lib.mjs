export function summarizeTranscriptQuality(transcript, durationMinutes = 0) {
    const segments = Array.isArray(transcript.segments) ? transcript.segments : [];
    const texts = segments.map(segment => String(segment.text || "").trim()).filter(Boolean);
    const fullText = String(transcript.fullText || texts.join(" ")).trim();
    const words = fullText.split(/\s+/).filter(Boolean);
    const last = segments[segments.length - 1];
    const transcriptEndSeconds = last ? Number(last.start || 0) + Number(last.duration || 0) : 0;
    const expectedSeconds = durationMinutes > 0 ? durationMinutes * 60 : 0;
    const coverageRatio = expectedSeconds > 0 ? transcriptEndSeconds / expectedSeconds : 0;
    const wordsPerMinute = transcriptEndSeconds > 0 ? words.length / (transcriptEndSeconds / 60) : 0;
    const weirdTokens = words.filter(word => /[^a-zA-Z'’.-]/.test(word) && !/^[0-9]+$/.test(word));
    const weirdRate = words.length > 0 ? weirdTokens.length / words.length : 0;

    const coverageThreshold = durationMinutes >= 45 ? 0.5 : 0.4;
    const flags = [
        ...(segments.length === 0 ? ["empty_segments"] : []),
        ...(!texts[0] || !texts[texts.length - 1] ? ["missing_boundary_text"] : []),
        ...(segments.length < 20 ? ["low_segments"] : []),
        ...(expectedSeconds > 0 && coverageRatio < coverageThreshold ? ["coverage_too_low"] : []),
        ...(weirdRate > 0.15 ? ["weird_token_rate"] : []),
    ];

    return {
        segmentCount: segments.length,
        transcriptEndSeconds,
        coverageRatio,
        words: words.length,
        wordsPerMinute,
        weirdRate,
        flags,
        acceptable: flags.length === 0,
    };
}
