
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
        const newAiState = prev.ai;

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
          
          // AI turn logic is now handled in useEffect, so we don't call endTurn here for AI.
          if(isHumanAttack) {
            // Human attack does not automatically end turn anymore
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
          allPossible.push({ row: r, col: c });
      }
    }
    const move = allPossible[Math.floor(Math.random() * allPossible.length)];
    return { move };
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

        newBoard[row][col].ship = { type: shipType, health: 1, id: `${row}-${col}-${shipType}` };
        const newPoints = prev.player.points - cost;
        const newShips = prev.player.ships.map(s => s.type === shipType ? { ...s, count: s.count + 1 } : s);
        
        return { ...prev, player: { ...prev.player, board: newBoard, points: newPoints, ships: newShips } };
    });
  }, [toast]);
  
  const placeAllShipsRandomly = useCallback((playerState: PlayerState, boardSize: BoardSize) => {
    let newState = { 
        ...createEmptyPlayerState(boardSize),
        points: getPointsForBoardSize(boardSize),
    };
    
    // This function can be improved to build more coherent ships
    let attempts = 0;
    while(newState.points > 0 && attempts < 100) {
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
    setGameState(prev => {
        const playerShips = identifyShips(prev.player.board);
        if(playerShips.length === 0){
            toast({title: "No Ships Placed", description: "You must place at least one ship part.", variant: "destructive"});
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
    toast({ title: "Fleet Deployed!", description: "Your ships are in position. Time to attack." });
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
    setGameState(prev => {
      const { phase, turn, placingShips, selectedWeaponId, allocationMode, selectedResource } = prev;

      // 1. Ship Placement Phase
      if (placingShips) {
        if (boardOwner === 'player') {
          placeShipCell(row, col);
        }
        return prev;
      }
      
      // 2. Playing Phase
      if (phase !== 'playing' || turn !== 'human') return prev;

      // 2a. Player clicks on Enemy board (Attack)
      if (boardOwner === 'ai') {
        if (selectedWeaponId) {
          handleAttack('human', {row, col});
          return { ...prev, targetedCell: {row, col} };
        } else {
          toast({ title: "No Weapon Selected", description: "Select one of your ready weapons first.", variant: "destructive" });
        }
        return prev;
      }

      // 2b. Player clicks on their own board
      if (boardOwner === 'player') {
        const clickedCell = prev.player.board[row][col];
        if (!clickedCell.ship) return prev;

        // If in allocation mode, try to allocate resource
        if (allocationMode && selectedResource) {
          const sourceCell = prev.player.board[selectedResource.row][selectedResource.col];
          const targetCell = clickedCell;

          if (allocationMode === 'energy') {
            if (targetCell.ship && targetCell.ship.type !== CellType.Simple && targetCell.ship.type !== CellType.Energy && !targetCell.ship.isEnergized) {
              const newBoard = JSON.parse(JSON.stringify(prev.player.board));
              newBoard[row][col].ship.isEnergized = true;
              newBoard[selectedResource.row][selectedResource.col].ship.usedThisTurn = true;
              toast({ title: "Component Energized", description: `${targetCell.ship.type} is now powered.` });
              return { ...prev, player: { ...prev.player, board: newBoard }, allocationMode: null, selectedResource: null };
            }
          } else if (allocationMode === 'ammo') {
            if (targetCell.ship && WEAPON_TYPES.includes(targetCell.ship.type)) {
              const newBoard = JSON.parse(JSON.stringify(prev.player.board));
              const weaponSpec = WEAPON_SPECS[targetCell.ship.type];
              const currentCharge = newBoard[row][col].ship.ammoCharge || 0;
              if (currentCharge < weaponSpec.ammoCost) {
                newBoard[row][col].ship.ammoCharge = currentCharge + 1;
                newBoard[selectedResource.row][selectedResource.col].ship.usedThisTurn = true;
                toast({ title: "Weapon Charged", description: `Charged ${targetCell.ship.type} by 1.` });
                return { ...prev, player: { ...prev.player, board: newBoard }, allocationMode: null, selectedResource: null };
              } else {
                 toast({ title: "Weapon Fully Charged", variant: "destructive" });
              }
            }
          }
          return prev;
        }

        // If not in allocation mode, determine action based on clicked cell
        switch (clickedCell.ship.type) {
          case CellType.Energy:
            if (clickedCell.ship.usedThisTurn) {
              toast({ title: "Energy Used", description: "This energy cell has already been used this turn." });
              return prev;
            }
            toast({ title: "Energy Allocation", description: "Select a component to power." });
            return { ...prev, allocationMode: 'energy', selectedResource: { row, col } };
          
          case CellType.Ammo:
            if (clickedCell.ship.usedThisTurn) {
              toast({ title: "Ammo Used", description: "This ammo cell has already been used this turn." });
              return prev;
            }
            if (!clickedCell.ship.isEnergized) {
              toast({ title: "Not Energized", description: "This ammo producer has no power.", variant: "destructive" });
              return prev;
            }
            toast({ title: "Ammo Allocation", description: "Select a weapon to charge." });
            return { ...prev, allocationMode: 'ammo', selectedResource: { row, col } };

          default:
            if (WEAPON_TYPES.includes(clickedCell.ship.type)) {
              const weaponSpec = WEAPON_SPECS[clickedCell.ship.type];
              if (!clickedCell.ship.isEnergized) {
                toast({ title: "Weapon Not Energized", description: "This weapon has no power.", variant: "destructive" });
                return prev;
              }
              if ((clickedCell.ship.ammoCharge || 0) >= weaponSpec.ammoCost) {
                toast({ title: "Weapon Selected", description: "Target an enemy cell to fire." });
                return { ...prev, selectedWeaponId: clickedCell.ship.id, allocationMode: null, selectedResource: null };
              } else {
                toast({ title: "Weapon Not Ready", description: "This weapon is not fully charged." });
              }
            }
        }
      }
      return prev;
    });
  }, [placeShipCell, handleAttack, toast]);

  const chargeWeapon = useCallback((weaponId: string, amount: number) => {
    setGameState(prev => {
        if(prev.player.totalAmmo < amount) {
            toast({title: "Not Enough Ammo", variant: "destructive"});
            return prev;
        }

        const newBoard = JSON.parse(JSON.stringify(prev.player.board));
        const weaponCell = findCellByShipId(newBoard, weaponId);

        if(weaponCell?.ship && WEAPON_TYPES.includes(weaponCell.ship.type)) {
            const spec = WEAPON_SPECS[weaponCell.ship.type as keyof typeof WEAPON_SPECS];
            const currentCharge = weaponCell.ship.ammoCharge || 0;
            const needed = spec.ammoCost - currentCharge;
            const chargeAmount = Math.min(amount, needed);

            weaponCell.ship.ammoCharge = currentCharge + chargeAmount;
            const newPlayerState = {
                ...prev.player,
                board: newBoard,
                totalAmmo: prev.player.totalAmmo - chargeAmount,
            };
            return {...prev, player: newPlayerState};
        }
        return prev;
    })
  }, [toast]);
  
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

  // Reset usedThisTurn at the start of the player's turn
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
        return { ...prev, player: {...prev.player, board: newBoard }};
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
    // AI turn logic
    let aiState = gameState.ai;
    let newBoard = JSON.parse(JSON.stringify(aiState.board));

    // 1. AI Resource Management (Simplified)
    // Energize
    const energyProducers = newBoard.flat().filter((c: CellState) => c.ship?.type === CellType.Energy);
    let availableEnergy = energyProducers.length;
    for(const row of newBoard) {
        for(const cell of row) {
            if(cell.ship && cell.ship.type !== CellType.Energy && cell.ship.type !== CellType.Simple) {
                if(availableEnergy > 0) {
                    cell.ship.isEnergized = true;
                    availableEnergy--;
                } else {
                    cell.ship.isEnergized = false;
                }
            }
        }
    }

    // Charge weapons
    const ammoProducers = newBoard.flat().filter((c: CellState) => c.ship?.type === CellType.Ammo && c.ship.isEnergized);
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
    
    // Update AI state with new board
    setGameState(prev => ({...prev, ai: {...prev.ai, board: newBoard, identifiedShips: identifyShips(newBoard)}}));
    
    await new Promise(resolve => setTimeout(resolve, 500)); // Pause for resource allocation visualization

    // 2. AI Attack
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
              // Wait for attack animation to finish
              setTimeout(() => resolve(), 1000);
          });
      }
    }
    
    // 3. End AI Turn
    await new Promise(resolve => setTimeout(resolve, 1000));
    setGameState(prev => {
      // Logic from endTurn for AI
      let newAIBoard = JSON.parse(JSON.stringify(prev.ai.board));
      let newAIShips = identifyShips(newAIBoard);

      newAIShips.forEach(ship => {
          if (ship.isSunk) return;
          let availableRepairs = ship.medicalBays.filter(m => {
              const cell = findCellByShipId(newAIBoard, m.id);
              return cell?.ship?.isEnergized;
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
              if(cell.ship && (cell.ship.type === CellType.Energy || cell.ship.type === CellType.Ammo)) {
                cell.ship.usedThisTurn = false;
              }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.turn, gameState.phase, gameState.winner]);


  return { gameState, startGame, selectCellType, handleCellClick, resetGame, placeShipsRandomly, isPlacingRandomly, finishPlacing, toggleDebugMode, chargeWeapon, endTurn, cancelAllocation };
};
