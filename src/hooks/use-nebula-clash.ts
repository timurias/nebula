
"use client";

import { useState, useEffect, useCallback } from "react";
import {
  GameState,
  GameSettings,
  Player,
  Board,
  CellType,
  BoardSize,
  PlayerState,
  SHIP_CELL_POINTS,
} from "@/types";
import { adjustAIDifficulty } from "@/ai/flows/ai-difficulty-adjustment";
import { evaluateMove } from "@/ai/flows/ai-opponent-move-evaluation";
import { useToast } from "@/hooks/use-toast";

const getPointsForBoardSize = (boardSize: BoardSize): number => {
    switch (boardSize) {
        case 5: return 20;
        case 10: return 50;
        case 15: return 100;
        default: return 50;
    }
}

const getInitialState = (): GameState => ({
  phase: "setup",
  settings: {
    boardSize: 10,
    difficulty: "medium",
    initialPoints: getPointsForBoardSize(10),
  },
  turn: "human",
  winner: undefined,
  message: "New game started. Select your settings.",
  selectedCellType: CellType.Simple,
  placingShips: false,
  player: createEmptyPlayerState(10),
  ai: createEmptyPlayerState(10),
  aiMemory: {
    lastHit: null,
    huntDirection: null,
    potentialTargets: [],
    searchAndDestroy: false,
    shipGrid: Array.from({ length: 10 }, () => Array(10).fill(null)),
  },
  lastAttack: null,
});

function createEmptyBoard(size: BoardSize): Board {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({
      isHit: false,
      isMiss: false,
    }))
  );
}

function createEmptyPlayerState(boardSize: BoardSize): PlayerState {
    const initialPoints = getPointsForBoardSize(boardSize);
    return {
        board: createEmptyBoard(boardSize),
        points: initialPoints,
        totalPoints: initialPoints,
        ships: [
            { type: CellType.Simple, count: 0 },
            { type: CellType.Weapon, count: 0 },
            { type: CellType.Ammo, count: 0 },
            { type: CellType.Medical, count: 0 },
        ],
    };
}


export const useNebulaClash = () => {
  const [gameState, setGameState] = useState<GameState>(getInitialState);
  const { toast } = useToast();
  const [isPlacingRandomly, setIsPlacingRandomly] = useState(false);

  useEffect(() => {
    try {
      const savedState = localStorage.getItem("nebulaClashState");
      if (savedState) {
        const parsedState = JSON.parse(savedState);
        if(parsedState.phase && parsedState.settings) {
            setGameState(parsedState);
        } else {
            localStorage.removeItem("nebulaClashState");
        }
      }
    } catch (error) {
      console.error("Failed to load game state from localStorage", error);
      localStorage.removeItem("nebulaClashState");
    }
  }, []);

  useEffect(() => {
    if (gameState.phase !== "setup") {
        try {
            localStorage.setItem("nebulaClashState", JSON.stringify(gameState));
        } catch (error) {
            console.error("Failed to save game state to localStorage", error);
        }
    }
  }, [gameState]);

  useEffect(() => {
    if (gameState.lastAttack) {
      const { attacker, row, col, result } = gameState.lastAttack;
      if (result === 'hit') {
        toast({
          title: "HIT!",
          description: `${attacker === 'human' ? 'You' : 'AI'} landed a hit at ${String.fromCharCode(65 + row)}${col + 1}.`,
          className: "bg-accent border-accent text-accent-foreground"
        });
      }
    }
  }, [gameState.lastAttack, toast]);


  const startGame = useCallback(async (settings: Omit<GameSettings, 'initialPoints'>) => {
    const initialPoints = getPointsForBoardSize(settings.boardSize);
    const fullSettings = { ...settings, initialPoints };

    toast({ title: "Starting New Game", description: `Board: ${settings.boardSize}x${settings.boardSize}, AI: ${settings.difficulty}` });

    try {
      await adjustAIDifficulty({ difficulty: settings.difficulty });
      toast({ title: "AI Calibrated", description: `Opponent difficulty set to ${settings.difficulty}.` });
    } catch (e) {
      console.error("Failed to adjust AI difficulty", e);
      toast({ title: "AI Error", description: "Could not set AI difficulty. Using default.", variant: "destructive"});
    }


    const playerState = createEmptyPlayerState(settings.boardSize);
    const aiState = createEmptyPlayerState(settings.boardSize);

    setGameState({
      ...getInitialState(),
      phase: "placing",
      placingShips: true,
      settings: fullSettings,
      player: playerState,
      ai: aiState,
      message: "Place your ship cells.",
      selectedCellType: CellType.Simple,
      aiMemory: {
        ...getInitialState().aiMemory,
        shipGrid: Array.from({ length: settings.boardSize }, () => Array(settings.boardSize).fill(null)),
      }
    });
  }, [toast]);

  const resetGame = useCallback(() => {
    localStorage.removeItem("nebulaClashState");
    setGameState(getInitialState());
  }, []);

  const selectCellType = useCallback((cellType: CellType) => {
    setGameState((prev) => {
        const cost = SHIP_CELL_POINTS[cellType];
        if (prev.player.points >= cost) {
            return { ...prev, selectedCellType: cellType };
        } else {
            toast({ title: "Not enough points", description: `You need ${cost} points to place a ${cellType} part.`, variant: "destructive" });
        }
        return prev;
    });
  }, [toast]);

  const getSmartMove = (board: Board, size: number, aiMemory: GameState['aiMemory']) => {
    let targets = [...aiMemory.potentialTargets];

    // Search and Destroy logic
    if (aiMemory.searchAndDestroy && aiMemory.lastHit) {
        const {row, col} = aiMemory.lastHit;
        const directions = [
            {r: -1, c: 0, d: 'up'}, {r: 1, c: 0, d: 'down'},
            {r: 0, c: -1, d: 'left'}, {r: 0, c: 1, d: 'right'}
        ];

        // If hunting, prioritize continuing in that direction
        if(aiMemory.huntDirection) {
            const dir = directions.find(d => d.d === aiMemory.huntDirection)!;
            let nextR = row + dir.r;
            let nextC = col + dir.c;
            while(nextR >= 0 && nextR < size && nextC >= 0 && nextC < size) {
                if(!board[nextR][nextC].isHit && !board[nextR][nextC].isMiss) {
                    return { move: {row: nextR, col: nextC}, updatedTargets: targets };
                }
                if(board[nextR][nextC].isMiss) break; // Blocked
                nextR += dir.r;
                nextC += dir.c;
            }
        }
        // If not hunting or hunt direction blocked, add adjacent cells to potential targets
        for (const dir of directions) {
            const nextR = row + dir.r;
            const nextC = col + dir.c;
            if (nextR >= 0 && nextR < size && nextC >= 0 && nextC < size && !board[nextR][nextC].isHit && !board[nextR][nextC].isMiss) {
                targets.unshift({row: nextR, col: nextC}); // Add to front for priority
            }
        }
    }


    // Try potential targets first
    while(targets.length > 0) {
        const move = targets.shift(); // Takes the highest priority
        if(move && !board[move.row][move.col].isHit && !board[move.row][move.col].isMiss) {
            return { move, updatedTargets: targets };
        }
    }

    // Fallback to checkerboard pattern hunt
    const allPossible : { row: number; col: number }[] = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if ((r + c) % 2 === 0 && !board[r][c].isHit && !board[r][c].isMiss) {
          allPossible.push({ row: r, col: c });
        }
      }
    }

    if (allPossible.length > 0) {
      const move = allPossible[Math.floor(Math.random() * allPossible.length)];
      return { move, updatedTargets: [] };
    }

    // If checkerboard is full, check remaining cells
    const remainingPossible : { row: number; col: number }[] = [];
     for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!board[r][c].isHit && !board[r][c].isMiss) {
          remainingPossible.push({ row: r, col: c });
        }
      }
    }
    if (remainingPossible.length > 0) {
        const move = remainingPossible[Math.floor(Math.random() * remainingPossible.length)];
        return { move, updatedTargets: [] };
    }


    return { move: null, updatedTargets: [] };
  }


  const handleAIturn = useCallback(async () => {
    setGameState(prev => ({...prev, message: "AI is thinking..."}));

    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate thinking

    setGameState(prev => {
        const { settings, player: playerState, aiMemory } = prev;
        const {board, boardSize} = {board: playerState.board, boardSize: settings.boardSize};

        let move: { row: number; col: number } | null = null;
        let updatedTargets = aiMemory.potentialTargets;

        if (settings.difficulty === 'easy') {
            const allPossible : { row: number; col: number }[] = [];
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    if (!board[r][c].isHit && !board[r][c].isMiss) {
                        allPossible.push({ row: r, col: c });
                    }
                }
            }
            if (allPossible.length > 0) {
                 move = allPossible[Math.floor(Math.random() * allPossible.length)];
            }
        } else { // medium and hard logic use smart moves
            const result = getSmartMove(board, boardSize, aiMemory);
            move = result.move;
            updatedTargets = result.updatedTargets;
        }

        if(move) {
          const finalMove = move;
          setTimeout(() => {
              handleAttack("ai", finalMove.row, finalMove.col);
          }, 1000);
          return {...prev, aiMemory: { ...prev.aiMemory, potentialTargets: updatedTargets }};
        } else {
           return {...prev, turn: 'human', message: "AI has no moves left."};
        }
    });

  }, [ ]);


  useEffect(() => {
    if (gameState.phase === "playing" && gameState.turn === "ai" && !gameState.winner) {
        const aiTurnTimeout = setTimeout(() => {
            handleAIturn();
        }, 1500);
        return () => clearTimeout(aiTurnTimeout);
    }
  }, [gameState.phase, gameState.turn, gameState.winner, handleAIturn]);

  const checkWinner = (playerBoard: Board, aiBoard: Board): Player | undefined => {
    const allPlayerShipsDestroyed = playerBoard.flat().filter(c => c.ship).every(c => c.isHit);
    if(allPlayerShipsDestroyed) return "ai";

    const allAiShipsDestroyed = aiBoard.flat().filter(c => c.ship).every(c => c.isHit);
    if(allAiShipsDestroyed) return "human";

    return undefined;
  }

  const handleAttack = useCallback((attacker: Player, row: number, col: number) => {
      setGameState(prev => {
          const isHumanAttack = attacker === 'human';
          const targetPlayerKey = isHumanAttack ? 'ai' : 'player';
          const targetState = prev[targetPlayerKey];

          if (!targetState) return prev;

          const newBoard = JSON.parse(JSON.stringify(targetState.board));
          const cell = newBoard[row][col];

          if(cell.isHit || cell.isMiss) {
              if(isHumanAttack) toast({ title: "Wasted Shot!", description: "You've already fired at this location.", variant: "destructive"});
              return prev;
          }

          const animationType = cell.ship ? "hit" : "miss";
          newBoard[row][col] = {...cell, animation: animationType };

          const updatedState = { ...prev };
          updatedState[targetPlayerKey] = { ...targetState, board: newBoard };

          setTimeout(() => {
              setGameState(current => {
                    let newAiMemory = {...current.aiMemory};
                    const currentTargetState = current[targetPlayerKey];
                    const board = JSON.parse(JSON.stringify(currentTargetState.board));
                    const cell = board[row][col];
                    const boardSize = current.settings.boardSize;

                    delete cell.animation;
                    let message = "";
                    let attackResult: 'hit' | 'miss' = 'miss';

                    if (cell.ship) {
                        cell.isHit = true;
                        attackResult = 'hit';
                        message = `${attacker === "human" ? "You" : "AI"} scored a HIT!`;

                        if(!isHumanAttack) { // AI's turn
                           newAiMemory.lastHit = {row, col};
                           newAiMemory.searchAndDestroy = true; // Enter search and destroy mode
                           // Clear potential targets to refocus around the new hit
                           newAiMemory.potentialTargets = [];
                        }

                    } else {
                        cell.isMiss = true;
                        message = `${attacker === "human" ? "You" : "AI"} missed.`;
                        if(!isHumanAttack && newAiMemory.lastHit) {
                           // If AI was hunting, this miss might mean the end of a ship
                           const {row: lastR, col: lastC} = newAiMemory.lastHit;
                           const lastCell = board[lastR][lastC];
                           if(lastCell.isHit){ // if the last hit cell is now surrounded by misses or edges, ship is sunk
                                // This logic is complex, for now, just reset hunt direction
                                newAiMemory.huntDirection = null;
                           }
                        }
                    }

                    const winner = checkWinner(
                        isHumanAttack ? current.player.board : board,
                        isHumanAttack ? board : current.ai.board
                    );

                    if (winner) {
                        return {
                            ...current,
                            [targetPlayerKey]: { ...currentTargetState, board },
                            phase: "over",
                            winner,
                            message: winner === 'human' ? "Congratulations, you won!" : "The AI has defeated you.",
                            lastAttack: { attacker, row, col, result: attackResult }
                        };
                    }

                    return {
                        ...current,
                        [targetPlayerKey]: { ...currentTargetState, board },
                        turn: isHumanAttack ? 'ai' : 'human',
                        message,
                        aiMemory: newAiMemory,
                        lastAttack: { attacker, row, col, result: attackResult }
                    };
                });
          }, 750);

          return updatedState;
      });
  }, [toast]);


  const placeShipCell = useCallback((row: number, col: number) => {
    setGameState(prev => {
        if (!prev.placingShips || !prev.selectedCellType) return prev;

        const shipType = prev.selectedCellType;
        const cost = SHIP_CELL_POINTS[shipType];
        if (prev.player.points < cost) {
            toast({ title: "Not enough points!", description: `You need ${cost} points for this part.`, variant: "destructive" });
            return prev;
        }


        const newBoard = JSON.parse(JSON.stringify(prev.player.board));
        if (newBoard[row][col].ship) {
            toast({ title: "Cell Occupied", description: "You've already placed a part here.", variant: "destructive" });
            return prev;
        }

        newBoard[row][col].ship = { type: shipType, health: 1 };
        const newPoints = prev.player.points - cost;
        const newShips = prev.player.ships.map(s => s.type === shipType ? { ...s, count: s.count + 1 } : s);

        return { ...prev, player: { ...prev.player, board: newBoard, points: newPoints, ships: newShips } };
    });
  }, [toast]);

  const finishPlacing = useCallback(() => {
    toast({ title: "Fleet Deployed!", description: "Your ships are in position. Time to attack." });
    setGameState(prev => {
        const newAiState = { ...prev.ai };
        placeAllShipsRandomly(newAiState, prev.settings.boardSize);
        return {
            ...prev,
            phase: "playing",
            placingShips: false,
            ai: newAiState,
            message: "All ships placed! Your turn to attack.",
            selectedCellType: null,
            turn: 'human',
        };
    });
  }, [toast]);


  const placeAllShipsRandomly = (playerState: PlayerState, boardSize: BoardSize) => {
    playerState.board = createEmptyBoard(boardSize);
    playerState.points = getPointsForBoardSize(boardSize);
    playerState.ships.forEach(s => s.count = 0);

    const cellTypes = Object.values(CellType);

    while (playerState.points > 0) {
        const shipType = cellTypes[Math.floor(Math.random() * cellTypes.length)];
        const cost = SHIP_CELL_POINTS[shipType];

        if (playerState.points >= cost) {
            let placed = false;
            let attempts = 0;
            while(!placed && attempts < boardSize * boardSize) {
                const row = Math.floor(Math.random() * boardSize);
                const col = Math.floor(Math.random() * boardSize);
                if (!playerState.board[row][col].ship) {
                    playerState.board[row][col].ship = { type: shipType, health: 1 };
                    playerState.points -= cost;
                    const shipIndex = playerState.ships.findIndex(s => s.type === shipType);
                    playerState.ships[shipIndex].count++;
                    placed = true;
                }
                attempts++;
            }
            if(attempts >= boardSize * boardSize) break; // No space left
        } else {
            // Try to fit smaller ships if possible
            const affordableTypes = cellTypes.filter(t => SHIP_CELL_POINTS[t] <= playerState.points);
            if (affordableTypes.length === 0) {
                break; // No affordable ships left
            }
        }
    }
  }

  const placeShipsRandomly = useCallback(() => {
    setIsPlacingRandomly(true);
    setTimeout(() => {
        setGameState(prev => {
            const newPlayerState = { ...prev.player };
            placeAllShipsRandomly(newPlayerState, prev.settings.boardSize);

            const newAiState = { ...prev.ai };
            placeAllShipsRandomly(newAiState, prev.settings.boardSize);

            setIsPlacingRandomly(false);
            toast({ title: "Fleets Deployed!", description: "Your random fleet is ready. Good luck." });
            return {
                ...prev,
                phase: "playing",
                placingShips: false,
                player: newPlayerState,
                ai: newAiState,
                message: "Random fleets deployed! Your turn.",
                selectedCellType: null,
                turn: 'human',
            };
        });
    }, 500);
  }, [toast]);

  const handleCellClick = useCallback((row: number, col: number) => {
    const { phase, turn, placingShips } = gameState;

    if (placingShips) {
      placeShipCell(row, col);
    } else if (phase === 'playing' && turn === 'human') {
      handleAttack('human', row, col);
    }
  }, [gameState, placeShipCell, handleAttack]);

  return { gameState, startGame, selectCellType, handleCellClick, resetGame, placeShipsRandomly, isPlacingRandomly, finishPlacing };
};
