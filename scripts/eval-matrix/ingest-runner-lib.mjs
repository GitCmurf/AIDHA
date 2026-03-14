import path from "node:path";

export function transcriptPath(cacheDir, videoId) {
    return path.join(cacheDir, `${videoId}.json`);
}

export function selectPendingVideoIds(corpusEntries, cachedVideoIds, filterVideoId = "") {
    const corpusVideoIds = corpusEntries.map(entry => entry.videoId);
    if (filterVideoId) {
        if (!corpusVideoIds.includes(filterVideoId)) {
            throw new Error(`Video ${filterVideoId} not found in corpus`);
        }
        return cachedVideoIds.has(filterVideoId) ? [] : [filterVideoId];
    }

    return corpusVideoIds.filter(videoId => !cachedVideoIds.has(videoId));
}

export function buildSingleVideoIngestArgs(options, videoId) {
    const args = [
        "scripts/eval-matrix/ingest-corpus.sh",
        "--corpus", options.corpusPath,
        "--cache-dir", options.cacheDir,
        "--db", options.dbPath,
    ];
    if (options.configPath) {
        args.push("--config", options.configPath);
    }
    args.push(
        "--video-id", videoId,
        "--request-delay-seconds", "0",
        "--failure-delay-seconds", "0",
    );
    return args;
}
