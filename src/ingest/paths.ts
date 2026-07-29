/**
 * Where a run writes.
 *
 * A dry run exists to prove the pipeline is wired up without contacting a
 * source, and it collects nothing by construction — so if it wrote to the real
 * locations it would replace a good corpus and the committed run report with
 * empty ones. That is exactly what happened the first time the verification
 * gate was run against a populated checkout, which is why the choice lives here
 * rather than at the two call sites that could each forget it.
 */

export interface RunPaths {
  outDir: string;
  reportPath: string;
}

const DRY_DIR = 'data/dry-run';

export function runPaths(
  dry: boolean,
  env: { GRS_OUT_DIR?: string | undefined; GRS_REPORT_PATH?: string | undefined } = {},
): RunPaths {
  if (dry) {
    // Deliberately not overridable: the point is that a dry run cannot be
    // pointed at anything real, however it is invoked.
    return { outDir: DRY_DIR, reportPath: `${DRY_DIR}/run-report.json` };
  }
  return {
    outDir: env.GRS_OUT_DIR ?? 'public',
    reportPath: env.GRS_REPORT_PATH ?? 'data/run-report.json',
  };
}
