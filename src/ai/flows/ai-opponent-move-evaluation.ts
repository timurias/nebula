'use server';
/**
 * @fileOverview An AI opponent strategic move selection agent.
 *
 * - evaluateMove - A function that evaluates the move.
 * - EvaluateMoveInput - The input type for the evaluateMove function.
 * - EvaluateMoveOutput - The return type for the evaluateMove function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const EvaluateMoveInputSchema = z.object({
  boardState: z.string().describe('The current state of the game board.'),
  move: z.string().describe('The move to evaluate (e.g., A5, B2).'),
  opponentBoard: z.string().describe('Opponent board information for strategy.'),
});
export type EvaluateMoveInput = z.infer<typeof EvaluateMoveInputSchema>;

const EvaluateMoveOutputSchema = z.object({
  isHighValue: z.boolean().describe('Whether the move is a high-value move.'),
  reason: z.string().describe('The reasoning behind the evaluation.'),
});
export type EvaluateMoveOutput = z.infer<typeof EvaluateMoveOutputSchema>;

export async function evaluateMove(input: EvaluateMoveInput): Promise<EvaluateMoveOutput> {
  return evaluateMoveFlow(input);
}

const prompt = ai.definePrompt({
  name: 'evaluateMovePrompt',
  input: {schema: EvaluateMoveInputSchema},
  output: {schema: EvaluateMoveOutputSchema},
  prompt: `You are a strategic game expert evaluating moves in a battleship-like game.

You are provided with the current board state, the move to evaluate, and the opponent's board information.

Based on this information, determine if the move is a high-value move. A high-value move is one that is likely to result in a hit on an opponent's ship, or that targets a strategic location on the board.

Board State: {{{boardState}}}
Move to Evaluate: {{{move}}}
Opponent Board Information: {{{opponentBoard}}}

Respond with whether this move is a high value move or not, and why.
`,
});

const evaluateMoveFlow = ai.defineFlow(
  {
    name: 'evaluateMoveFlow',
    inputSchema: EvaluateMoveInputSchema,
    outputSchema: EvaluateMoveOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
