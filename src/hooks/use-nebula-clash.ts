
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
  aiMemory: {
    lastHit: null,
    huntDirection: null,
    potentialTargets: [],
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

function getShipCounts(boardSize: BoardSize): { type: CellType; count: number; total: number }[] {
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
  
  const getSmartMove = (board: Board, size: number, aiMemory: GameState['aiMemory']) => {
    let targets = [...aiMemory.potentialTargets];

    // If we have a hunt direction, prioritize that
    if (aiMemory.lastHit && aiMemory.huntDirection) {
        const {row, col} = aiMemory.lastHit;
        const directions = {
            up: {r: -1, c: 0},
            down: {r: 1, c: 0},
            left: {r: 0, c: -1},
            right: {r: 0, c: 1}
        };
        const dir = directions[aiMemory.huntDirection];
        const nextCell = {row: row + dir.r, col: col + dir.c};
        if(nextCell.row >= 0 && nextCell.row < size && nextCell.col >= 0 && nextCell.col < size && !board[nextCell.row][nextCell.col].isHit && !board[nextCell.row][nextCell.col].isMiss){
             targets.unshift(nextCell); // Prioritize this move
        }
    }
    
    // If no priority targets, use the list of potential targets
    while(targets.length > 0) {
        const move = targets.shift(); // Takes the highest priority
        if(move && !board[move.row][move.col].isHit && !board[move.row][move.col].isMiss) {
            return { move, updatedTargets: targets };
        }
    }
    
    // Fallback to random if no smart moves
    const allPossible : { row: number; col: number }[] = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!board[r][c].isHit && !board[r][c].isMiss) {
          allPossible.push({ row: r, col: c });
        }
      }
    }
    if (allPossible.length === 0) return { move: null, updatedTargets: [] };
    const move = allPossible[Math.floor(Math.random() * allPossible.length)];
    return { move, updatedTargets: [] };
  }


  const handleAIturn = useCallback(async () => {
    setGameState(prev => ({...prev, message: "AI is thinking..."}));

    const { settings, ai: aiState, player: playerState, aiMemory } = gameState;
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
    } else { // medium and hard logic
        const result = getSmartMove(board, boardSize, aiMemory);
        move = result.move;
        updatedTargets = result.updatedTargets;
    }

    if (settings.difficulty === 'hard' && move) {
        try {
            const boardStateStr = JSON.stringify(board.map(r => r.map(c => c.isHit ? 'H' : (c.isMiss ? 'M' : 'E'))));
            const moveStr = `${String.fromCharCode(65 + move.row)}${move.col + 1}`;
            const res = await evaluateMove({ boardState: boardStateStr, move: moveStr, opponentBoard: "N/A" });
            if (!res.isHighValue) {
                // If the model thinks it's a bad move, maybe try the next in the smart list or a random one
                const fallbackResult = getSmartMove(board, boardSize, {...aiMemory, potentialTargets: updatedTargets});
                move = fallbackResult.move;
                updatedTargets = fallbackResult.updatedTargets;
            }
        } catch (e) {
            console.error("AI evaluation failed, proceeding with smart move", e);
        }
    }

    if(move) {
      const finalMove = move;
      setGameState(prev => ({...prev, aiMemory: { ...prev.aiMemory, potentialTargets: updatedTargets }}));
      setTimeout(() => {
          handleAttack("ai", finalMove.row, finalMove.col);
      }, 1000);
    } else {
       setGameState(prev => ({...prev, turn: 'human', message: "AI has no moves left."}));
    }

  }, [gameState]);


  useEffect(() => {
    if (gameState.phase === "playing" && gameState.turn === "ai" && !gameState.winner) {
        const aiTurnTimeout = setTimeout(() => {
            handleAIturn();
        }, 1500);
        return () => clearTimeout(aiTurnTimeout);
    }
  }, [gameState.phase, gameState.turn, gameState.winner, handleAIturn]);

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
                          const newTargets: {row: number, col: number}[] = [];
                          const directions = [{r: -1, c: 0, d: 'up'}, {r: 1, c: 0, d: 'down'}, {r: 0, c: -1, d: 'left'}, {r: 0, c: 1, d: 'right'}];
                          
                          if(!current.aiMemory.lastHit || current.aiMemory.huntDirection) { // First hit of a new ship
                              newAiMemory.huntDirection = null; 
                              directions.forEach(dir => {
                                  const nextR = row + dir.r;
                                  const nextC = col + dir.c;
                                  if(nextR >= 0 && nextR < boardSize && nextC >= 0 && nextC < boardSize && !board[nextR][nextC].isHit && !board[nextR][nextC].isMiss) {
                                      newTargets.push({row: nextR, col: nextC});
                                  }
                              });
                          }
                          newAiMemory.lastHit = {row, col};
                          newAiMemory.potentialTargets = [...newTargets, ...current.aiMemory.potentialTargets.filter(t => t.row !== row || t.col !== col)];
                        }

                    } else {
                        cell.isMiss = true;
                        message = `${attacker === "human" ? "You" : "AI"} missed.`;
                        if(!isHumanAttack && newAiMemory.lastHit) {
                           // If AI was hunting, this miss might inform its next move.
                           newAiMemory.potentialTargets = newAiMemory.potentialTargets.filter(t => t.row !== row || t.col !== col)
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
            const newAiState = { ...prev.ai };
            placeAllShipsRandomly(newAiState, prev.settings.boardSize);
            
            toast({ title: "Fleet Deployed!", description: "Your ships are in position. Time to attack." });
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
