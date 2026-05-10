import { writeFileAtomic } from "../utils/io.js";
import type { NarrowComparisonReport } from "./narrow-manual-baseline.js";
import { renderNarrowComparisonMarkdown } from "./narrow-report-renderer.js";
import { buildReportFileSet, type ReportFileSet } from "./report-files.js";

export async function writeNarrowComparisonReport(
  report: NarrowComparisonReport,
  outputDir: string,
  stub: string
): Promise<ReportFileSet> {
  const files = buildReportFileSet(outputDir, stub);
  const jsonContent = JSON.stringify(report, null, 2);
  const mdContent = renderNarrowComparisonMarkdown(report);
  await writeFileAtomic(files.jsonPath, jsonContent);
  await writeFileAtomic(files.mdPath, mdContent);
  await writeFileAtomic(files.latestJsonPath, jsonContent);
  await writeFileAtomic(files.latestMdPath, mdContent);
  return files;
}
