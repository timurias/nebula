'use server';

/**
 * @fileOverview AI difficulty adjustment flow.
 *
 * This file defines a Genkit flow to adjust the AI opponent's difficulty level.
 * It includes the `adjustAIDifficulty` function, which takes the desired difficulty
 * level as input and returns a confirmation message.
 *
 * @remarks
 * This flow does not directly implement the AI's move selection logic.
 * Instead, it provides a mechanism to set the difficulty level, which can
 * then be used by other parts of the application to influence the AI's behavior.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AIDifficultyInputSchema = z.object({
  difficulty: z
    .enum(['easy', 'medium', 'hard'])
    .describe('The desired difficulty level for the AI opponent.'),
});
export type AIDifficultyInput = z.infer<typeof AIDifficultyInputSchema>;

const AIDifficultyOutputSchema = z.object({
  message: z.string().describe('Confirmation message indicating the AI difficulty has been adjusted.'),
});
export type AIDifficultyOutput = z.infer<typeof AIDifficultyOutputSchema>;

export async function adjustAIDifficulty(input: AIDifficultyInput): Promise<AIDifficultyOutput> {
  return adjustAIDifficultyFlow(input);
}

const adjustAIDifficultyPrompt = ai.definePrompt({
  name: 'adjustAIDifficultyPrompt',
  input: {schema: AIDifficultyInputSchema},
  output: {schema: AIDifficultyOutputSchema},
  prompt: `You are an expert game designer who helps users adjust the difficulty of a game AI.

Given the user's desired difficulty level, confirm that the AI difficulty has been adjusted to that level.

Difficulty Level: {{{difficulty}}}

Confirmation Message: AI difficulty has been adjusted to {{difficulty}}.`,
});

const adjustAIDifficultyFlow = ai.defineFlow(
  {
    name: 'adjustAIDifficultyFlow',
    inputSchema: AIDifficultyInputSchema,
    outputSchema: AIDifficultyOutputSchema,
  },
  async input => {
    const {output} = await adjustAIDifficultyPrompt(input);
    return output!;
  }
);
