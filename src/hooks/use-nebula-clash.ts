
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

                    if(cell.ship && !cell.isHit) { // Only count parts on non-hit cells
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

  const calculateAttacks = useCallback((ships: IdentifiedShip[]) => {
      return ships.reduce((total, ship) => {
          if(ship.isSunk) return total;
          const shipAttacks = Math.min(ship.weaponCount, ship.ammoCount);
          return total + shipAttacks;
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

            // 1. Decrement existing repair timers
            for (let r = 0; r < newBoard.length; r++) {
                for (let c = 0; c < newBoard[r].length; c++) {
                    const cell = newBoard[r][c];
                    if (cell.repairTurnsLeft && cell.repairTurnsLeft > 0) {
                        cell.repairTurnsLeft--;
                        if (cell.repairTurnsLeft === 0) {
                            cell.isHit = false; // Repair complete
                        }
                    }
                }
            }
            
            newShips = identifyShips(newBoard); // Re-identify ships after repairs might have completed

            // 2. Assign new repairs
            newShips.forEach(ship => {
                if (ship.isSunk) return;

                let availableRepairs = ship.medicalCount;
                
                const cellsCurrentlyRepairing = ship.cells.filter(c => newBoard[c.row][c.col].repairTurnsLeft).length;
                availableRepairs -= cellsCurrentlyRepairing;

                const damagedCells = ship.cells
                    .map(c => ({ ...c, cell: newBoard[c.row][c.col] }))
                    .filter(c => c.cell.isHit && !c.cell.repairTurnsLeft); 

                for (const cellToRepair of damagedCells) {
                    if (availableRepairs <= 0) break;
                    newBoard[cellToRepair.row][cellToRepair.col].repairTurnsLeft = 3;
                    availableRepairs--;
                }
            });

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
        const newTurnNumber = prev.turn === 'human' ? prev.turnNumber : prev.turnNumber + 1;
        
        const winner = checkWinner(newPlayerState, newAiState);
        if (winner) {
          return {
            ...prev,
            phase: 'over',
            winner,
            message: winner === 'human' ? 'You have conquered the nebula.' : 'Your fleet has been destroyed.'
          }
        }


        return {
            ...prev,
            turn: nextTurn,
            message: nextTurn === 'human' ? "Your turn." : "Enemy's turn.",
            attacksRemaining: nextTurn === 'human' ? newPlayerState.attacks : newAiState.attacks,
            player: newPlayerState,
            ai: newAiState,
            turnNumber: newTurnNumber,
        }
    });
  }, [calculateAttacks, checkWinner]);
  
  const handleAttack = useCallback((attacker: Player, row: number, col: number): boolean => {
    let wasValidAttack = false;
    setGameState(prev => {
      const isHumanAttack = attacker === 'human';
      const targetPlayerKey = isHumanAttack ? 'ai' : 'player';
  
      if (isHumanAttack && prev.turn !== 'human') return prev;
      if (!isHumanAttack && prev.turn !== 'ai') return prev;
      if (isHumanAttack && prev.attacksRemaining <= 0) return prev;
  
      const targetState = prev[targetPlayerKey];
      const newBoard = JSON.parse(JSON.stringify(targetState.board));
      const cell = newBoard[row][col];
  
      if (cell.isHit || cell.isMiss) {
        if (isHumanAttack) {
          toast({ title: "Wasted Shot!", description: "You've already fired at this location.", variant: "destructive" });
        }
        return prev;
      }
  
      wasValidAttack = true;
      const animationType = cell.ship ? "hit" : "miss";
      newBoard[row][col] = { ...cell, animation: animationType };
  
      let updatedState: GameState = { ...prev };
      updatedState[targetPlayerKey] = { ...targetState, board: newBoard };
  
      if (isHumanAttack) {
        updatedState.attacksRemaining = prev.attacksRemaining - 1;
      }
  
      setTimeout(() => {
        setGameState(current => {
          const currentTargetState = current[targetPlayerKey];
          const boardAfterAnimation = JSON.parse(JSON.stringify(currentTargetState.board));
          const cellAfterAnimation = boardAfterAnimation[row][col];
          delete cellAfterAnimation.animation;
  
          let message = "";
          let attackResult: 'hit' | 'miss';
  
          if (cellAfterAnimation.ship) {
            cellAfterAnimation.isHit = true;
            attackResult = 'hit';
            message = `${attacker === "human" ? "You" : "AI"} scored a HIT!`;
             if (!isHumanAttack) {
                current.aiMemory.lastHit = { row, col };
                current.aiMemory.searchAndDestroy = true;
                current.aiMemory.potentialTargets = [];
            }
          } else {
            cellAfterAnimation.isMiss = true;
            attackResult = 'miss';
            message = `${attacker === "human" ? "You" : "AI"} missed.`;
          }
  
          const newTargetShips = identifyShips(boardAfterAnimation);
          const newTargetState = { ...currentTargetState, board: boardAfterAnimation, identifiedShips: newTargetShips, attacks: calculateAttacks(newTargetShips) };
          
          let finalState: GameState;
          if (isHumanAttack) {
              finalState = { ...current, ai: newTargetState, message };
          } else {
              // For AI attacks, we should not be in this timeout. This part of logic is faulty for AI.
              // But we keep it for human player animations.
              return current;
          }

          const winner = checkWinner(finalState.player, finalState.ai);
          if (winner) {
            return {
              ...finalState,
              phase: "over",
              winner,
              message: winner === 'human' ? "Congratulations, you won!" : "The AI has defeated you.",
            };
          }
  
          return {
            ...finalState,
            lastAttack: { attacker, row, col, result: attackResult }
          };
        });
      }, 750);
      
      // Synchronous update for AI
      if(!isHumanAttack) {
          delete newBoard[row][col].animation;
          let message = "";
          let attackResult: 'hit' | 'miss';

          if (newBoard[row][col].ship) {
            newBoard[row][col].isHit = true;
            attackResult = 'hit';
            message = `AI scored a HIT!`;
            updatedState.aiMemory.lastHit = { row, col };
            updatedState.aiMemory.searchAndDestroy = true;
            updatedState.aiMemory.potentialTargets = [];
          } else {
            newBoard[row][col].isMiss = true;
            attackResult = 'miss';
            message = `AI missed.`;
          }
          
          const newTargetShips = identifyShips(newBoard);
          const newTargetState = { ...updatedState.player, board: newBoard, identifiedShips: newTargetShips, attacks: calculateAttacks(newTargetShips) };
          updatedState.player = newTargetState;
          updatedState.message = message;
          updatedState.ai.attacks = prev.ai.attacks - 1;

          const winner = checkWinner(updatedState.player, updatedState.ai);
           if (winner) {
            return {
              ...updatedState,
              phase: "over",
              winner,
              message: winner === 'human' ? "Congratulations, you won!" : "The AI has defeated you.",
            };
          }
           return {
            ...updatedState,
            lastAttack: { attacker, row, col, result: attackResult }
          };
      }
  
      return updatedState;
    });
    return wasValidAttack;
  }, [toast, calculateAttacks, checkWinner]);

  const getSmartMove = useCallback(async (board: Board, size: number, aiMemory: GameState['aiMemory'], difficulty: Difficulty, turnNumber: number) => {
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
          if ((r + c) % (difficulty === 'hard' ? 1 : 2) === (turnNumber % 2)) {
             checkerboardPossible.push({ row: r, col: c });
          }
        }
      }
    }
    
    if (difficulty === 'hard' && allPossible.length > 0) {
      let bestMove = allPossible[Math.floor(Math.random() * allPossible.length)];
      
      const move = bestMove;
      try {
          const evaluation = await evaluateMove({
              boardState: JSON.stringify(board),
              move: `${String.fromCharCode(65 + move.row)}${move.col + 1}`,
              opponentBoard: "Unknown"
          });
          if(evaluation.isHighValue){
              bestMove = move;
          }
      } catch (e) {
           console.error("AI evaluation failed, falling back to random", e);
      }
      return { move: bestMove, updatedTargets: [] };
    }
    
    const targetList = checkerboardPossible.length > 0 ? checkerboardPossible : allPossible;
    if (targetList.length > 0) {
      const move = targetList[Math.floor(Math.random() * targetList.length)];
      return { move, updatedTargets: [] };
    }

    return { move: null, updatedTargets: [] };
  }, []);
    
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
    let newState = { 
        ...createEmptyPlayerState(boardSize),
        points: getPointsForBoardSize(boardSize),
    };
    
    const getNeighbors = (r: number, c: number, bSize: number, board: Board) => {
        const neighbors = [];
        if (r > 0 && !board[r-1][c].ship) neighbors.push({ row: r - 1, col: c });
        if (r < bSize - 1 && !board[r+1][c].ship) neighbors.push({ row: r + 1, col: c });
        if (c > 0 && !board[r][c-1].ship) neighbors.push({ row: r, col: c - 1 });
        if (c < bSize - 1 && !board[r][c+1].ship) neighbors.push({ row: r, col: c + 1 });
        return neighbors;
    };
    
    let attempts = 0;
    while (newState.points > 0 && attempts < 50) {
        attempts++;
        
        let availableTypes = Object.values(CellType).filter(t => SHIP_CELL_POINTS[t] <= newState.points);
        if(availableTypes.length === 0) break;

        let placementAttempts = 0;
        let placedSuccessfully = false;
        while(placementAttempts < 20 && !placedSuccessfully) {
            placementAttempts++;
            const startRow = Math.floor(Math.random() * boardSize);
            const startCol = Math.floor(Math.random() * boardSize);

            if (!newState.board[startRow][startCol].ship) {
                let tempBoard = JSON.parse(JSON.stringify(newState.board));
                let tempPoints = newState.points;
                let tempShips = JSON.parse(JSON.stringify(newState.ships));
                
                const shipSize = Math.floor(Math.random() * 3) + 3; // 3 to 5 parts
                let shipPartsToPlace: CellType[] = [];
                let shipValue = 0;

                // Aim for a balanced ship
                const weaponCost = SHIP_CELL_POINTS[CellType.Weapon];
                const ammoCost = SHIP_CELL_POINTS[CellType.Ammo];
                
                if(tempPoints >= weaponCost + ammoCost){
                  shipPartsToPlace.push(CellType.Weapon);
                  shipPartsToPlace.push(CellType.Ammo);
                  shipValue += weaponCost + ammoCost;
                }

                while(shipPartsToPlace.length < shipSize){
                  const availableForShip = Object.values(CellType).filter(t => shipValue + SHIP_CELL_POINTS[t] <= tempPoints);
                  if(availableForShip.length === 0) break;
                  const type = availableForShip[Math.floor(Math.random() * availableForShip.length)];
                  shipPartsToPlace.push(type);
                  shipValue += SHIP_CELL_POINTS[type];
                }
                
                if (shipPartsToPlace.length > 0) {
                    let frontier = [{row: startRow, col: startCol}];
                    let placedParts = 0;
                    
                    while(placedParts < shipPartsToPlace.length && frontier.length > 0){
                      const randomIndex = Math.floor(Math.random() * frontier.length);
                      const { row, col } = frontier.splice(randomIndex, 1)[0];

                      if(!tempBoard[row][col].ship) {
                          const partType = shipPartsToPlace[placedParts];
                          tempBoard[row][col].ship = { type: partType, health: 1 };
                          tempPoints -= SHIP_CELL_POINTS[partType];
                          tempShips.find((s: any) => s.type === partType)!.count++;
                          placedParts++;

                          getNeighbors(row, col, boardSize, tempBoard)
                            .forEach(n => {
                              if(!frontier.some(f => f.row === n.row && f.col === n.col)){
                                frontier.push(n)
                              }
                            });
                      }
                    }
                    newState.board = tempBoard;
                    newState.points = tempPoints;
                    newState.ships = tempShips;
                    placedSuccessfully = true;
                }
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
    const { phase, turn, placingShips, attacksRemaining } = gameState;

    if (placingShips) {
      if (boardOwner === 'player') {
        placeShipCell(row, col);
      }
    } else if (phase === 'playing' && turn === 'human' && boardOwner === 'ai') {
        if(attacksRemaining > 0) {
            handleAttack('human', row, col);
        } else {
            toast({ title: "Out of Attacks", description: "You have no attacks left this turn.", variant: "destructive" });
        }
    }
  }, [gameState, placeShipCell, handleAttack, toast]);

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
    if (gameState.phase === 'playing' && gameState.turn === 'human' && gameState.attacksRemaining <= 0 && !gameState.winner) {
      const turnEndTimeout = setTimeout(() => {
        endTurn();
      }, 1000);
      return () => clearTimeout(turnEndTimeout);
    }
  }, [gameState.phase, gameState.turn, gameState.attacksRemaining, endTurn, gameState.winner]);
  
  useEffect(() => {
      const performAIAttack = async () => {
          if (gameState.phase !== 'playing' || gameState.turn !== 'ai' || gameState.winner) {
              return;
          }

          if (gameState.ai.attacks > 0) {
              setGameState(prev => ({ ...prev, message: `AI is thinking... (${prev.ai.attacks} attacks left)` }));
              await new Promise(resolve => setTimeout(resolve, 500)); // Delay for thinking
              
              const { settings, player: playerState, aiMemory, turnNumber } = gameState;
              const { move } = await getSmartMove(playerState.board, settings.boardSize, aiMemory, settings.difficulty, turnNumber);
  
              if (move) {
                  handleAttack("ai", move.row, move.col);
              } else {
                  // No valid moves left, end turn early
                  endTurn();
              }
          } else {
              setGameState(prev => ({ ...prev, message: "AI has no attacks left." }));
              const turnEndTimeout = setTimeout(() => {
                  endTurn();
              }, 1000);
              return () => clearTimeout(turnEndTimeout);
          }
      };

      performAIAttack();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.turn, gameState.ai.attacks, gameState.phase, gameState.winner]);


  return { gameState, startGame, selectCellType, handleCellClick, resetGame, placeShipsRandomly, isPlacingRandomly, finishPlacing, toggleDebugMode };
};

    