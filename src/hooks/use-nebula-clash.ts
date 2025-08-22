
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
  CellState,
  IdentifiedShip,
} from "@/types";
import { adjustAIDifficulty } from "@/ai/flows/ai-difficulty-adjustment";
import { useToast } from "@/hooks/use-toast";
import { evaluateMove } from "@/ai/flows/ai-opponent-move-evaluation";

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
  attacksRemaining: 0,
  turnNumber: 0,
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
        attacks: 0,
        identifiedShips: [],
    };
}

const identifyShips = (board: Board): IdentifiedShip[] => {
    const ships: IdentifiedShip[] = [];
    const visited: boolean[][] = Array(board.length).fill(0).map(() => Array(board.length).fill(false));
    const size = board.length;

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (board[r][c].ship && !visited[r][c]) {
                const newShip: IdentifiedShip = {
                    id: ships.length + 1,
                    cells: [],
                    isSunk: false,
                    weaponCount: 0,
                    ammoCount: 0,
                    medicalCount: 0
                };
                const queue: { row: number, col: number }[] = [{ row: r, col: c }];
                visited[r][c] = true;

                while (queue.length > 0) {
                    const current = queue.shift()!;
                    newShip.cells.push(current);
                    const cell = board[current.row][current.col];

                    if(cell.ship) {
                        if (cell.ship.type === CellType.Weapon) newShip.weaponCount++;
                        if (cell.ship.type === CellType.Ammo) newShip.ammoCount++;
                        if (cell.ship.type === CellType.Medical) newShip.medicalCount++;
                    }


                    const neighbors = [
                        { row: current.row - 1, col: current.col }, { row: current.row + 1, col: current.col },
                        { row: current.row, col: current.col - 1 }, { row: current.row, col: current.col + 1 }
                    ];

                    for (const neighbor of neighbors) {
                        if (
                            neighbor.row >= 0 && neighbor.row < size &&
                            neighbor.col >= 0 && neighbor.col < size &&
                            board[neighbor.row][neighbor.col].ship &&
                            !visited[neighbor.row][neighbor.col]
                        ) {
                            visited[neighbor.row][neighbor.col] = true;
                            queue.push(neighbor);
                        }
                    }
                }
                newShip.isSunk = newShip.cells.every(({row, col}) => board[row][col].isHit);
                ships.push(newShip);
            }
        }
    }
    return ships;
};


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

  const getSmartMove = useCallback(async (board: Board, size: number, aiMemory: GameState['aiMemory'], difficulty: Difficulty) => {
    let targets = [...aiMemory.potentialTargets];

    if (aiMemory.searchAndDestroy && aiMemory.lastHit) {
      const { row, col } = aiMemory.lastHit;
      const directions = [
        { r: -1, c: 0, d: 'up' }, { r: 1, c: 0, d: 'down' },
        { r: 0, c: -1, d: 'left' }, { r: 0, c: 1, d: 'right' }
      ];

      if (aiMemory.huntDirection) {
        const dir = directions.find(d => d.d === aiMemory.huntDirection)!;
        let nextR = row + dir.r;
        let nextC = col + dir.c;
        while (nextR >= 0 && nextR < size && nextC >= 0 && nextC < size) {
          if (!board[nextR][nextC].isHit && !board[nextR][nextC].isMiss) {
            return { move: { row: nextR, col: nextC }, updatedTargets: targets };
          }
          if (board[nextR][nextC].isMiss) break;
          nextR += dir.r;
          nextC += dir.c;
        }
      }
      for (const dir of directions) {
        const nextR = row + dir.r;
        const nextC = col + dir.c;
        if (nextR >= 0 && nextR < size && nextC >= 0 && nextC < size && !board[nextR][nextC].isHit && !board[nextR][nextC].isMiss) {
          targets.unshift({ row: nextR, col: nextC });
        }
      }
    }

    while (targets.length > 0) {
      const move = targets.shift();
      if (move && !board[move.row][move.col].isHit && !board[move.row][move.col].isMiss) {
        return { move, updatedTargets: targets };
      }
    }

    const allPossible: { row: number; col: number }[] = [];
    const checkerboardPossible: { row: number; col: number }[] = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!board[r][c].isHit && !board[r][c].isMiss) {
          allPossible.push({ row: r, col: c });
          if ((r + c) % 2 === 0) {
            checkerboardPossible.push({ row: r, col: c });
          }
        }
      }
    }

    if (difficulty === 'hard' && allPossible.length > 0) {
        const move = allPossible[Math.floor(Math.random() * allPossible.length)];
        try {
            const evaluation = await evaluateMove({
                boardState: JSON.stringify(board),
                move: `${String.fromCharCode(65 + move.row)}${move.col + 1}`,
                opponentBoard: "Unknown"
            });
            if(evaluation.isHighValue){
                return { move, updatedTargets: [] };
            }
        } catch (e) {
            console.error("AI move evaluation failed, falling back to random.", e);
        }
    }
    
    if (difficulty !== 'easy' && checkerboardPossible.length > 0) {
        const move = checkerboardPossible[Math.floor(Math.random() * checkerboardPossible.length)];
        return { move, updatedTargets: [] };
    }

    if (allPossible.length > 0) {
      const move = allPossible[Math.floor(Math.random() * allPossible.length)];
      return { move, updatedTargets: [] };
    }

    return { move: null, updatedTargets: [] };
  }, []);

  const checkWinner = (playerState: PlayerState, aiState: PlayerState): Player | undefined => {
    const playerShips = identifyShips(playerState.board);
    const aiShips = identifyShips(aiState.board);
    if (playerShips.every(s => s.isSunk)) return "ai";
    if (aiShips.every(s => s.isSunk)) return "human";
    return undefined;
  }

  const calculateAttacks = (ships: IdentifiedShip[]) => {
      return ships.reduce((total, ship) => {
          if(ship.isSunk) return total;
          return total + Math.min(ship.weaponCount, ship.ammoCount);
      }, 0);
  }

  const endTurn = useCallback(() => {
    setGameState(prev => {
        if (prev.turn === 'ai') { // AI's turn is ending
            let newPlayerBoard = JSON.parse(JSON.stringify(prev.player.board));
            const newPlayerShips = identifyShips(newPlayerBoard);

            if (prev.turnNumber > 0 && prev.turnNumber % 3 === 0) {
                newPlayerShips.forEach(ship => {
                    if(ship.isSunk || ship.medicalCount === 0) return;

                    let repairsMade = 0;
                    const damagedCells = ship.cells
                      .map(c => ({...c, cell: newPlayerBoard[c.row][c.col]}))
                      .filter(c => c.cell.isHit);
                    
                    for (const cellToRepair of damagedCells) {
                        if (repairsMade >= ship.medicalCount) break;
                        newPlayerBoard[cellToRepair.row][cellToRepair.col].isHit = false;
                        newPlayerBoard[cellToRepair.row][cellToRepair.col].repairTurnsLeft = 0; 
                        repairsMade++;
                    }
                });
            } else {
                newPlayerBoard.flat().forEach(cell => {
                    if (cell.repairTurnsLeft && cell.repairTurnsLeft > 0) {
                        cell.repairTurnsLeft--;
                    }
                });
            }

            const newPlayerState = {
                ...prev.player,
                board: newPlayerBoard,
                identifiedShips: identifyShips(newPlayerBoard),
                attacks: calculateAttacks(identifyShips(newPlayerBoard))
            }

            return {
                ...prev,
                turn: 'human',
                message: "Your turn.",
                attacksRemaining: newPlayerState.attacks,
                player: newPlayerState,
            }
        } else { // Player's turn is ending
            return {
                ...prev,
                turn: 'ai',
                message: "Enemy's turn.",
                turnNumber: prev.turnNumber + 1,
            }
        }
    });
  }, []);

  const handleAttack = useCallback((attacker: Player, row: number, col: number) => {
      setGameState(prev => {
          const isHumanAttack = attacker === 'human';
          
          if(isHumanAttack && prev.attacksRemaining <= 0) {
              if (prev.phase === 'playing') {
                toast({title: "Out of attacks", description: "You have no attacks left for this turn.", variant: "destructive"});
              }
              return prev;
          }

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

          let updatedState = { ...prev };
          updatedState[targetPlayerKey] = { ...targetState, board: newBoard };
           if(isHumanAttack) {
              updatedState.attacksRemaining = prev.attacksRemaining -1;
          }


          setTimeout(() => {
              setGameState(current => {
                    let newAiMemory = {...current.aiMemory};
                    const currentTargetState = current[targetPlayerKey];
                    const board = JSON.parse(JSON.stringify(currentTargetState.board));
                    const cell = board[row][col];

                    delete cell.animation;
                    let message = "";
                    let attackResult: 'hit' | 'miss' = 'miss';

                    if (cell.ship) {
                        cell.isHit = true;
                        attackResult = 'hit';
                        message = `${attacker === "human" ? "You" : "AI"} scored a HIT!`;

                        if(!isHumanAttack) {
                           newAiMemory.lastHit = {row, col};
                           newAiMemory.searchAndDestroy = true; 
                           newAiMemory.potentialTargets = [];
                        }

                    } else {
                        cell.isMiss = true;
                        message = `${attacker === "human" ? "You" : "AI"} missed.`;
                        if(!isHumanAttack && newAiMemory.lastHit) {
                           const {row: lastR, col: lastC} = newAiMemory.lastHit;
                           if (board[lastR][lastC]) {
                             const lastCell = board[lastR][lastC];
                             if(lastCell.isHit){
                                 newAiMemory.huntDirection = null;
                             }
                           }
                        }
                    }

                    const newTargetShips = identifyShips(board);
                    const newTargetState = {...currentTargetState, board: board, identifiedShips: newTargetShips, attacks: calculateAttacks(newTargetShips)};
                    
                    const winner = checkWinner(
                        isHumanAttack ? current.player : newTargetState,
                        isHumanAttack ? newTargetState : current.ai
                    );

                    if (winner) {
                        return {
                            ...current,
                            [targetPlayerKey]: newTargetState,
                            phase: "over",
                            winner,
                            message: winner === 'human' ? "Congratulations, you won!" : "The AI has defeated you.",
                            lastAttack: { attacker, row, col, result: attackResult }
                        };
                    }

                    if(isHumanAttack && current.attacksRemaining - 1 <= 0) {
                        endTurn();
                    }


                    return {
                        ...current,
                        [targetPlayerKey]: newTargetState,
                        message,
                        aiMemory: newAiMemory,
                        lastAttack: { attacker, row, col, result: attackResult }
                    };
                });
          }, 750);

          return updatedState;
      });
  }, [toast, endTurn]);

  const handleAIturn = useCallback(async () => {
    setGameState(prev => ({...prev, message: "AI is thinking..."}));

    await new Promise(resolve => setTimeout(resolve, 500)); 

    let attacksMade = 0;
    while(attacksMade < gameState.ai.attacks) {
        let continueAttack = true;
        await new Promise<void>(resolve => {
            setGameState(prev => {
                const { settings, player: playerState, aiMemory } = prev;
                const {board, boardSize} = {board: playerState.board, boardSize: settings.boardSize};

                getSmartMove(board, boardSize, aiMemory, settings.difficulty).then(result => {
                    const { move } = result;
                     if(move) {
                        handleAttack("ai", move.row, move.col);
                    } else {
                        continueAttack = false;
                    }
                });

                return prev;
            });
            attacksMade++;
            if(!continueAttack) attacksMade = gameState.ai.attacks;
            setTimeout(() => resolve(), 1000);
        });
    }

     endTurn();

  }, [gameState.ai.attacks, getSmartMove, handleAttack, endTurn]);

  useEffect(() => {
    if (gameState.phase === "playing" && gameState.turn === "ai" && !gameState.winner) {
        const aiTurnTimeout = setTimeout(() => {
            handleAIturn();
        }, 1500);
        return () => clearTimeout(aiTurnTimeout);
    }
  }, [gameState.phase, gameState.turn, gameState.winner, handleAIturn]);

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
        const identifiedShips = identifyShips(newBoard);
        const attacks = calculateAttacks(identifiedShips);

        return { ...prev, player: { ...prev.player, board: newBoard, points: newPoints, ships: newShips, identifiedShips, attacks } };
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
            if(attempts >= boardSize * boardSize) break; 
        } else {
            const affordableTypes = cellTypes.filter(t => SHIP_CELL_POINTS[t] <= playerState.points);
            if (affordableTypes.length === 0) {
                break; 
            }
        }
    }
  }

  const finishPlacing = useCallback(() => {
    setGameState(prev => {
        const newAiState = { ...prev.ai };
        placeAllShipsRandomly(newAiState, prev.settings.boardSize);
        newAiState.identifiedShips = identifyShips(newAiState.board);
        newAiState.attacks = calculateAttacks(newAiState.identifiedShips);
        
        const newPlayerState = {...prev.player};
        newPlayerState.identifiedShips = identifyShips(newPlayerState.board);
        newPlayerState.attacks = calculateAttacks(newPlayerState.identifiedShips);

        return {
            ...prev,
            phase: "playing",
            placingShips: false,
            ai: newAiState,
            player: newPlayerState,
            message: "All ships placed! Your turn to attack.",
            selectedCellType: null,
            turn: 'human',
            attacksRemaining: newPlayerState.attacks,
        };
    });
    toast({ title: "Fleet Deployed!", description: "Your ships are in position. Time to attack." });
  }, [toast]);

  const placeShipsRandomly = useCallback(() => {
    setIsPlacingRandomly(true);
    setTimeout(() => {
        setGameState(prev => {
            const newPlayerState = { ...prev.player };
            placeAllShipsRandomly(newPlayerState, prev.settings.boardSize);
            newPlayerState.identifiedShips = identifyShips(newPlayerState.board);
            newPlayerState.attacks = calculateAttacks(newPlayerState.identifiedShips);


            const newAiState = { ...prev.ai };
            placeAllShipsRandomly(newAiState, prev.settings.boardSize);
            newAiState.identifiedShips = identifyShips(newAiState.board);
            newAiState.attacks = calculateAttacks(newAiState.identifiedShips);

            return {
                ...prev,
                phase: "playing",
                placingShips: false,
                player: newPlayerState,
                ai: newAiState,
                message: "Random fleets deployed! Your turn.",
                selectedCellType: null,
                turn: 'human',
                attacksRemaining: newPlayerState.attacks,
            };
        });
        toast({ title: "Fleets Deployed!", description: "Your random fleet is ready. Good luck." });
        setIsPlacingRandomly(false);
    }, 500);
  }, [toast]);

  const handleCellClick = useCallback((row: number, col: number, boardOwner: Player) => {
    const { phase, turn, placingShips } = gameState;

    if (placingShips) {
      if (boardOwner === 'player') {
        placeShipCell(row, col);
      }
    } else if (phase === 'playing' && turn === 'human' && boardOwner === 'ai') {
      handleAttack('human', row, col);
    }
  }, [gameState, placeShipCell, handleAttack]);

  return { gameState, startGame, selectCellType, handleCellClick, resetGame, placeShipsRandomly, isPlacingRandomly, finishPlacing };
};
