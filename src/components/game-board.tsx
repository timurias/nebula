
"use client";

import { Board, CellType, IdentifiedShip } from "@/types";
import { cn } from "@/lib/utils";
import { IconAmmo, IconMedical, IconStructure, IconWeapon } from "./icons";
import { Flame, X, ShieldQuestion, Wrench } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface GameBoardProps {
  board: Board;
  ships: IdentifiedShip[];
  onCellClick: (row: number, col: number) => void;
  isPlayerBoard: boolean;
  debug?: boolean;
}

const cellTypeIcons: Record<CellType, React.ElementType> = {
  [CellType.Simple]: IconStructure,
  [CellType.Weapon]: IconWeapon,
  [CellType.Ammo]: IconAmmo,
  [CellType.Medical]: IconMedical,
};

const getBorderClasses = (row: number, col: number, ships: IdentifiedShip[]) => {
  let shipIndex = -1;
  for(let i=0; i<ships.length; i++) {
    if(ships[i].cells.some(c => c.row === row && c.col === col)) {
      shipIndex = i;
      break;
    }
  }

  if (shipIndex === -1) return "";

  const ship = ships[shipIndex];
  const classes = [];

  const hasNeighbor = (r: number, c: number) => ship.cells.some(cell => cell.row === r && cell.col === c);

  if (!hasNeighbor(row - 1, col)) classes.push("border-t-2 border-accent/70");
  if (!hasNeighbor(row + 1, col)) classes.push("border-b-2 border-accent/70");
  if (!hasNeighbor(row, col - 1)) classes.push("border-l-2 border-accent/70");
  if (!hasNeighbor(row, col + 1)) classes.push("border-r-2 border-accent/70");

  // Fix corners
  if (!hasNeighbor(row - 1, col) && !hasNeighbor(row, col - 1)) classes.push("rounded-tl-lg");
  if (!hasNeighbor(row - 1, col) && !hasNeighbor(row, col + 1)) classes.push("rounded-tr-lg");
  if (!hasNeighbor(row + 1, col) && !hasNeighbor(row, col - 1)) classes.push("rounded-bl-lg");
  if (!hasNeighbor(row + 1, col) && !hasNeighbor(row, col + 1)) classes.push("rounded-br-lg");


  return classes.join(" ");
}

export default function GameBoard({ board, ships, onCellClick, isPlayerBoard, debug = false }: GameBoardProps) {
  const boardSize = board.length;

  return (
    <TooltipProvider>
      <div
        className="grid gap-0.5 aspect-square"
        style={{ gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))` }}
      >
        {board.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            const Icon = cell.ship ? cellTypeIcons[cell.ship.type] : null;
            const borderClasses = (isPlayerBoard || debug) ? getBorderClasses(rowIndex, colIndex, ships) : "";

            const cellContent = (
              <button
                key={`${rowIndex}-${colIndex}`}
                onClick={() => onCellClick(rowIndex, colIndex)}
                disabled={!isPlayerBoard && (cell.isHit || cell.isMiss)}
                className={cn(
                  "relative flex items-center justify-center aspect-square transition-all duration-200",
                  "bg-secondary/20 hover:bg-secondary/50",
                  borderClasses,
                  cell.animation === "hit" && "hit-animation",
                  cell.animation === "miss" && "miss-animation",
                  isPlayerBoard ? "cursor-default" : "cursor-crosshair",
                  (cell.isHit || cell.isMiss) && 'cursor-not-allowed'
                )}
                aria-label={`Cell ${rowIndex}, ${colIndex}`}
              >
                {cell.isHit && cell.ship && (
                  <div className="absolute inset-0 flex items-center justify-center bg-destructive/70">
                      <Flame className="w-4/6 h-4/6 text-destructive-foreground animate-pulse" />
                  </div>
                )}
                {cell.isMiss && (
                  <div className="absolute inset-0 flex items-center justify-center">
                      <X className="w-1/2 h-1/2 text-muted-foreground/50" />
                  </div>
                )}
                
                {(isPlayerBoard || debug) && cell.ship && !cell.isHit && (
                  <>
                  <Icon className={cn("w-2/3 h-2/3", isPlayerBoard ? "text-primary-foreground/80" : "text-accent-foreground/50")} />
                  {cell.repairTurnsLeft && cell.repairTurnsLeft > 0 && (
                      <div className="absolute inset-0 flex items-center justify-center bg-blue-500/50">
                          <Wrench className="w-1/2 h-1/2 text-white animate-spin" style={{ animationDuration: '3s' }} />
                      </div>
                  )}
                  </>
                )}
                
                {!isPlayerBoard && cell.isHit && !cell.ship && (
                   <div className="absolute inset-0 flex items-center justify-center bg-destructive/70">
                      <ShieldQuestion className="w-4/6 h-4/6 text-destructive-foreground animate-pulse" />
                  </div>
                )}
                 {!isPlayerBoard && cell.isHit && cell.ship && (
                   <div className="absolute inset-0 flex items-center justify-center bg-destructive/70">
                      <Flame className="w-4/6 h-4/6 text-destructive-foreground animate-pulse" />
                  </div>
                )}

              </button>
            );

            if (isPlayerBoard && cell.repairTurnsLeft && cell.repairTurnsLeft > 0) {
              return (
                <Tooltip key={`${rowIndex}-${colIndex}-tooltip`}>
                  <TooltipTrigger asChild>{cellContent}</TooltipTrigger>
                  <TooltipContent>
                    <p>Repairing... {cell.repairTurnsLeft} turns left.</p>
                  </TooltipContent>
                </Tooltip>
              )
            }
            
            return cellContent;
          })
        )}
      </div>
    </TooltipProvider>
  );
}
