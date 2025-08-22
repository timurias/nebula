
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
  Difficulty,
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
  debug: false,
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
      const { attacker, result } = gameState.lastAttack;
      if (result === 'hit') {
        toast({
          title: "HIT!",
          description: `${attacker === 'human' ? 'You' : 'AI'} landed a hit.`,
        });
      }
    }
  }, [gameState.lastAttack, toast]);

  const calculateAttacks = useCallback((ships: IdentifiedShip[]) => {
      return ships.reduce((total, ship) => {
          if(ship.isSunk) return total;
          return total + Math.min(ship.weaponCount, ship.ammoCount);
      }, 0);
  }, []);
  
  const checkWinner = useCallback((playerState: PlayerState, aiState: PlayerState): Player | undefined => {
    const playerShipsSunk = playerState.identifiedShips.length > 0 && playerState.identifiedShips.every(s => s.isSunk);
    const aiShipsSunk = aiState.identifiedShips.length > 0 && aiState.identifiedShips.every(s => s.isSunk);

    if (playerShipsSunk && aiShipsSunk) {
        return playerState.totalPoints > aiState.totalPoints ? 'human' : 'ai';
    }
    if (playerShipsSunk) return "ai";
    if (aiShipsSunk) return "human";
    return undefined;
  }, []);

  const endTurn = useCallback(() => {
    setGameState(prev => {
        const processPlayerTurnEnd = (playerState: PlayerState): PlayerState => {
            let newBoard = JSON.parse(JSON.stringify(playerState.board));
            let newShips = identifyShips(newBoard);

            if (prev.turnNumber > 0 && prev.turnNumber % 3 === 0) {
                newShips.forEach(ship => {
                    if (ship.isSunk || ship.medicalCount === 0) return;

                    let repairsMade = 0;
                    const damagedCells = ship.cells
                        .map(c => ({ ...c, cell: newBoard[c.row][c.col] }))
                        .filter(c => c.cell.isHit && !c.cell.repairTurnsLeft);

                    for (const cellToRepair of damagedCells) {
                        if (repairsMade >= ship.medicalCount) break;
                        newBoard[cellToRepair.row][cellToRepair.col].repairTurnsLeft = 3;
                        repairsMade++;
                    }
                });
            }

            for (const row of newBoard) {
                for (const cell of row) {
                    if (cell.repairTurnsLeft && cell.repairTurnsLeft > 0) {
                        cell.repairTurnsLeft--;
                        if (cell.repairTurnsLeft === 0) {
                            cell.isHit = false;
                        }
                    }
                }
            }

            newShips = identifyShips(newBoard);

            return {
                ...playerState,
                board: newBoard,
                identifiedShips: newShips,
                attacks: calculateAttacks(newShips)
            };
        };

        const newPlayerState = processPlayerTurnEnd(prev.player);
        const newAiState = processPlayerTurnEnd(prev.ai);

        const nextTurn = prev.turn === 'human' ? 'ai' : 'human';
        
        return {
            ...prev,
            turn: nextTurn,
            message: nextTurn === 'human' ? "Your turn." : "Enemy's turn.",
            attacksRemaining: nextTurn === 'human' ? newPlayerState.attacks : newAiState.attacks,
            player: newPlayerState,
            ai: newAiState,
            turnNumber: nextTurn === 'human' ? prev.turnNumber + 1 : prev.turnNumber
        }
    });
  }, [calculateAttacks]);

  const handleAttack = useCallback((attacker: Player, row: number, col: number): boolean => {
    let wasValidAttack = false;
    setGameState(prev => {
        const isHumanAttack = attacker === 'human';
        
        if (isHumanAttack && prev.attacksRemaining <= 0) {
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

        if (cell.isHit || cell.isMiss) {
            if(isHumanAttack) toast({ title: "Wasted Shot!", description: "You've already fired at this location.", variant: "destructive"});
            return prev;
        }
        
        wasValidAttack = true;

        const animationType = cell.ship ? "hit" : "miss";
        newBoard[row][col] = {...cell, animation: animationType };

        let updatedState = { ...prev };
        updatedState[targetPlayerKey] = { ...targetState, board: newBoard };
         if(isHumanAttack) {
            updatedState.attacksRemaining = prev.attacksRemaining - 1;
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

                let finalState = {
                     ...current,
                    [targetPlayerKey]: newTargetState,
                    message,
                    aiMemory: newAiMemory,
                    lastAttack: { attacker, row, col, result: attackResult }
                }

                if (winner) {
                    finalState = {
                        ...finalState,
                        phase: "over",
                        winner,
                        message: winner === 'human' ? "Congratulations, you won!" : "The AI has defeated you.",
                    };
                } else if(isHumanAttack && current.attacksRemaining - 1 <= 0) {
                    endTurn();
                }

                return finalState;
            });
        }, 750);

        return updatedState;
    });
    return wasValidAttack;
  }, [toast, endTurn, calculateAttacks, checkWinner]);
  
  const getSmartMove = useCallback(async (board: Board, size: number, aiMemory: GameState['aiMemory'], difficulty: Difficulty) => {
    let targets = [...aiMemory.potentialTargets];

    if (difficulty !== 'easy' && aiMemory.searchAndDestroy && aiMemory.lastHit) {
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
          if ((r + c) % (difficulty === 'hard' ? 1 : 2) === (gameState.turnNumber % 2)) {
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
            // Rate limit or other error, fallback to random
        }
    }
    
    const targetList = checkerboardPossible.length > 0 ? checkerboardPossible : allPossible;
    if (targetList.length > 0) {
      const move = targetList[Math.floor(Math.random() * targetList.length)];
      return { move, updatedTargets: [] };
    }

    return { move: null, updatedTargets: [] };
  }, [gameState.turnNumber]);
  
  const handleAIturn = useCallback(async () => {
    setGameState(prev => ({...prev, message: "AI is thinking..."}));
    await new Promise(resolve => setTimeout(resolve, 500)); 

    let attacksToMake = gameState.ai.attacks;
    
    while(attacksToMake > 0) {
        const { settings, player: playerState, aiMemory } = gameState;
        const { board, boardSize } = { board: playerState.board, boardSize: settings.boardSize };
        const { move } = await getSmartMove(board, boardSize, aiMemory, settings.difficulty);

        if (move) {
            const isValid = handleAttack("ai", move.row, move.col);
            if (isValid) {
                attacksToMake--;
            }
        } else {
            // No more moves available
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    endTurn();
  }, [gameState, getSmartMove, handleAttack, endTurn]);
  
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
  }, [toast, calculateAttacks]);
  
  const placeAllShipsRandomly = useCallback((playerState: PlayerState, boardSize: BoardSize) => {
    let newState = { ...playerState, board: createEmptyBoard(boardSize), points: getPointsForBoardSize(boardSize) };
    newState.ships.forEach(s => s.count = 0);

    const cellTypes = Object.values(CellType);

    while (newState.points > 0) {
        const shipType = cellTypes[Math.floor(Math.random() * cellTypes.length)];
        const cost = SHIP_CELL_POINTS[shipType];

        if (newState.points >= cost) {
            let placed = false;
            let attempts = 0;
            while(!placed && attempts < boardSize * boardSize) {
                const row = Math.floor(Math.random() * boardSize);
                const col = Math.floor(Math.random() * boardSize);
                if (!newState.board[row][col].ship) {
                    newState.board[row][col].ship = { type: shipType, health: 1 };
                    newState.points -= cost;
                    const shipIndex = newState.ships.findIndex(s => s.type === shipType);
                    newState.ships[shipIndex].count++;
                    placed = true;
                }
                attempts++;
            }
            if(attempts >= boardSize * boardSize) break; 
        } else {
            const affordableTypes = cellTypes.filter(t => SHIP_CELL_POINTS[t] <= newState.points);
            if (affordableTypes.length === 0) {
                break; 
            }
        }
    }
    newState.identifiedShips = identifyShips(newState.board);
    newState.attacks = calculateAttacks(newState.identifiedShips);
    return newState;
  }, [calculateAttacks]);

  const finishPlacing = useCallback(() => {
    setGameState(prev => {
        const newAiState = placeAllShipsRandomly(prev.ai, prev.settings.boardSize);
        
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
  }, [placeAllShipsRandomly, calculateAttacks, toast]);
  
  const placeShipsRandomly = useCallback(() => {
    setIsPlacingRandomly(true);
    setGameState(prev => {
        const newPlayerState = placeAllShipsRandomly(prev.player, prev.settings.boardSize);
        return {
            ...prev,
            player: newPlayerState,
        };
    });

    setTimeout(() => {
        finishPlacing();
        toast({ title: "Fleets Deployed!", description: "Your random fleet is ready. Good luck." });
        setIsPlacingRandomly(false);
    }, 500);
  }, [placeAllShipsRandomly, finishPlacing, toast]);
  
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

  const resetGame = useCallback(() => {
    localStorage.removeItem("nebulaClashState");
    setGameState(getInitialState());
  }, []);

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

  const toggleDebugMode = useCallback(() => {
    setGameState(prev => ({ ...prev, debug: !prev.debug }));
  }, []);

  useEffect(() => {
    if (gameState.phase === "playing" && gameState.turn === "ai" && !gameState.winner) {
        const aiTurnTimeout = setTimeout(() => {
            handleAIturn();
        }, 1500);
        return () => clearTimeout(aiTurnTimeout);
    }
  }, [gameState.phase, gameState.turn, gameState.winner, handleAIturn]);

  return { gameState, startGame, selectCellType, handleCellClick, resetGame, placeShipsRandomly, isPlacingRandomly, finishPlacing, toggleDebugMode };
};


    