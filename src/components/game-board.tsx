
"use client";

import { Board, CellType, IdentifiedShip, WEAPON_TYPES, WEAPON_SPECS } from "@/types";
import { cn } from "@/lib/utils";
import { IconAmmo, IconMedical, IconStructure, IconEnergy, IconWeapon1x1, IconWeapon3x3, IconWeapon5x5 } from "./icons";
import { Flame, X, ShieldQuestion, Wrench, Zap, Power, Fuel } from "lucide-react";
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
  selectedWeaponId?: string | null;
  allocationMode?: 'energy' | 'ammo' | null;
  selectedResource?: { row: number, col: number } | null;
}

const cellTypeIcons: Record<string, React.ElementType> = {
  [CellType.Simple]: IconStructure,
  [CellType.Weapon1x1]: IconWeapon1x1,
  [CellType.Weapon3x3]: IconWeapon3x3,
  [CellType.Weapon5x5]: IconWeapon5x5,
  [CellType.Ammo]: IconAmmo,
  [CellType.Medical]: IconMedical,
  [CellType.Energy]: IconEnergy,
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

const isResourceConsumer = (cellType: CellType) => {
    return cellType !== CellType.Simple && cellType !== CellType.Energy;
}

const getPoweredComponentEnergySourcesCount = (board: Board, componentId: string): number => {
    let count = 0;
    for (const row of board) {
        for (const cell of row) {
            if (cell.ship?.type === CellType.Energy && cell.ship.powering === componentId) {
                count++;
            }
        }
    }
    return count;
};

export default function GameBoard({ board, ships, onCellClick, isPlayerBoard, debug = false, selectedWeaponId, allocationMode, selectedResource }: GameBoardProps) {
  const boardSize = board.length;

  const canReceiveEnergy = (cellType: CellType) => {
    return isResourceConsumer(cellType);
  }
  
  const canReceiveAmmo = (cellType: CellType, board: Board, componentId: string) => {
    const energySources = getPoweredComponentEnergySourcesCount(board, componentId);
    return WEAPON_TYPES.includes(cellType) && energySources > 0;
  }

  return (
    <TooltipProvider>
      <div
        className="grid gap-0.5 aspect-square"
        style={{ gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))` }}
      >
        {board.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            if (!cell || !cell.ship) return null;
            const Icon = cell.ship ? cellTypeIcons[cell.ship.type] : null;
            const borderClasses = (isPlayerBoard || debug) ? getBorderClasses(rowIndex, colIndex, ships) : "";
            const isSelectedWeapon = isPlayerBoard && selectedWeaponId === cell.ship?.id;
            const isSelectedResource = isPlayerBoard && selectedResource?.row === rowIndex && selectedResource?.col === colIndex;
            
            const energySources = getPoweredComponentEnergySourcesCount(board, cell.ship.id);
            let isEnergized = false;
            if(isResourceConsumer(cell.ship.type)) {
                if(WEAPON_TYPES.includes(cell.ship.type)) {
                    const spec = WEAPON_SPECS[cell.ship.type];
                    isEnergized = energySources >= spec.energyCost;
                } else {
                    isEnergized = energySources >= 1;
                }
            }


            let isAllocationTarget = false;
            if (isPlayerBoard && allocationMode && cell.ship) {
              if (allocationMode === 'energy' && canReceiveEnergy(cell.ship.type)) {
                isAllocationTarget = true;
              }
              if (allocationMode === 'ammo' && canReceiveAmmo(cell.ship.type, board, cell.ship.id)) {
                isAllocationTarget = true;
              }
            }


            const cellContent = (
              <button
                key={`${rowIndex}-${colIndex}`}
                onClick={() => onCellClick(rowIndex, colIndex)}
                disabled={!isPlayerBoard && (cell.isHit || cell.isMiss)}
                className={cn(
                  "relative flex items-center justify-center aspect-square transition-all duration-200",
                  "bg-secondary/20 hover:bg-secondary/50",
                  borderClasses,
                  isSelectedWeapon && "ring-2 ring-accent ring-offset-2 ring-offset-background z-10",
                  isSelectedResource && "ring-2 ring-yellow-400 ring-offset-2 ring-offset-background z-10",
                  isAllocationTarget && "bg-green-500/30 hover:bg-green-500/50",
                  cell.animation === "hit" && "hit-animation",
                  cell.animation === "miss" && "miss-animation",
                  isPlayerBoard ? "cursor-pointer" : "cursor-crosshair",
                  (!isPlayerBoard && (cell.isHit || cell.isMiss)) && 'cursor-not-allowed'
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
                
                {(isPlayerBoard || debug) && cell.ship && !cell.isHit && Icon && (
                  <>
                  <Icon className={cn("w-2/3 h-2/3", isPlayerBoard ? "text-primary-foreground/80" : "text-accent-foreground/50")} />
                  
                  {cell.ship.type === CellType.Energy && !cell.ship.usedThisTurn && isPlayerBoard && (
                    <Power className="absolute top-0.5 right-0.5 w-3 h-3 text-yellow-400" />
                  )}

                  {cell.ship.type === CellType.Ammo && !cell.ship.usedThisTurn && isEnergized && isPlayerBoard && (
                    <Fuel className="absolute top-0.5 right-0.5 w-3 h-3 text-orange-400" />
                  )}

                  {isEnergized && cell.ship.type !== CellType.Energy && (
                    <Zap className="absolute bottom-0.5 right-0.5 w-3 h-3 text-yellow-400" />
                  )}

                  {!isEnergized && isResourceConsumer(cell.ship.type) && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <Zap className="w-1/2 h-1/2 text-muted-foreground/50" />
                    </div>
                  )}

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
            
            let tooltipContent = null;
            if(isPlayerBoard && cell.ship && !cell.isHit) {
                if(cell.repairTurnsLeft && cell.repairTurnsLeft > 0) {
                    tooltipContent = `Repairing... ${cell.repairTurnsLeft} turns left.`;
                } else if (!isEnergized && isResourceConsumer(cell.ship.type)) {
                    tooltipContent = "Not energized. Click an energy cell, then this cell to power it.";
                } else if (WEAPON_TYPES.includes(cell.ship.type)) {
                    const spec = WEAPON_SPECS[cell.ship.type];
                    tooltipContent = `Ammo: ${cell.ship.ammoCharge || 0}/${spec.ammoCost}. Energy: ${energySources}/${spec.energyCost}. Click an ammo cell, then this cell to charge it.`;
                } else if (cell.ship.type === CellType.Energy && !cell.ship.usedThisTurn) {
                    tooltipContent = "Energy producer. Click to select, then click a component to power it.";
                } else if (cell.ship.type === CellType.Ammo && isEnergized && !cell.ship.usedThisTurn) {
                    tooltipContent = "Ammo producer. Click to select, then click a weapon to charge it.";
                } else if (cell.ship.usedThisTurn) {
                    tooltipContent = "This resource has been used this turn."
                }
            }


            if (tooltipContent) {
              return (
                <Tooltip key={`${rowIndex}-${colIndex}-tooltip`}>
                  <TooltipTrigger asChild>{cellContent}</TooltipTrigger>
                  <TooltipContent>
                    <p>{tooltipContent}</p>
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

    