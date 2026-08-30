// KB settings (dcl-01). One named setting today — kb.extract.workerBudgetMs
// — resolved ENV-FIRST exactly like getAiSettings() in
// src/lib/ai/settings.ts:68: the environment variable wins, the Setting row
// is the desk-level default, and the constant is the fresh-install default.
// The budget is a NAMED setting rather than a wall-clock constant so an
// operator of a slow extraction lane (dcl-03+) can raise it without a
// deploy; extraction OUTPUT never depends on it, so nothing stored is
// invalidated when it moves.

/** The minimal structural reader the budget needs — accepts the app's
 *  $extends-extended client and a bare PrismaClient alike. */
export interface SettingReader {
  setting: {
    findUnique(args: { where: { key: string } }): Promise<{ value: string } | null>;
  };
}

export const KB_EXTRACT_BUDGET_KEY = "kb.extract.workerBudgetMs";
export const KB_EXTRACT_BUDGET_ENV = "KB_EXTRACT_WORKER_BUDGET_MS";
export const KB_EXTRACT_BUDGET_DEFAULT_MS = 360_000;

/** Resolve the extraction budget: env → Setting row → default. db may be
 *  null where no database handle exists (the pure runner paths). */
export async function getKbExtractBudgetMs(db: SettingReader | null): Promise<number> {
  const env = Number(process.env[KB_EXTRACT_BUDGET_ENV]);
  if (Number.isFinite(env) && env > 0) return env;
  if (db) {
    const row = await db.setting.findUnique({ where: { key: KB_EXTRACT_BUDGET_KEY } });
    const stored = Number(row?.value);
    if (Number.isFinite(stored) && stored > 0) return stored;
  }
  return KB_EXTRACT_BUDGET_DEFAULT_MS;
}
