// Hand-written declarations for plans.mjs, so the worker and the SPA can import
// it under strict TypeScript without turning on allowJs for the whole project.

export const BETA_FREE: boolean;
export const FREE_NOTEBOOK_LIMIT: number;
export const FREE_STUDENT_LIMIT: number;

export type PlanKey = "free" | "pro" | "department" | "school";

export interface PlanSpec {
  label: string;
  priceCents: number;
  interval: "year";
  /** People one purchase covers; null means the whole school. */
  seats: number | null;
  /** Class notebooks per teacher; null means unlimited. */
  notebookLimit: number | null;
  /** Students per class; null means unlimited. */
  studentLimit: number | null;
  pageLibrary: boolean;
  schoolAdmin: boolean;
  selfServe: boolean;
}

export const PLANS: Record<PlanKey, PlanSpec>;

export function dollars(cents: number): string;
