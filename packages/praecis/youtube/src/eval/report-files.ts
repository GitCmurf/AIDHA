import { join } from "node:path";

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function pad3(value: number): string {
  return value.toString().padStart(3, "0");
}

export function formatReportFilestamp(date: Date = new Date()): string {
  return [
    date.getUTCFullYear().toString(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
    "T",
    pad2(date.getUTCHours()),
    pad2(date.getUTCMinutes()),
    pad2(date.getUTCSeconds()),
    pad3(date.getUTCMilliseconds()),
  ].join("");
}

export function sanitizeReportStub(stub: string): string {
  return stub
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "report";
}

export interface ReportFileSet {
  stub: string;
  filestamp: string;
  jsonPath: string;
  mdPath: string;
  latestJsonPath: string;
  latestMdPath: string;
}

export function buildReportFileSet(outputDir: string, stub: string, date: Date = new Date()): ReportFileSet {
  const sanitizedStub = sanitizeReportStub(stub);
  const filestamp = formatReportFilestamp(date);
  const baseName = `${sanitizedStub}-${filestamp}`;

  return {
    stub: sanitizedStub,
    filestamp,
    jsonPath: join(outputDir, `${baseName}.json`),
    mdPath: join(outputDir, `${baseName}.md`),
    latestJsonPath: join(outputDir, "latest.json"),
    latestMdPath: join(outputDir, "latest.md"),
  };
}
