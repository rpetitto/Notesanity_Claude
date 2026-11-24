// Hand-written declarations for grades.mjs, as for plans.mjs.

export const LETTER_PERCENT: Record<"A" | "B" | "C" | "D" | "F", number>;

export function letterPercent(letter: string | null | undefined): number | null;

export function gradeContribution(g: {
  grading: string;
  pointsMax: number | null | undefined;
  points?: number | null;
  letter?: string | null;
  complete?: number | boolean | null;
}): { earned: number; possible: number } | null;
