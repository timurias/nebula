"use client";

import { useState, useEffect, useCallback } from "react";
import {
  type GameState,
  type GameSettings,
  type Player,
  type Board,
  type CellState,
  CellType,
  type BoardSize,
  type PlayerState,
} from "@/types";
import { adjustAIDifficulty } from "@/ai/flows/ai-difficulty-adjustment";
import { evaluateMove } from "@/ai/flows/ai-opponent-move-evaluation";
import { useToast } from "@/hooks/use-toast";

const getInitialState = (): GameState => ({
  phase: "setup",
  settings: {
    boardSize: 10,
    difficulty: "medium",
  },
  turn: "human",
  winner: undefined,
  message: "New game started. Select your settings.",
  selectedCellType: CellType.Simple,
  placingShips: false,
  player: createEmptyPlayerState(10),
  ai: createEmptyPlayerState(10),
});

function createEmptyBoard(size: BoardSize): Board {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({
      isHit: false,
      isMiss: false,
    }))
  );
}

function getShipCounts(boardSize: BoardSize): { type: CellType, count: number, total: number }[] {
    const totalCells = { 5: 5, 10: 15, 15: 30 }[boardSize];
    const counts = {
        5: { weapon: 1, ammo: 1, medical: 1, simple: 2},
        10: { weapon: 2, ammo: 3, medical: 2, simple: 8},
        15: { weapon: 4, ammo: 6, medical: 4, simple: 16},
    }[boardSize];

    return [
        { type: CellType.Simple, count: counts.simple, total: counts.simple },
        { type: CellType.Weapon, count: counts.weapon, total: counts.weapon },
        { type: CellType.Ammo, count: counts.ammo, total: counts.ammo },
        { type: CellType.Medical, count: counts.medical, total: counts.medical },
    ];
}


function createEmptyPlayerState(boardSize: BoardSize): PlayerState {
    return {
        board: createEmptyBoard(boardSize),
        ships: getShipCounts(boardSize),
        ammo: 0,
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
        // Basic validation
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


  const startGame = useCallback(async (settings: GameSettings) => {
    toast({ title: "Starting New Game", description: `Board: ${settings.boardSize}x${settings.boardSize}, AI: ${settings.difficulty}` });
    
    await adjustAIDifficulty({ difficulty: settings.difficulty });
    toast({ title: "AI Calibrated", description: `Opponent difficulty set to ${settings.difficulty}.` });

    const playerState = createEmptyPlayerState(settings.boardSize);
    const aiState = createEmptyPlayerState(settings.boardSize);

    setGameState({
      ...getInitialState(),
      phase: "placing",
      placingShips: true,
      settings,
      player: playerState,
      ai: aiState,
      message: "Place your ship cells.",
      selectedCellType: CellType.Simple,
    });
  }, [toast]);

  const resetGame = useCallback(() => {
    localStorage.removeItem("nebulaClashState");
    setGameState(getInitialState());
  }, []);

  const selectCellType = useCallback((cellType: CellType) => {
    setGameState((prev) => {
        const ship = prev.player.ships.find(s => s.type === cellType);
        if (ship && ship.count > 0) {
            return { ...prev, selectedCellType: cellType };
        }
        return prev;
    });
  }, []);

  const handleAIturn = useCallback(async () => {
    setGameState(prev => ({...prev, message: "AI is thinking..."}));

    const { settings, ai: aiState, player: playerState } = gameState;
    const possibleMoves: { row: number; col: number }[] = [];
    for (let r = 0; r < settings.boardSize; r++) {
      for (let c = 0; c < settings.boardSize; c++) {
        if (!playerState.board[r][c].isHit && !playerState.board[r][c].isMiss) {
          possibleMoves.push({ row: r, col: c });
        }
      }
    }

    if (possibleMoves.length === 0) return;

    let move: { row: number; col: number };

    if (settings.difficulty === 'easy') {
        move = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
    } else {
        // Medium/Hard logic
        const candidates = possibleMoves.sort(() => 0.5 - Math.random()).slice(0, 5);
        const evaluations = await Promise.all(candidates.map(async m => {
            const boardState = JSON.stringify(playerState.board.map(r => r.map(c => c.ship ? 'S' : 'E')));
            const moveStr = `${String.fromCharCode(65 + m.row)}${m.col + 1}`;
            try {
                const res = await evaluateMove({ boardState, move: moveStr, opponentBoard: "N/A"});
                return { move: m, isHighValue: res.isHighValue };
            } catch (e) {
                console.error("AI evaluation failed", e);
                return { move: m, isHighValue: false }; // fallback
            }
        }));

        const highValueMoves = evaluations.filter(e => e.isHighValue);
        if (highValueMoves.length > 0) {
            move = highValueMoves[Math.floor(Math.random() * highValueMoves.length)].move;
        } else {
            move = candidates[0];
        }

        if (settings.difficulty === 'hard' && highValueMoves.length > 0) {
            // Always pick best option if hard
            move = highValueMoves[0].move;
        }
    }

    setTimeout(() => {
        handleAttack("ai", move.row, move.col);
    }, 1000);

  }, [gameState]);


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
          const targetPlayer = attacker === 'human' ? 'ai' : 'human';
          const targetState = prev[targetPlayer];
          const newBoard = JSON.parse(JSON.stringify(targetState.board));
          const cell = newBoard[row][col];
          
          let message = "";
          let newGameState: Partial<GameState> = {};
          
          if(cell.isHit || cell.isMiss) {
              if(attacker === 'human') toast({ title: "Wasted Shot!", description: "You've already fired at this location.", variant: "destructive"});
              return prev; // Invalid move
          }
          
          const animationType = cell.ship ? "hit" : "miss";
          newBoard[row][col] = {...cell, animation: animationType };

          const updatedState = { ...prev };
          if(targetPlayer === 'ai') updatedState.ai.board = newBoard; else updatedState.player.board = newBoard;
          
          setGameState(updatedState);

          setTimeout(() => {
              setGameState(current => {
                    const targetState = current[targetPlayer];
                    const board = JSON.parse(JSON.stringify(targetState.board));
                    const cell = board[row][col];
                    delete cell.animation;

                    if (cell.ship) {
                        cell.isHit = true;
                        message = `${attacker === "human" ? "You" : "AI"} scored a HIT!`;
                        toast({ title: "HIT!", description: `Direct impact at ${String.fromCharCode(65 + row)}${col + 1}.`, className: "bg-accent border-accent text-accent-foreground" });
                    } else {
                        cell.isMiss = true;
                        message = `${attacker === "human" ? "You" : "AI"} missed.`;
                    }

                    const winner = checkWinner(targetPlayer === 'human' ? board : current.player.board, targetPlayer === 'ai' ? board : current.ai.board);
                    
                    if (winner) {
                        return {
                            ...current,
                            [targetPlayer]: { ...targetState, board },
                            phase: "over",
                            winner,
                            message: winner === 'human' ? "Congratulations, you won!" : "The AI has defeated you.",
                        };
                    }

                    return {
                        ...current,
                        [targetPlayer]: { ...targetState, board },
                        turn: targetPlayer,
                        message,
                    };
                });
          }, 750);

          return prev;
      });
  }, [toast]);


  const placeShipCell = useCallback((row: number, col: number) => {
    setGameState(prev => {
        if (!prev.placingShips || !prev.selectedCellType) return prev;

        const newBoard = JSON.parse(JSON.stringify(prev.player.board));
        if (newBoard[row][col].ship) {
            toast({ title: "Cell Occupied", description: "You've already placed a part here.", variant: "destructive" });
            return prev;
        }
        
        const shipType = prev.selectedCellType;
        const ships = prev.player.ships.find(s => s.type === shipType);

        if (!ships || ships.count <= 0) {
            toast({ title: "No parts left", description: `You have no more ${shipType} parts.`, variant: "destructive" });
            return prev;
        }

        newBoard[row][col].ship = { type: shipType, health: 1 };
        const newShips = prev.player.ships.map(s => s.type === shipType ? { ...s, count: s.count - 1 } : s);
        
        const isDonePlacing = newShips.every(s => s.count === 0);
        let nextSelected = prev.selectedCellType;
        if(newShips.find(s => s.type === nextSelected)?.count === 0){
            nextSelected = newShips.find(s => s.count > 0)?.type || null;
        }

        if (isDonePlacing) {
            // AI places its ships randomly
            const newAiState = { ...prev.ai };
            placeAllShipsRandomly(newAiState, prev.settings.boardSize);
            
            return {
                ...prev,
                phase: "playing",
                placingShips: false,
                player: { ...prev.player, board: newBoard, ships: newShips },
                ai: newAiState,
                message: "All ships placed! Your turn to attack.",
                selectedCellType: null,
                turn: 'human',
            };
        }

        return { ...prev, player: { ...prev.player, board: newBoard, ships: newShips }, selectedCellType: nextSelected };
    });
  }, [toast]);

  const placeShipsRandomly = useCallback(() => {
    setIsPlacingRandomly(true);
    setTimeout(() => {
        setGameState(prev => {
            const newPlayerState = { ...prev.player };
            placeAllShipsRandomly(newPlayerState, prev.settings.boardSize);

            const newAiState = { ...prev.ai };
            placeAllShipsRandomly(newAiState, prev.settings.boardSize);

            setIsPlacingRandomly(false);
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
  }, []);

  const placeAllShipsRandomly = (playerState: PlayerState, boardSize: BoardSize) => {
    playerState.board = createEmptyBoard(boardSize);
    const shipsToPlace = playerState.ships.flatMap(s => Array(s.total).fill(s.type));
    
    for(const shipType of shipsToPlace) {
        let placed = false;
        while(!placed) {
            const row = Math.floor(Math.random() * boardSize);
            const col = Math.floor(Math.random() * boardSize);
            if (!playerState.board[row][col].ship) {
                playerState.board[row][col].ship = { type: shipType, health: 1 };
                placed = true;
            }
        }
    }
    playerState.ships.forEach(s => s.count = 0);
  }

  const handleCellClick = useCallback((row: number, col: number) => {
    const { phase, turn, placingShips } = gameState;

    if (placingShips) {
      placeShipCell(row, col);
    } else if (phase === 'playing' && turn === 'human') {
      handleAttack('human', row, col);
    }
  }, [gameState, placeShipCell, handleAttack]);

  return { gameState, startGame, selectCellType, handleCellClick, resetGame, placeShipsRandomly, isPlacingRandomly };
};
