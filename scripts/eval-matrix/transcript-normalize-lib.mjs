import fs from "node:fs";
import path from "node:path";

function decodeHtmlEntities(text) {
    return text
        .replace(/&nbsp;/gi, " ")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/gi, "'")
        .replace(/&amp;/gi, "&");
}

export function cleanSegmentText(text) {
    return decodeHtmlEntities(String(text || ""))
        .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, " ")
        .replace(/<\/?c>/g, " ")
        .replace(/<\/?[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function normalizeTranscriptDocument(payload) {
    const videoId = payload.videoId || payload.resourceId || "";
    const rawSegments = Array.isArray(payload.segments) ? payload.segments : [];
    const segments = rawSegments
        .map((segment) => {
            const start = Number(segment.start ?? 0);
            const duration = Number(segment.duration ?? Math.max(0, Number(segment.end ?? start) - start));
            return {
                start,
                duration,
                text: cleanSegmentText(segment.text || ""),
            };
        })
        .filter(segment => segment.text.length > 0);

    const language = payload.language || "en";
    const fullText = segments.map(segment => segment.text).join(" ").trim();

    return {
        videoId,
        language,
        segments,
        fullText,
    };
}

export function validateNormalizedTranscript(payload) {
    return Boolean(
        payload &&
        typeof payload.videoId === "string" &&
        payload.videoId.length > 0 &&
        typeof payload.language === "string" &&
        payload.language.length >= 2 &&
        Array.isArray(payload.segments) &&
        payload.segments.length > 0 &&
        typeof payload.fullText === "string" &&
        payload.fullText.length > 0 &&
        payload.segments.every(segment =>
            Number.isFinite(segment.start) &&
            Number.isFinite(segment.duration) &&
            typeof segment.text === "string" &&
            segment.text.length > 0
        )
    );
}

export function createNextBackupDir(baseDir) {
    fs.mkdirSync(baseDir, { recursive: true });
    const existing = fs.readdirSync(baseDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .map(name => {
            const match = name.match(/^(\d{3})-/);
            return match ? Number.parseInt(match[1], 10) : 0;
        })
        .filter(num => Number.isInteger(num));
    const next = (existing.length > 0 ? Math.max(...existing) : 0) + 1;
    const backupDir = path.join(baseDir, `${String(next).padStart(3, "0")}-normalize-transcripts`);
    fs.mkdirSync(backupDir, { recursive: true });
    return backupDir;
}
