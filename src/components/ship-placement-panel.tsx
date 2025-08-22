"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconAmmo, IconMedical, IconStructure, IconWeapon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { CellType } from "@/types";

interface ShipPlacementPanelProps {
  availableCells: { type: CellType; count: number; total: number }[];
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

export default function ShipPlacementPanel({
  availableCells,
  selectedCellType,
  onSelectCellType,
}: ShipPlacementPanelProps) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-lg font-headline text-center">Place Your Fleet</h3>
      {availableCells.map(({ type, count }) => {
        const Icon = cellTypeIcons[type];
        const isSelected = selectedCellType === type;
        const isDisabled = count === 0;

        return (
          <Button
            key={type}
            variant={isSelected ? "default" : "secondary"}
            onClick={() => onSelectCellType(type)}
            disabled={isDisabled}
            className={cn(
              "w-full justify-start transition-all duration-200",
              isSelected && "ring-2 ring-accent",
              isDisabled && "opacity-50"
            )}
          >
            <Icon className="w-5 h-5 mr-3 text-accent" />
            <span className="flex-grow text-left capitalize">{cellTypeNames[type]}</span>
            <span className="font-mono text-sm">{count} left</span>
          </Button>
        );
      })}
    </div>
  );
}
