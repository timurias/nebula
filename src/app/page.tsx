
"use client";

import { useNebulaClash } from "@/hooks/use-nebula-clash";
import GameBoard from "@/components/game-board";
import SetupDialog from "@/components/setup-dialog";
import ShipPlacementPanel from "@/components/ship-placement-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Rocket, Dices, RotateCcw, CheckSquare } from "lucide-react";

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
  } = useNebulaClash();

  if (gameState.phase === "setup") {
    return <SetupDialog onStartGame={startGame} />;
  }

  const isSetupPhase = gameState.phase === 'setup';

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
                onCellClick={(row, col) => handleCellClick(row, col)}
                isPlayerBoard={true}
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
                onCellClick={(row, col) => handleCellClick(row, col)}
                isPlayerBoard={false}
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
                      {gameState.turn === "human" ? "Your Turn" : "Enemy's Turn"}
                    </p>
                    <p className="text-muted-foreground mt-1 h-5">
                      {gameState.message}
                    </p>
                  </div>

                  {gameState.placingShips && (
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
                  )}
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
                 <div className="bg-secondary p-2 rounded-md col-span-2">
                    <p className="text-sm text-muted-foreground">Fleet Points</p>
                    <p className="font-semibold">{gameState.player.points} / {gameState.settings.initialPoints}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
