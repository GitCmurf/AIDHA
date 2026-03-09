import type { MatrixReport } from "./matrix-aggregator.js";

export function exportMatrixJson(report: MatrixReport, options: { pretty?: boolean } = {}): string {
  if (options.pretty) {
    return JSON.stringify(report, null, 2);
  }
  return JSON.stringify(report);
}
