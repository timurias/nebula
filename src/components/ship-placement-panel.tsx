
"use client";

import { Button } from "@/components/ui/button";
import { IconAmmo, IconMedical, IconStructure, IconWeapon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { CellType, PlayerState, SHIP_CELL_POINTS } from "@/types";
import { Badge } from "@/components/ui/badge";

interface ShipPlacementPanelProps {
  playerState: PlayerState;
  selectedCellType: CellType | null;
  onSelectCellType: (type: CellType) => void;
}

const cellTypeIcons: Record<CellType, React.ElementType> = {
  [CellType.Simple]: IconStructure,
  [CellType.Weapon]: IconWeapon,
  [CellType.Ammo]: IconAmmo,
  [CellType.Medical]: IconMedical,
};

const cellTypeNames: Record<CellType, string> = {
    [CellType.Simple]: "Structure",
    [CellType.Weapon]: "Weapon",
    [CellType.Ammo]: "Ammo",
    [CellType.Medical]: "Medical",
};

const cellTypes = Object.values(CellType);

export default function ShipPlacementPanel({
  playerState,
  selectedCellType,
  onSelectCellType,
}: ShipPlacementPanelProps) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-lg font-headline text-center">Place Your Fleet</h3>
      <div className="text-center mb-2">
        <p className="text-muted-foreground">Points Remaining</p>
        <p className="text-2xl font-bold font-headline text-accent">{playerState.points}</p>
      </div>
      {cellTypes.map((type) => {
        const Icon = cellTypeIcons[type];
        const cost = SHIP_CELL_POINTS[type];
        const isSelected = selectedCellType === type;
        const isDisabled = playerState.points < cost;

        return (
          <Button
            key={type}
            variant={isSelected ? "default" : "secondary"}
            onClick={() => onSelectCellType(type)}
            disabled={isDisabled}
            className={cn(
              "w-full justify-start transition-all duration-200 relative",
              isSelected && "ring-2 ring-accent",
              isDisabled && "opacity-50"
            )}
          >
            <Icon className="w-5 h-5 mr-3 text-accent" />
            <span className="flex-grow text-left capitalize">{cellTypeNames[type]}</span>
            <Badge variant="outline" className="mr-2">Cost: {cost}</Badge>
            <Badge>{playerState.ships.find(s => s.type === type)?.count || 0}</Badge>
          </Button>
        );
      })}
    </div>
  );
}
