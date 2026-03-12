function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

export function sanitizeYouTubeUrl(rawUrl) {
    const parsed = new URL(String(rawUrl).trim());
    const videoId = parsed.searchParams.get("v");
    if (!videoId) {
        throw new Error(`URL is missing a YouTube video id: ${rawUrl}`);
    }
    return `https://www.youtube.com/watch?v=${videoId}`;
}

export function deriveExpectedClaimDensity(durationMinutes) {
    if (durationMinutes >= 75) return "high";
    if (durationMinutes >= 20) return "medium";
    return "low";
}

export function deriveSpeakerStyle(metadata) {
    const text = [
        metadata.title,
        metadata.channelName,
        metadata.description,
    ].map(normalizeWhitespace).join(" ").toLowerCase();

    if (/\b(panel|roundtable|symposium)\b/.test(text)) return "panel";
    if (/\b(interview|podcast|conversation|with\b| q&a\b| q and a\b)\b/.test(text)) return "interview";
    if (/\b(lecture|guide|explainer|masterclass|workout|tutorial)\b/.test(text)) return "solo";
    return "unknown";
}

export function inferTopicDomain(metadata) {
    const text = [
        metadata.title,
        metadata.channelName,
        metadata.description,
    ].map(normalizeWhitespace).join(" ").toLowerCase();

    if (/\b(neuro|brain|cognitive|sleep|dopamine|adhd|nervous system)\b/.test(text)) return "Neuroscience";
    if (/\b(workout|exercise|hypertrophy|strength|muscle|conditioning|fitness|training)\b/.test(text)) return "Exercise";
    if (/\b(nutrition|diet|protein|fat loss|fat\b|calorie|metabolism|supplement)\b/.test(text)) return "Nutrition";
    return "General";
}

export function buildCorpusEntry(metadata) {
    const durationMinutes = Number(((metadata.durationSeconds || 0) / 60).toFixed(1));
    const topicDomain = inferTopicDomain(metadata);
    const speakerStyle = deriveSpeakerStyle(metadata);
    const expectedClaimDensity = deriveExpectedClaimDensity(durationMinutes);

    return {
        videoId: metadata.videoId,
        url: sanitizeYouTubeUrl(metadata.sourceUrl),
        title: normalizeWhitespace(metadata.title || metadata.videoId),
        channelName: normalizeWhitespace(metadata.channelName || "Unknown Channel"),
        durationMinutes,
        topicDomain,
        expectedClaimDensity,
        description: normalizeWhitespace(metadata.description || ""),
        language: metadata.language || "en",
        captionSource: "unknown",
        speakerStyle,
        rationale: "Auto-generated from URL list and metadata lookup; review topicDomain, density, captionSource, speakerStyle, and rationale before final evaluation runs.",
    };
}
