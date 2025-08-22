
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
        const activePlayerKey = prev.turn;
        const playerState = activePlayerKey === 'human' ? prev.player : prev.ai;
        let newBoard = JSON.parse(JSON.stringify(playerState.board));
        
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
        
        let newShips = identifyShips(newBoard);

        // 2. Resource Production & Repair Assignment
        newShips.forEach(ship => {
            if (ship.isSunk) return;

            // Energize components
            let availableEnergy = ship.energyProducers.length;
            ship.energyConsumers.forEach(consumer => {
              const cell = findCellByShipId(newBoard, consumer.id);
              if(cell?.ship) {
                  if(availableEnergy > 0) {
                    cell.ship.isEnergized = true;
                    availableEnergy--;
                  } else {
                    cell.ship.isEnergized = false;
                  }
              }
            });

            // Ammo Production
            ship.ammoProducers.forEach(ammo => {
              const cell = findCellByShipId(newBoard, ammo.id);
              if(cell?.ship?.isEnergized) {
                playerState.totalAmmo += 1;
              }
            });

            // Repair Assignment
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

        const newPlayerState = activePlayerKey === 'human' ? updatedPlayerState : prev.player;
        const newAiState = activePlayerKey === 'ai' ? updatedPlayerState : prev.ai;

        const nextTurn = prev.turn === 'human' ? 'ai' : 'human';
        
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
            turnNumber: prev.turnNumber + 1,
            message: nextTurn === 'human' ? "Your turn." : "Enemy's turn.",
            player: newPlayerState,
            ai: newAiState,
            selectedWeaponId: null,
            targetedCell: null,
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
          // This should not happen with proper UI
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
      updatedState[isHumanAttack ? 'player' : 'ai'] = { ...attackerState, board: newAttackerBoard };

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
          
          // If all attacks are done, end turn
          if (isHumanAttack || (!isHumanAttack && current.ai.identifiedShips.every(s => s.weapons.every(w => (w.ammoCharge || 0) < WEAPON_SPECS[w.type as keyof typeof WEAPON_SPECS].ammoCost)))) {
             const turnEndTimeout = setTimeout(() => {
                endTurn();
              }, 1000);
              // We don't need to clear this timeout as it's a one-off
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
  }, [toast, endTurn, checkWinner]);

  const getSmartMove = useCallback(async (board: Board, size: number, aiMemory: GameState['aiMemory'], difficulty: Difficulty, turnNumber: number) => {
    // This function needs to be heavily updated for new mechanics
    // For now, it will just pick a random valid cell
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
    
    // Simplified random placement for new mechanics
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
    const { phase, turn, placingShips, selectedWeaponId } = gameState;

    if (placingShips) {
      if (boardOwner === 'player') {
        placeShipCell(row, col);
      }
    } else if (phase === 'playing' && turn === 'human' && boardOwner === 'ai') {
        if(selectedWeaponId) {
            setGameState(prev => ({...prev, targetedCell: {row, col}}));
            handleAttack('human', {row, col});
        } else {
            toast({ title: "No Weapon Selected", description: "Click on one of your active weapons first.", variant: "destructive" });
        }
    } else if (phase === 'playing' && turn === 'human' && boardOwner === 'player') {
        const cell = gameState.player.board[row][col];
        if (cell.ship && WEAPON_TYPES.includes(cell.ship.type)) {
            const weaponSpec = WEAPON_SPECS[cell.ship.type as keyof typeof WEAPON_SPECS];
            if ((cell.ship.ammoCharge || 0) >= weaponSpec.ammoCost) {
                setGameState(prev => ({ ...prev, selectedWeaponId: cell.ship!.id }));
            } else {
                toast({title: "Weapon Not Ready", description: "This weapon is not fully charged."});
            }
        }
    }
  }, [gameState, placeShipCell, handleAttack, toast]);

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
    const performAITurn = async () => {
        if (gameState.phase !== 'playing' || gameState.turn !== 'ai' || gameState.winner) {
            return;
        }

        // AI logic for resource management
        setGameState(prev => {
            let newBoard = JSON.parse(JSON.stringify(prev.ai.board));
            let newShips = identifyShips(newBoard);
            let totalAmmo = prev.ai.totalAmmo;

            newShips.forEach(ship => {
                if(ship.isSunk) return;

                let availableEnergy = ship.energyProducers.length;
                ship.energyConsumers.forEach(c => {
                    const cell = findCellByShipId(newBoard, c.id);
                    if(cell?.ship) cell.ship.isEnergized = availableEnergy-- > 0;
                });

                ship.ammoProducers.forEach(p => {
                    const cell = findCellByShipId(newBoard, p.id);
                    if(cell?.ship?.isEnergized) totalAmmo++;
                });

                ship.weapons.forEach(w => {
                    const cell = findCellByShipId(newBoard, w.id);
                    if(cell?.ship?.isEnergized) {
                        const spec = WEAPON_SPECS[w.type as keyof typeof WEAPON_SPECS];
                        const needed = spec.ammoCost - (cell.ship.ammoCharge || 0);
                        const chargeAmount = Math.min(totalAmmo, needed);
                        if(cell.ship.ammoCharge) {
                            cell.ship.ammoCharge += chargeAmount;
                        } else {
                            cell.ship.ammoCharge = chargeAmount;
                        }
                        totalAmmo -= chargeAmount;
                    }
                });
            });
            
            return {...prev, ai: {...prev.ai, board: newBoard, totalAmmo, identifiedShips: newShips}};
        });

        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // AI attack logic
        const readyWeapons = gameState.ai.identifiedShips
            .flatMap(s => s.weapons)
            .filter(w => {
                const spec = WEAPON_SPECS[w.type as keyof typeof WEAPON_SPECS];
                return (w.ammoCharge || 0) >= spec.ammoCost;
            });

        if (readyWeapons.length > 0) {
            const weaponToFire = readyWeapons[0];
            const { move } = await getSmartMove(gameState.player.board, gameState.settings.boardSize, gameState.aiMemory, gameState.settings.difficulty, gameState.turnNumber);
            if(move){
                setGameState(prev => ({...prev, selectedWeaponId: weaponToFire.id}));
                handleAttack('ai', move);
            } else {
                endTurn();
            }
        } else {
            endTurn();
        }
    };

    performAITurn();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.turn, gameState.phase, gameState.winner, gameState.turnNumber]);


  return { gameState, startGame, selectCellType, handleCellClick, resetGame, placeShipsRandomly, isPlacingRandomly, finishPlacing, toggleDebugMode, chargeWeapon, endTurn };
};
