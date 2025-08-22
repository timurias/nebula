
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { BoardSize, Difficulty, GameSettings } from "@/types";
import { Rocket } from "lucide-react";

interface SetupDialogProps {
  onStartGame: (settings: Omit<GameSettings, 'initialPoints'>) => void;
}

export default function SetupDialog({ onStartGame }: SetupDialogProps) {
  const [boardSize, setBoardSize] = useState<BoardSize>(10);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");

  const handleStart = () => {
    onStartGame({ boardSize, difficulty });
  };

  return (
    <Dialog open={true}>
      <DialogContent className="sm:max-w-[425px] bg-card/80 backdrop-blur-lg border-primary/30 text-primary-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-headline">
            <Rocket className="text-accent" />
            New Game Setup
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Configure your battle in the nebula.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="grid gap-3">
            <Label htmlFor="board-size" className="font-headline">Board Size</Label>
            <RadioGroup
              defaultValue="10"
              onValueChange={(value) => setBoardSize(Number(value) as BoardSize)}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="5" id="b5" />
                <Label htmlFor="b5">5x5 (30 Pts)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="10" id="b10" />
                <Label htmlFor="b10">10x10 (70 Pts)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="15" id="b15" />
                <Label htmlFor="b15">15x15 (150 Pts)</Label>
              </div>
            </RadioGroup>
          </div>
          <div className="grid gap-3">
            <Label htmlFor="difficulty" className="font-headline">AI Difficulty</Label>
            <RadioGroup
              defaultValue="medium"
              onValueChange={(value) => setDifficulty(value as Difficulty)}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="easy" id="d-easy" />
                <Label htmlFor="d-easy">Easy</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="medium" id="d-medium" />
                <Label htmlFor="d-medium">Medium</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="hard" id="d-hard" />
                <Label htmlFor="d-hard">Hard</Label>
              </div>
            </RadioGroup>
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" onClick={handleStart} className="w-full bg-accent hover:bg-accent/90">
            Launch Fleet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
