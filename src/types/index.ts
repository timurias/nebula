
export type Player = "human" | "ai";

export enum CellType {
  Simple = "simple",
  Weapon1x1 = "weapon1x1",
  Weapon3x3 = "weapon3x3",
  Weapon5x5 = "weapon5x5",
  Ammo = "ammo",
  Medical = "medical",
  Energy = "energy",
}

export const WEAPON_TYPES = [CellType.Weapon1x1, CellType.Weapon3x3, CellType.Weapon5x5];

export const SHIP_CELL_POINTS: Record<CellType, number> = {
    [CellType.Simple]: 1,
    [CellType.Weapon1x1]: 4,
    [CellType.Weapon3x3]: 8,
    [CellType.Weapon5x5]: 12,
    [CellType.Ammo]: 4,
    [CellType.Medical]: 3,
    [CellType.Energy]: 5,
};

export const WEAPON_SPECS: Record<string, { area: number; ammoCost: number; energyCost: number }> = {
    [CellType.Weapon1x1]: { area: 1, ammoCost: 1, energyCost: 1 },
    [CellType.Weapon3x3]: { area: 3, ammoCost: 3, energyCost: 2 },
    [CellType.Weapon5x5]: { area: 5, ammoCost: 5, energyCost: 3 },
};

export interface ShipCell {
  type: CellType;
  health: number;
  id: string; // Unique ID for each cell
  shipId?: number;
  ammoCharge?: number;
  usedThisTurn?: boolean;
  powering?: string | null; // For energy cells, string is component's ShipCell ID
}

export type CellState = {
  ship?: ShipCell;
  isHit: boolean;
  isMiss: boolean;
  animation?: "hit" | "miss";
  repairTurnsLeft?: number;
};

export type Board = CellState[][];

export type GamePhase = "setup" | "placing" | "playing" | "over";
export type Difficulty = "easy" | "medium" | "hard";
export type BoardSize = 5 | 10 | 15;

export interface GameSettings {
    boardSize: BoardSize;
    difficulty: Difficulty;
    initialPoints: number;
}

export interface IdentifiedShip {
    id: number;
    cells: { row: number, col: number }[];
    isSunk: boolean;
    
    // New properties for resource management
    energyProducers: ShipCell[];
    energyConsumers: ShipCell[];
    ammoProducers: ShipCell[];
    weapons: ShipCell[];
    medicalBays: ShipCell[];
    
    producedEnergy: number;
    consumedEnergy: number;
    producedAmmo: number;
}

export interface PlayerState {
    board: Board;
    points: number;
    totalPoints: number;
    ships: { type: CellType; count: number }[];
    identifiedShips: IdentifiedShip[];
    
    // Player-level resource pools
    totalAmmo: number;
    totalEnergy: number;
}

export interface GameState {
  phase: GamePhase;
  settings: GameSettings;
  player: PlayerState;
  ai: PlayerState;
  turn: Player;
  winner?: Player;
  message: string;
  selectedCellType: CellType | null;
  placingShips: boolean;
  aiMemory: {
    lastHit: { row: number; col: number } | null;
    huntDirection: 'up' | 'down' | 'left' | 'right' | null;
    potentialTargets: { row: number; col: number }[];
    searchAndDestroy: boolean;
    shipGrid: (boolean | null)[][];
  };
  lastAttack: {
    attacker: Player;
    cells: {row: number, col: number}[];
    result: 'hit' | 'miss';
  } | null;
  attacksRemaining: number;
  turnNumber: number;
  debug: boolean;

  // State for targeting and resource allocation
  selectedWeaponId: string | null;
  targetedCell: {row: number, col: number} | null;
  allocationMode: 'energy' | 'ammo' | null;
  selectedResource: {row: number, col: number} | null;
  hoveredCell: {row: number, col: number} | null;
}
