"use client";

import { type Board, CellType } from "@/types";
import { cn } from "@/lib/utils";
import { IconAmmo, IconMedical, IconStructure, IconWeapon } from "./icons";
import { Flame, X, ShieldQuestion } from "lucide-react";

interface GameBoardProps {
  board: Board;
  onCellClick: (row: number, col: number) => void;
  isPlayerBoard: boolean;
}

const cellTypeIcons: Record<CellType, React.ElementType> = {
  [CellType.Simple]: IconStructure,
  [CellType.Weapon]: IconWeapon,
  [CellType.Ammo]: IconAmmo,
  [CellType.Medical]: IconMedical,
};

export default function GameBoard({ board, onCellClick, isPlayerBoard }: GameBoardProps) {
  const boardSize = board.length;

  return (
    <div
      className="grid gap-1 aspect-square"
      style={{ gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))` }}
    >
      {board.map((row, rowIndex) =>
        row.map((cell, colIndex) => {
          const Icon = cell.ship ? cellTypeIcons[cell.ship.type] : null;

          return (
            <button
              key={`${rowIndex}-${colIndex}`}
              onClick={() => onCellClick(rowIndex, colIndex)}
              disabled={!isPlayerBoard && (cell.isHit || cell.isMiss)}
              className={cn(
                "relative flex items-center justify-center aspect-square rounded-md transition-all duration-200",
                "bg-secondary/20 hover:bg-secondary/50",
                cell.animation === "hit" && "hit-animation",
                cell.animation === "miss" && "miss-animation",
                isPlayerBoard ? "cursor-default" : "cursor-crosshair",
                (cell.isHit || cell.isMiss) && 'cursor-not-allowed'
              )}
              aria-label={`Cell ${rowIndex}, ${colIndex}`}
            >
              {cell.isHit && cell.ship && (
                <div className="absolute inset-0 flex items-center justify-center bg-destructive/70 rounded-md">
                    <Flame className="w-4/6 h-4/6 text-destructive-foreground animate-pulse" />
                </div>
              )}
              {cell.isMiss && (
                <div className="absolute inset-0 flex items-center justify-center rounded-md">
                    <X className="w-1/2 h-1/2 text-muted-foreground/50" />
                </div>
              )}
              
              {isPlayerBoard && cell.ship && !cell.isHit && (
                <Icon className="w-2/3 h-2/3 text-primary-foreground/80" />
              )}
              
              {!isPlayerBoard && cell.isHit && !cell.ship && (
                 <div className="absolute inset-0 flex items-center justify-center bg-destructive/70 rounded-md">
                    <ShieldQuestion className="w-4/6 h-4/6 text-destructive-foreground animate-pulse" />
                </div>
              )}
               {!isPlayerBoard && cell.isHit && cell.ship && (
                 <div className="absolute inset-0 flex items-center justify-center bg-destructive/70 rounded-md">
                    <Flame className="w-4/6 h-4/6 text-destructive-foreground animate-pulse" />
                </div>
              )}

            </button>
          );
        })
      )}
    </div>
  );
}
