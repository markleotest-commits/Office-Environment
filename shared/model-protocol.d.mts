import type { Observation, Action } from '../src/types';
export const ACTION_SCHEMA: Record<string, unknown>;
export const MODEL_INSTRUCTIONS: string;
export function compactObservation(
  observation: Observation,
): Record<string, unknown>;
export function parseModelAction(text: string): Action;
