
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
  ShipCell,
  WEAPON_TYPES,
  WEAPON_SPECS
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

const getInitialState = (): GameState => {
  const settings = {
    boardSize: 10 as BoardSize,
    difficulty: "medium" as Difficulty,
    initialPoints: getPointsForBoardSize(10),
  };
  return {
    phase: "setup",
    settings,
    turn: "human",
    winner: undefined,
    message: "New game started. Select your settings.",
    selectedCellType: CellType.Simple,
    placingShips: false,
    player: createEmptyPlayerState(settings.boardSize),
    ai: createEmptyPlayerState(settings.boardSize),
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
    selectedWeaponId: null,
    targetedCell: null,
    allocationMode: null,
    selectedResource: null,
  }
};

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
        ships: Object.values(CellType).map(type => ({ type, count: 0 })),
        identifiedShips: [],
        totalAmmo: 0,
        totalEnergy: 0,
    };
}

const identifyShips = (board: Board): IdentifiedShip[] => {
    const ships: IdentifiedShip[] = [];
    const visited: boolean[][] = Array(board.length).fill(0).map(() => Array(board.length).fill(false));
    const size = board.length;

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const cell = board[r][c];
            if (cell.ship && !visited[r][c]) {
                const shipId = ships.length + 1;
                const newShip: IdentifiedShip = {
                    id: shipId,
                    cells: [],
                    isSunk: false,
                    energyProducers: [],
                    energyConsumers: [],
                    ammoProducers: [],
                    weapons: [],
                    medicalBays: [],
                    producedEnergy: 0,
                    consumedEnergy: 0,
                    producedAmmo: 0,
                };
                const queue: { row: number, col: number }[] = [{ row: r, col: c }];
                visited[r][c] = true;

                while (queue.length > 0) {
                    const current = queue.shift()!;
                    const currentCell = board[current.row][current.col];
                    if (!currentCell.ship) continue;

                    currentCell.ship.shipId = shipId;
                    newShip.cells.push(current);
                    
                    if (!currentCell.isHit) {
                        switch (currentCell.ship.type) {
                            case CellType.Energy:
                                newShip.energyProducers.push(currentCell.ship);
                                break;
                            case CellType.Ammo:
                                newShip.ammoProducers.push(currentCell.ship);
                                newShip.energyConsumers.push(currentCell.ship);
                                break;
                            case CellType.Medical:
                                newShip.medicalBays.push(currentCell.ship);
                                newShip.energyConsumers.push(currentCell.ship);
                                break;
                            default:
                                if (WEAPON_TYPES.includes(currentCell.ship.type)) {
                                    newShip.weapons.push(currentCell.ship);
                                    newShip.energyConsumers.push(currentCell.ship);
                                }
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
        if(prev.turn !== 'human') return prev;

        const activePlayerKey = 'player';
        const playerState = prev[activePlayerKey];
        let newBoard = JSON.parse(JSON.stringify(playerState.board));
        
        // 1. Decrement existing repair timers for the active player
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
        
        let newShips = identifyShips(newBoard);

        // 2. Repair Assignment
        newShips.forEach(ship => {
            if (ship.isSunk) return;

            let availableRepairs = ship.medicalBays.filter(m => {
                const cell = findCellByShipId(newBoard, m.id);
                return cell?.ship?.isEnergized;
            }).length;
            
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
        
        const updatedPlayerState: PlayerState = {
            ...playerState,
            board: newBoard,
            identifiedShips: newShips,
        };

        const newPlayerState = updatedPlayerState;

        // Reset AI energy allocation at the end of player's turn
        const newAiBoard = JSON.parse(JSON.stringify(prev.ai.board));
        for(const row of newAiBoard) {
            for(const cell of row) {
                if(cell.ship) {
                    if (cell.ship.type === CellType.Energy) {
                       cell.ship.powering = null;
                    } else if (cell.ship.type !== CellType.Simple) {
                       cell.ship.isEnergized = false;
                    }
                }
            }
        }
        const newAiState = {...prev.ai, board: newAiBoard, identifiedShips: identifyShips(newAiBoard)};

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
            turn: 'ai',
            turnNumber: prev.turnNumber + 1,
            message: "Enemy's turn.",
            player: newPlayerState,
            ai: newAiState,
            selectedWeaponId: null,
            targetedCell: null,
            allocationMode: null,
            selectedResource: null,
        }
    });
  }, [checkWinner]);

  const findCellByShipId = (board: Board, shipId: string): CellState | null => {
      for(const row of board) {
          for(const cell of row) {
              if(cell.ship?.id === shipId) {
                  return cell;
              }
          }
      }
      return null;
  }
  
  const handleAttack = useCallback((attacker: Player, targetCell: {row: number, col: number}) => {
    setGameState(prev => {
      const isHumanAttack = attacker === 'human';
      const targetPlayerKey = isHumanAttack ? 'ai' : 'player';
      
      if (isHumanAttack && prev.turn !== 'human') return prev;
      if (!isHumanAttack && prev.turn !== 'ai') return prev;
      
      const weaponId = prev.selectedWeaponId;
      if (isHumanAttack && !weaponId) {
        toast({title: "No Weapon Selected", description: "Select a weapon before attacking.", variant: "destructive"});
        return prev;
      }
      
      const attackerState = isHumanAttack ? prev.player : prev.ai;
      const weaponCell = findCellByShipId(attackerState.board, weaponId!);
      
      if(!weaponCell || !weaponCell.ship || !WEAPON_TYPES.includes(weaponCell.ship.type)) {
          return prev;
      }

      if(!weaponCell.ship.isEnergized){
          toast({title: "Weapon Not Energized", description: "This weapon has no power.", variant: "destructive"});
          return prev;
      }

      const weaponSpec = WEAPON_SPECS[weaponCell.ship.type as keyof typeof WEAPON_SPECS];
      if ((weaponCell.ship.ammoCharge || 0) < weaponSpec.ammoCost) {
          toast({title: "Not enough ammo!", description: "This weapon is not fully charged.", variant: "destructive"});
          return prev;
      }

      const targetState = prev[targetPlayerKey];
      const newBoard = JSON.parse(JSON.stringify(targetState.board));
      
      const attackArea = weaponSpec.area;
      const startOffset = -Math.floor(attackArea / 2);
      const endOffset = Math.ceil(attackArea / 2);
      const affectedCells: {row: number, col: number}[] = [];

      for(let r_offset = startOffset; r_offset < endOffset; r_offset++) {
          for(let c_offset = startOffset; c_offset < endOffset; c_offset++) {
              const r = targetCell.row + r_offset;
              const c = targetCell.col + c_offset;
              if(r >= 0 && r < prev.settings.boardSize && c >= 0 && c < prev.settings.boardSize) {
                  affectedCells.push({row: r, col: c});
              }
          }
      }

      let hasHit = false;
      affectedCells.forEach(({row, col}) => {
          const cell = newBoard[row][col];
          if (!cell.isHit && !cell.isMiss) {
              const animationType = cell.ship ? "hit" : "miss";
              newBoard[row][col] = { ...cell, animation: animationType };
              if(cell.ship) hasHit = true;
          }
      });
      
      const newAttackerBoard = JSON.parse(JSON.stringify(attackerState.board));
      const firedWeaponCell = findCellByShipId(newAttackerBoard, weaponId!);
      if(firedWeaponCell?.ship) {
          firedWeaponCell.ship.ammoCharge = 0;
      }

      let updatedState: GameState = { ...prev };
      updatedState[targetPlayerKey] = { ...targetState, board: newBoard };
      updatedState[isHumanAttack ? 'player' : 'ai'] = { ...attackerState, board: newAttackerBoard, identifiedShips: identifyShips(newAttackerBoard) };

      setTimeout(() => {
        setGameState(current => {
          const currentTargetState = current[targetPlayerKey];
          const boardAfterAnimation = JSON.parse(JSON.stringify(currentTargetState.board));
          let message = "";
          
          affectedCells.forEach(({row, col}) => {
              const cellAfterAnimation = boardAfterAnimation[row][col];
              if(cellAfterAnimation.animation) {
                  if (cellAfterAnimation.ship) {
                      cellAfterAnimation.isHit = true;
                  } else {
                      cellAfterAnimation.isMiss = true;
                  }
                  delete cellAfterAnimation.animation;
              }
          });
          
          message = `${attacker === "human" ? "You" : "AI"} ${hasHit ? 'scored a HIT!' : 'missed.'}`;

          const newTargetShips = identifyShips(boardAfterAnimation);
          const newTargetState = { ...currentTargetState, board: boardAfterAnimation, identifiedShips: newTargetShips };
          
          let finalState: GameState = { ...current };

          finalState[targetPlayerKey] = newTargetState;
          finalState.message = message;


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
            lastAttack: { attacker, cells: affectedCells, result: hasHit ? 'hit' : 'miss' },
            selectedWeaponId: null,
            targetedCell: null,
          };
        });
      }, 750);
  
      return updatedState;
    });
  }, [toast, checkWinner]);

  const getSmartMove = useCallback(async (board: Board, size: number, aiMemory: GameState['aiMemory'], difficulty: Difficulty, turnNumber: number) => {
    const allPossible: { row: number; col: number }[] = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
          if(!board[r][c].isHit && !board[r][c].isMiss) {
            allPossible.push({ row: r, col: c });
          }
      }
    }
    if (allPossible.length === 0) return { move: null };
    const move = allPossible[Math.floor(Math.random() * allPossible.length)];
    return { move };
  }, []);
    
  const placeShipCell = useCallback((row: number, col: number) => {
    let canPlace = true;
    let toastInfo: { title: string; description?: string; variant?: "destructive" } | null = null;
    
    setGameState(prev => {
        if (!prev.placingShips || !prev.selectedCellType) {
          canPlace = false;
          return prev;
        }

        const shipType = prev.selectedCellType;
        const cost = SHIP_CELL_POINTS[shipType];
        if (prev.player.points < cost) {
            toastInfo = { title: "Not enough points!", description: `You need ${cost} points for this part.`, variant: "destructive" };
            canPlace = false;
            return prev;
        }

        const newBoard = JSON.parse(JSON.stringify(prev.player.board));
        if (newBoard[row][col].ship) {
            toastInfo = { title: "Cell Occupied", description: "You've already placed a part here.", variant: "destructive" };
            canPlace = false;
            return prev;
        }

        newBoard[row][col].ship = { type: shipType, health: 1, id: `${row}-${col}-${shipType}` };
        const newPoints = prev.player.points - cost;
        const newShips = prev.player.ships.map(s => s.type === shipType ? { ...s, count: s.count + 1 } : s);
        
        return { ...prev, player: { ...prev.player, board: newBoard, points: newPoints, ships: newShips } };
    });
    
    if (!canPlace && toastInfo) {
        toast(toastInfo);
    }
  }, [toast]);
  
  const placeAllShipsRandomly = useCallback((playerState: PlayerState, boardSize: BoardSize) => {
    let newState = { 
        ...createEmptyPlayerState(boardSize),
        points: getPointsForBoardSize(boardSize),
    };
    
    let attempts = 0;
    while(newState.points > 0 && attempts < 200) {
      attempts++;
      const r = Math.floor(Math.random() * boardSize);
      const c = Math.floor(Math.random() * boardSize);

      if(!newState.board[r][c].ship) {
        let availableTypes = Object.values(CellType).filter(t => SHIP_CELL_POINTS[t] <= newState.points);
        if(availableTypes.length === 0) break;
        const type = availableTypes[Math.floor(Math.random() * availableTypes.length)];
        
        newState.board[r][c].ship = { type, health: 1, id: `ai-${r}-${c}` };
        newState.points -= SHIP_CELL_POINTS[type];
        newState.ships.find(s => s.type === type)!.count++;
      }
    }


    newState.identifiedShips = identifyShips(newState.board);
    return newState;
  }, []);

  const finishPlacing = useCallback(() => {
    let canFinish = true;
    let toastInfo: { title: string; description?: string; variant?: "destructive" } | null = null;
    setGameState(prev => {
        const playerShips = identifyShips(prev.player.board);
        if(playerShips.length === 0){
            toastInfo = {title: "No Ships Placed", description: "You must place at least one ship part.", variant: "destructive"};
            canFinish = false;
            return prev;
        }

        const newPlayerState = {...prev.player, identifiedShips: playerShips};
        const newAiState = placeAllShipsRandomly(prev.ai, prev.settings.boardSize);
        
        return {
            ...prev,
            phase: "playing",
            placingShips: false,
            ai: newAiState,
            player: newPlayerState,
            message: "All ships placed! Your turn to attack.",
            selectedCellType: null,
            turn: 'human',
        };
    });
    if (canFinish) {
      toast({ title: "Fleet Deployed!", description: "Your ships are in position. Time to attack." });
    } else if (toastInfo) {
      toast(toastInfo)
    }
  }, [placeAllShipsRandomly, toast]);
  
  const placeShipsRandomly = useCallback(() => {
    setIsPlacingRandomly(true);
    setGameState(prev => {
        const newPlayerState = placeAllShipsRandomly(prev.player, prev.settings.boardSize);
        return { ...prev, player: newPlayerState };
    });

    setTimeout(() => {
      finishPlacing();
      setIsPlacingRandomly(false);
    }, 500);
  }, [placeAllShipsRandomly, finishPlacing]);
  
  const handleCellClick = useCallback((row: number, col: number, boardOwner: Player) => {
    const { phase, turn, placingShips, selectedWeaponId, allocationMode, selectedResource, player } = gameState;
    let toastInfo: { title: string; description?: string; variant?: "destructive" } | null = null;

    if (placingShips) {
      if (boardOwner === 'player') placeShipCell(row, col);
      return;
    }
    
    if (phase !== 'playing' || turn !== 'human') return;

    if (boardOwner === 'ai') {
      if (selectedWeaponId) {
        handleAttack('human', {row, col});
        setGameState(prev => ({ ...prev, targetedCell: {row, col} }));
      } else {
        toastInfo = { title: "No Weapon Selected", description: "Select one of your ready weapons first.", variant: "destructive" };
      }
    } else if (boardOwner === 'player') {
      const clickedCell = player.board[row][col];
      if (!clickedCell.ship) return;

      if (allocationMode && selectedResource) {
        setGameState(prev => {
            const newBoard = JSON.parse(JSON.stringify(prev.player.board));
            const sourceCellState = newBoard[selectedResource.row][selectedResource.col];
            const targetCellState = newBoard[row][col];

            if (allocationMode === 'energy') {
                if (targetCellState.ship && targetCellState.ship.type !== CellType.Simple && targetCellState.ship.type !== CellType.Energy) {
                    // De-energize previously powered cell if any
                    if (sourceCellState.ship.powering) {
                        const oldTargetCoords = JSON.parse(sourceCellState.ship.powering);
                        newBoard[oldTargetCoords.row][oldTargetCoords.col].ship.isEnergized = false;
                    }
                    
                    // Energize new cell
                    targetCellState.ship.isEnergized = true;
                    sourceCellState.ship.powering = JSON.stringify({row, col});
                    toastInfo = { title: "Component Energized", description: `${targetCellState.ship.type} is now powered.` };
                }
            } else if (allocationMode === 'ammo') {
                if (targetCellState.ship && WEAPON_TYPES.includes(targetCellState.ship.type)) {
                    const weaponSpec = WEAPON_SPECS[targetCellState.ship.type];
                    const currentCharge = targetCellState.ship.ammoCharge || 0;
                    if (currentCharge < weaponSpec.ammoCost) {
                        targetCellState.ship.ammoCharge = currentCharge + 1;
                        sourceCellState.ship.usedThisTurn = true;
                        toastInfo = { title: "Weapon Charged", description: `Charged ${targetCellState.ship.type} by 1.` };
                    } else {
                        toastInfo = { title: "Weapon Fully Charged", variant: "destructive" };
                    }
                }
            }
            return { ...prev, player: { ...prev.player, board: newBoard, identifiedShips: identifyShips(newBoard) }, allocationMode: null, selectedResource: null };
        });
      } else { // Not in allocation mode, select a resource or weapon
        switch (clickedCell.ship.type) {
          case CellType.Energy:
            if (clickedCell.ship.usedThisTurn) {
              toastInfo = { title: "Energy Used", description: "This energy cell has already been used this turn." };
            } else {
              toastInfo = { title: "Energy Allocation", description: "Select a component to power." };
              setGameState(prev => ({ ...prev, allocationMode: 'energy', selectedResource: { row, col } }));
            }
            break;
          
          case CellType.Ammo:
            if (clickedCell.ship.usedThisTurn) {
              toastInfo = { title: "Ammo Used", description: "This ammo cell has already been used this turn." };
            } else if (!clickedCell.ship.isEnergized) {
              toastInfo = { title: "Not Energized", description: "This ammo producer has no power.", variant: "destructive" };
            } else {
              toastInfo = { title: "Ammo Allocation", description: "Select a weapon to charge." };
              setGameState(prev => ({ ...prev, allocationMode: 'ammo', selectedResource: { row, col } }));
            }
            break;

          default:
            if (WEAPON_TYPES.includes(clickedCell.ship.type)) {
              const weaponSpec = WEAPON_SPECS[clickedCell.ship.type];
              if (!clickedCell.ship.isEnergized) {
                toastInfo = { title: "Weapon Not Energized", description: "This weapon has no power.", variant: "destructive" };
              } else if ((clickedCell.ship.ammoCharge || 0) >= weaponSpec.ammoCost) {
                toastInfo = { title: "Weapon Selected", description: "Target an enemy cell to fire." };
                setGameState(prev => ({ ...prev, selectedWeaponId: clickedCell.ship!.id, allocationMode: null, selectedResource: null }));
              } else {
                toastInfo = { title: "Weapon Not Ready", description: "This weapon is not fully charged." };
              }
            }
        }
      }
    }
    
    if(toastInfo) {
        toast(toastInfo);
    }
  }, [gameState, placeShipCell, handleAttack, toast]);
  
  const cancelAllocation = useCallback(() => {
    setGameState(prev => ({
      ...prev,
      allocationMode: null,
      selectedResource: null,
    }));
  }, []);

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
    let canSelect = true;
    let toastInfo: { title: string; description?: string; variant?: "destructive" } | null = null;
    setGameState((prev) => {
        const cost = SHIP_CELL_POINTS[cellType];
        if (prev.player.points >= cost) {
            return { ...prev, selectedCellType: cellType };
        } else {
            toastInfo = { title: "Not enough points", description: `You need ${cost} points to place a ${cellType} part.`, variant: "destructive" };
            canSelect = false;
        }
        return prev;
    });
    if (!canSelect && toastInfo) {
      toast(toastInfo);
    }
  }, [toast]);

  const toggleDebugMode = useCallback(() => {
    setGameState(prev => ({ ...prev, debug: !prev.debug }));
  }, []);

  useEffect(() => {
    if (gameState.turn === 'human' && gameState.turnNumber > 0) {
      setGameState(prev => {
        const newBoard = JSON.parse(JSON.stringify(prev.player.board));
        for(const row of newBoard) {
          for(const cell of row) {
            if(cell.ship && (cell.ship.type === CellType.Energy || cell.ship.type === CellType.Ammo)) {
              cell.ship.usedThisTurn = false;
            }
          }
        }
        return { ...prev, player: {...prev.player, board: newBoard, identifiedShips: identifyShips(newBoard) }};
      })
    }
  }, [gameState.turn, gameState.turnNumber]);


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
  
  const executeAITurn = useCallback(async () => {
    let aiState = gameState.ai;
    let newBoard = JSON.parse(JSON.stringify(aiState.board));

    // AI Resource Management
    // Energize
    const energyProducers = newBoard.flat().filter((c: CellState) => c.ship?.type === CellType.Energy && !c.ship?.isHit).map((c: CellState) => c.ship!.id);
    const consumers = newBoard.flat().filter((c: CellState) => c.ship && c.ship.type !== CellType.Energy && c.ship.type !== CellType.Simple && !c.ship?.isHit && !c.ship.isEnergized).map((c: CellState) => c.ship!.id);
    
    for(const producerId of energyProducers) {
        if(consumers.length > 0) {
            const consumerId = consumers.shift()!;
            const producerCell = findCellByShipId(newBoard, producerId)!;
            const consumerCell = findCellByShipId(newBoard, consumerId)!;
            consumerCell.ship!.isEnergized = true;
        }
    }

    // Charge weapons
    const ammoProducers = newBoard.flat().filter((c: CellState) => c.ship?.type === CellType.Ammo && c.ship.isEnergized && !c.ship?.isHit);
    let availableAmmo = ammoProducers.length;
    for(const row of newBoard) {
        for(const cell of row) {
            if(cell.ship && WEAPON_TYPES.includes(cell.ship.type) && cell.ship.isEnergized) {
                const spec = WEAPON_SPECS[cell.ship.type];
                const needed = spec.ammoCost - (cell.ship.ammoCharge || 0);
                const chargeAmount = Math.min(availableAmmo, needed);
                cell.ship.ammoCharge = (cell.ship.ammoCharge || 0) + chargeAmount;
                availableAmmo -= chargeAmount;
            }
        }
    }
    
    setGameState(prev => ({...prev, ai: {...prev.ai, board: newBoard, identifiedShips: identifyShips(newBoard)}}));
    
    await new Promise(resolve => setTimeout(resolve, 500));

    // AI Attack
    const readyWeapons = newBoard.flat()
        .filter((c: CellState) => c.ship && WEAPON_TYPES.includes(c.ship.type) && c.ship.isEnergized && (c.ship.ammoCharge || 0) >= WEAPON_SPECS[c.ship.type].ammoCost)
        .map((c: CellState) => c.ship!);
        
    for (const weapon of readyWeapons) {
      const { move } = await getSmartMove(gameState.player.board, gameState.settings.boardSize, gameState.aiMemory, gameState.settings.difficulty, gameState.turnNumber);
      if(move){
          await new Promise<void>(resolve => {
              setGameState(prev => {
                  const newState = {...prev, selectedWeaponId: weapon.id};
                  handleAttack('ai', move);
                  return newState;
              });
              setTimeout(() => resolve(), 1000);
          });
      }
    }
    
    // End AI Turn
    await new Promise(resolve => setTimeout(resolve, 1000));
    setGameState(prev => {
      let newAIBoard = JSON.parse(JSON.stringify(prev.ai.board));
      let newAIShips = identifyShips(newAIBoard);

      newAIShips.forEach(ship => {
          if (ship.isSunk) return;
          let availableRepairs = ship.medicalBays.filter(m => {
              const cell = findCellByShipId(newAIBoard, m.id);
              return cell?.ship?.isEnergized && !cell?.isHit;
          }).length;
          const cellsCurrentlyRepairing = ship.cells.filter(c => newAIBoard[c.row][c.col].repairTurnsLeft).length;
          availableRepairs -= cellsCurrentlyRepairing;
          const damagedCells = ship.cells.map(c => ({ ...c, cell: newAIBoard[c.row][c.col] })).filter(c => c.cell.isHit && !c.cell.repairTurnsLeft);
          for (const cellToRepair of damagedCells) {
              if (availableRepairs <= 0) break;
              newAIBoard[cellToRepair.row][cellToRepair.col].repairTurnsLeft = 3;
              availableRepairs--;
          }
      });
      for(const row of newAIBoard) {
          for(const cell of row) {
              if (cell.repairTurnsLeft && cell.repairTurnsLeft > 0) {
                    cell.repairTurnsLeft--;
                    if (cell.repairTurnsLeft === 0) {
                        cell.isHit = false;
                    }
                }
          }
      }

      const updatedAIState = {...prev.ai, board: newAIBoard, identifiedShips: identifyShips(newAIBoard)};
      const winner = checkWinner(prev.player, updatedAIState);
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
        ai: updatedAIState,
        turn: 'human',
        message: 'Your turn.',
      }
    });

  }, [gameState, getSmartMove, handleAttack, checkWinner]);

  useEffect(() => {
    if (gameState.phase === 'playing' && gameState.turn === 'ai' && !gameState.winner) {
      const turnTimeout = setTimeout(() => {
        executeAITurn();
      }, 1000);
      return () => clearTimeout(turnTimeout);
    }
  }, [gameState.turn, gameState.phase, gameState.winner, executeAITurn]);


  return { gameState, startGame, selectCellType, handleCellClick, resetGame, placeShipsRandomly, isPlacingRandomly, finishPlacing, toggleDebugMode, endTurn, cancelAllocation };
};
