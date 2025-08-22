export type Player = "human" | "ai";

export enum CellType {
  Simple = "simple",
  Weapon = "weapon",
  Ammo = "ammo",
  Medical = "medical",
}

export const SHIP_CELL_HEALTH: Record<CellType, number> = {
  [CellType.Simple]: 1,
  [CellType.Weapon]: 2,
  [CellType.Ammo]: 1,
  [CellType.Medical]: 2,
};

export interface ShipCell {
  type: CellType;
  health: number;
}

export type CellState = {
  ship?: ShipCell;
  isHit: boolean;
  isMiss: boolean;
  animation?: "hit" | "miss";
};

export type Board = CellState[][];

export type GamePhase = "setup" | "placing" | "playing" | "over";
export type Difficulty = "easy" | "medium" | "hard";
export type BoardSize = 5 | 10 | 15;

export interface GameSettings {
    boardSize: BoardSize;
    difficulty: Difficulty;
}

export interface PlayerState {
    board: Board;
    ships: { type: CellType, count: number, total: number }[];
    ammo: number;
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
}
