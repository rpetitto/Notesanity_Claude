/**
 * How a grade counts toward an average.
 *
 * Read by the teacher gradebook, the student's own grades, and the CSV, so a
 * letter or a tick can't count one way on one screen and another way on the
 * next. Everything becomes points earned out of points possible, weighted by
 * the assignment's points possible:
 *
 * - points: the score itself.
 * - complete/incomplete: full marks or none.
 * - letter: the percentage below, out of 100. These are the school's own
 *   values, not a midpoint convention — an F is 59, just under passing, not
 *   zero. A letter assignment always weighs 100: its points-possible isn't
 *   shown anywhere (the column just says "Letter"), so it can't be what
 *   decides how much it counts.
 *
 * Ungraded work, and work with no grade yet, counts for nothing either way.
 */

export const LETTER_PERCENT = { A: 95, B: 85, C: 75, D: 65, F: 59 };

/** The percentage a letter stands for, or null for anything that isn't one. */
export function letterPercent(letter) {
  const key = String(letter ?? "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(LETTER_PERCENT, key) ? LETTER_PERCENT[key] : null;
}

/**
 * What one graded piece of work adds to an average: `{ earned, possible }`,
 * or null when it adds nothing.
 */
export function gradeContribution({ grading, pointsMax, points, letter, complete }) {
  if (grading === "letter") {
    const pct = letterPercent(letter);
    return pct === null ? null : { earned: pct, possible: 100 };
  }
  const weight = Number(pointsMax) > 0 ? Number(pointsMax) : 0;
  if (!weight) return null;
  if (grading === "points" && points !== null && points !== undefined) return { earned: Number(points), possible: weight };
  if (grading === "complete" && complete !== null && complete !== undefined) return { earned: complete ? weight : 0, possible: weight };
  return null;
}
