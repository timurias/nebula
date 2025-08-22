
"use client";

import { useNebulaClash } from "@/hooks/use-nebula-clash";
import GameBoard from "@/components/game-board";
import SetupDialog from "@/components/setup-dialog";
import ShipPlacementPanel from "@/components/ship-placement-panel";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Rocket, Dices, RotateCcw, CheckSquare, Target, Bug, Zap, Bomb, Power, Fuel } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CellType, WEAPON_SPECS, Board } from "@/types";

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

export default function Home() {
  const {
    gameState,
    startGame,
    selectCellType,
    handleCellClick,
    resetGame,
    placeShipsRandomly,
    isPlacingRandomly,
    finishPlacing,
    toggleDebugMode,
    endTurn,
    cancelAllocation,
  } = useNebulaClash();

  if (gameState.phase === "setup") {
    return <SetupDialog onStartGame={startGame} />;
  }

  const isSetupPhase = gameState.phase === 'setup';

  const renderPlayerControls = () => {
    if (gameState.winner) return null;
    if (gameState.placingShips) {
       return (
        <div className="flex flex-col gap-4">
            <ShipPlacementPanel
              playerState={gameState.player}
              selectedCellType={gameState.selectedCellType}
              onSelectCellType={selectCellType}
            />
            <Button onClick={placeShipsRandomly} disabled={isPlacingRandomly}>
              <Dices className="mr-2 h-4 w-4" />
              {isPlacingRandomly ? 'Placing...' : 'Place Randomly'}
            </Button>
            <Button onClick={finishPlacing} variant="default" className="bg-accent hover:bg-accent/90">
              <CheckSquare className="mr-2 h-4 w-4" />
              Finish Placing
            </Button>
          </div>
       )
    }

    const availableEnergy = gameState.player.board.flat().filter(c => c.ship?.type === CellType.Energy && !c.ship.usedThisTurn && !c.isHit).length;
    const availableAmmo = gameState.player.board.flat().filter(c => c.ship?.type === CellType.Ammo && !c.ship.usedThisTurn && !c.isHit && getPoweredComponentEnergySourcesCount(gameState.player.board, c.ship.id) >= 1).length;

    return (
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="font-headline text-lg mb-2">Weapons & Resources</h3>
           <div className="flex justify-between items-center bg-secondary p-2 rounded-md mb-2">
                <div className="flex items-center gap-2">
                    <Power className="w-5 h-5 text-yellow-400"/>
                    <span className="font-semibold">Available Energy</span>
                </div>
                <span className="text-xl font-bold">{availableEnergy}</span>
            </div>
            <div className="flex justify-between items-center bg-secondary p-2 rounded-md mb-2">
                <div className="flex items-center gap-2">
                    <Fuel className="w-5 h-5 text-orange-400"/>
                    <span className="font-semibold">Available Ammo</span>
                </div>
                <span className="text-xl font-bold">{availableAmmo}</span>
            </div>

            {gameState.allocationMode && (
              <Card className="p-3 mb-2 border-accent">
                <div className="flex flex-col items-center">
                  <p className="font-semibold text-accent mb-2">
                    Allocating {gameState.allocationMode.charAt(0).toUpperCase() + gameState.allocationMode.slice(1)}
                  </p>
                  <p className="text-sm text-muted-foreground text-center mb-2">
                    Select a target component to energize or charge.
                  </p>
                  <Button size="sm" variant="outline" onClick={cancelAllocation}>Cancel</Button>
                </div>
              </Card>
            )}

          {gameState.player.identifiedShips.flatMap(ship => ship.weapons).map(weapon => {
            if (!weapon) return null;
            const spec = WEAPON_SPECS[weapon.type as keyof typeof WEAPON_SPECS];
            if (!spec) return null;
            const charge = weapon.ammoCharge || 0;
            const energySources = getPoweredComponentEnergySourcesCount(gameState.player.board, weapon.id);
            const isEnergized = energySources >= spec.energyCost;
            const isReady = charge >= spec.ammoCost && isEnergized;

            return (
              <Card key={weapon.id} className={`p-3 mb-2 ${gameState.selectedWeaponId === weapon.id ? 'border-accent' : ''} ${!isEnergized ? 'opacity-50' : ''}`}>
                 <div className="flex justify-between items-center">
                   <p className="font-semibold">Weapon {weapon.type.replace('weapon', '')}</p>
                   <div className="flex items-center gap-2">
                    {!isEnergized && <Zap className="w-4 h-4 text-yellow-500" />}
                    <Badge variant={isReady ? 'default' : 'secondary'}>{isReady ? 'Ready' : 'Charging'}</Badge>
                   </div>
                 </div>
                 <Progress value={(charge / spec.ammoCost) * 100} className="my-2 h-2" />
                 <div className="flex justify-between text-sm text-muted-foreground mt-1">
                    <span>Ammo: {charge} / {spec.ammoCost}</span>
                    <span>Energy: {energySources} / {spec.energyCost}</span>
                 </div>
              </Card>
            )
          })}
        </div>
        <Button onClick={endTurn} variant="destructive">End Turn</Button>
      </div>
    )

  }

  return (
    <div className="min-h-screen bg-background text-foreground p-4 sm:p-6 lg:p-8 flex flex-col items-center">
      <header className="w-full max-w-7xl flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          <Rocket className="w-8 h-8 text-accent" />
          <h1 className="text-3xl sm:text-4xl font-headline font-bold text-primary-foreground">
            Nebula Clash
          </h1>
        </div>
        <Button onClick={resetGame} variant="outline" size="sm">
          <RotateCcw className="mr-2 h-4 w-4" />
          New Game
        </Button>
      </header>

      <main className="w-full max-w-7xl flex flex-col lg:flex-row gap-8">
        {/* Game Boards */}
        <div className="flex-grow grid grid-cols-1 md:grid-cols-2 gap-8">
          <Card className="bg-card/50 backdrop-blur-sm border-primary/20">
            <CardHeader>
              <CardTitle className="font-headline text-2xl text-center text-primary-foreground">Your Fleet</CardTitle>
            </CardHeader>
            <CardContent>
              <GameBoard
                board={gameState.player.board}
                ships={gameState.player.identifiedShips}
                onCellClick={(row, col) => handleCellClick(row, col, 'player')}
                isPlayerBoard={true}
                selectedWeaponId={gameState.selectedWeaponId}
                allocationMode={gameState.allocationMode}
                selectedResource={gameState.selectedResource}
              />
            </CardContent>
          </Card>
          <Card className="bg-card/50 backdrop-blur-sm border-primary/20">
            <CardHeader>
              <CardTitle className="font-headline text-2xl text-center text-primary-foreground">Enemy Territory</CardTitle>
            </CardHeader>
            <CardContent>
              <GameBoard
                board={gameState.ai.board}
                ships={gameState.ai.identifiedShips}
                onCellClick={(row, col) => handleCellClick(row, col, 'ai')}
                isPlayerBoard={false}
                debug={gameState.debug}
              />
            </CardContent>
          </Card>
        </div>

        {/* Control Panel */}
        <div className="w-full lg:w-80 flex-shrink-0">
          <Card className="bg-card/50 backdrop-blur-sm border-primary/20">
            <CardHeader>
              <CardTitle className="font-headline text-2xl text-center text-primary-foreground">Status & Controls</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {gameState.winner ? (
                <div className="text-center p-4 rounded-lg bg-secondary">
                  <p className="text-2xl font-bold text-accent font-headline">
                    {gameState.winner === "human" ? "Victory!" : "Defeat!"}
                  </p>
                  <p className="text-muted-foreground mt-2">
                    {gameState.winner === "human"
                      ? "You have conquered the nebula."
                      : "Your fleet has been destroyed."}
                  </p>
                  <Button onClick={resetGame} className="mt-4 w-full">
                    Play Again
                  </Button>
                </div>
              ) : (
                <>
                  <div className="text-center p-4 rounded-lg bg-secondary">
                    <p className="text-lg font-semibold font-headline">
                      {gameState.turn === "human" ? "Your Turn" : `Enemy's Turn`}
                    </p>
                    <p className="text-muted-foreground mt-1 h-5">
                      {gameState.message}
                    </p>
                  </div>

                  {renderPlayerControls()}
                </>
              )}

              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="bg-secondary p-2 rounded-md">
                    <p className="text-sm text-muted-foreground">Difficulty</p>
                    <p className="font-semibold capitalize">{gameState.settings.difficulty}</p>
                </div>
                <div className="bg-secondary p-2 rounded-md">
                    <p className="text-sm text-muted-foreground">Board Size</p>
                    <p className="font-semibold">{gameState.settings.boardSize}x{gameState.settings.boardSize}</p>
                </div>
              </div>
               <Button onClick={toggleDebugMode} variant="outline" size="sm">
                <Bug className="mr-2 h-4 w-4" />
                Toggle Debug
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
