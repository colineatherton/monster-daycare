# Monster Daycare

A 3D game by Wren. You run a daycare for baby monsters. Their parents — who are enormous —
drop them off in the morning, and all day the little ones get hungry, thirsty, sleepy,
bored, sad, or they want to sit down with the crayons.

They tell you exactly what they want: a hungry one asks for *crisps*, with a picture of
crisps over its head. Click a monster and a menu opens — pick it up, hold its hand, give
it a cuddle, hand over whatever you are carrying, take the picture it has drawn you. Pick
one and you walk over and do it. Food comes from the fridge, toys from the toy box,
blankets from the nap corner, crayons from the colouring table. You carry one thing at a
time, and some of them are fussy — one only ever asks for socks.

At home time every parent comes back and says whether they are pleased.

**Some of them are anomalies.** One has a shadow shaped like a horned triangle while its
body is an ordinary round monster. One has far too many teeth. They need looking after
like anybody else, but when an anomaly wants something you get **sixty seconds**. The
timer appears, the room goes dark, a heartbeat starts up and the door begins to rattle.
Make it in time and it pays triple.

Miss it and the toothy one rises into the air and begins a ritual — and you get one last
chance, because what it really wants is its nappy changing. The other one does not give
you a second chance.

The first anomaly does not arrive until day 3, by which time you know the room well enough
to be annoyed at being interrupted.

## Install and run

Requires Node 20 or newer.

```bash
npm install
npm run dev
```

Then open the address it prints (http://localhost:5173 by default).

```bash
npm run build     # typecheck + production build into dist/
npm run preview   # serve the production build
npm run lint      # oxlint
```

Everything runs in the browser. No backend, no accounts, and no asset files — every
monster is built out of three.js spheres and boxes at runtime.

## How to play

| | |
| --- | --- |
| `W A S D` or the arrow keys | walk |
| click a monster or a cupboard | open its menu |
| click a menu item | walk over there and do it |
| the Music button | turn the sound off and on |

Walking yourself cancels whatever the menu sent you off to do.

Add `?day=3` to the address to start on the first day that has an anomaly in it, instead
of playing two quiet days to get there.

## Where things are

```
docs/
  DESIGN.md            the game as Wren described it, and what is left to build
  drawings/            her original character sheet
src/
  game/
    config.ts          every number worth fiddling with: speeds, timers, the fuse
    DaycareWorld.ts    the scene, the loop, and click -> menu -> walk -> do
    types/game.ts      the vocabulary of the whole game in one page
    audio/music.ts     the tune, the chime, the buzz and the heartbeat
    data/
      items.ts         food, drink, toys, crayons, and the labels fussy babies check
      species.ts       the monsters, straight off the character sheet
    render/
      three-helpers.ts primitives, a material cache, room units -> world units
      monsters.ts      baby monsters, both anomaly tells, and the ritual form
      player.ts        the Teacher and the Robot skins, and the parents
      room.ts          floor, walls, door, fridge, toy box, cots, colouring table
      items.ts         what you are carrying
      labels.ts        thought bubbles and name tags, drawn on a canvas
    input.ts           keyboard state, read by the loop
    bus.ts             one-way channel from the loop to React
  components/
    GameCanvas.tsx     mounts and tears down the 3D world
    GameHUD.tsx        the pills, the roster, the click menu, the big red timer,
                       and the home-time card where the parents give their verdict
  App.tsx              front screen: name your daycare, pick a skin
```

### The files worth reading first

1. **`src/game/types/game.ts`** — the whole vocabulary on one page.
2. **`src/game/data/species.ts`** — the monsters and which of them are wrong.
3. **`src/game/config.ts`** — `ANOMALY.fuseMs` is the sixty seconds everything hangs on,
   and `ANOMALY.ritualMs` is the nappy-changing grace period after that.
4. **`src/game/DaycareWorld.ts`** — `giveNeed()` decides what a baby asks for, `menuFor()`
   decides what you can do to a thing, `performPending()` does it, and `erupt()` is what
   happens when you are too late.

### Coordinates

Game logic works in flat "room units" (a 1000 × 680 floor plan) because that is what
walking and collision need. The renderer maps those onto the 3D ground plane: room x
becomes world x, room y becomes world **z**, and world y is height. That mapping is three
one-line functions in `render/three-helpers.ts` (`kx`, `kz`, `ku`).

### Making it easier or harder

Everything is in `src/game/config.ts`. If the sixty seconds is too tight, raise
`ANOMALY.fuseMs`. If the babies ask for things too often, raise `BABIES.needGapMs`. If
they lose their tempers too fast, raise `BABIES.patienceMs`. If the ritual is impossible
to reach in time, raise `ANOMALY.ritualMs`.
