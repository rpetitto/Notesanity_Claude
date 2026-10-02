/**
 * Scheduled work.
 *
 * Fling ran cron inside the process; Workers delivers it as a separate
 * `scheduled()` invocation driven by the triggers declared in wrangler.jsonc.
 * Registration keeps the same three-argument shape the app already uses, so
 * the mail-queue drain reads exactly as it did — the schedule string here is
 * matched against the trigger that fired.
 */

export interface CronJob {
  name: string;
  schedule: string;
  handler: () => unknown;
}

const jobs: CronJob[] = [];

export function cron(name: string, schedule: string, handler: () => unknown) {
  if (jobs.some((j) => j.name === name)) throw new Error(`Duplicate cron job: ${name}`);
  jobs.push({ name, schedule, handler });
}

export const cronJobs = () => jobs;

/**
 * Run everything registered for a fired trigger.
 *
 * A job that throws must not take the others down with it — the drain failing
 * is not a reason for a future job to be skipped — so failures are reported
 * per job rather than thrown.
 */
export async function runScheduled(cronExpression: string) {
  const due = jobs.filter((j) => j.schedule === cronExpression);
  const results: { name: string; ok: boolean; result?: unknown; error?: string }[] = [];
  for (const job of due) {
    try {
      results.push({ name: job.name, ok: true, result: await job.handler() });
    } catch (err) {
      results.push({ name: job.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
