// Hand-written declarations for answers.mjs, as for plans.mjs.

export const KEYABLE: Set<string>;
export type AnswerKey = { accept: string[] } | { checked: boolean };
export function parseKey(type: string, raw: unknown): AnswerKey | null;
export function serializeKey(type: string, key: unknown): string;
export function normalizeAnswer(s: string | null | undefined): string;
export function checkAnswer(type: string, rawKey: unknown, value: string | null | undefined): boolean | null;
export function letterFor(percent: number): "A" | "B" | "C" | "D" | "F";
