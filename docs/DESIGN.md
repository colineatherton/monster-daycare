# Monster Daycare

*A game by Wren.*

You run a daycare for baby monsters. Monster parents drop their little ones off in the
morning and collect them at home time. In between, it is you, a room full of tiny
monsters, and whatever they each decide they need.

Most of them are ordinary baby monsters. Some of them are **anomalies**.

## The feeling we are going for

Busy, funny, and then suddenly frightening. Ninety percent of the game is sweet chaos —
a baby wants a bottle, another one is crying, somebody wants a teddy. Then one of the
babies with a wrong shadow starts getting hungry, a countdown appears, and the whole room
changes mood.

That switch is the game. Everything below exists to make that switch land.

## The loop

1. **Drop-off.** A monster parent comes through the door and leaves a baby. The parents
   are much bigger than the children. You get a look at the baby as it arrives — and that
   look is where you decide *is this one an anomaly?*
2. **Needs.** Every baby wants things, over and over, all day. A thought bubble over its
   head shows what it wants right now, and a baby that wants something stops wandering and
   turns to look at you.
3. **Click and choose.** Click a monster and a little menu opens: pick it up, hold its
   hand, give it a cuddle, or hand over whatever you are carrying. Choose one and you walk
   over and do it.
4. **Home time.** The parents come back. Happy baby, happy parent, you get paid.
5. **Next day.** More babies. More anomalies.

## How you actually play it

Clicking is the whole interface. You click a monster or a piece of furniture, a menu opens
next to it, and picking something from that menu sends you walking over to do it. You can
also walk yourself with the keys, and walking cancels whatever the menu set going.

**The menu on a baby:**

- Give it *whatever you are carrying* (only when your hands are full)
- Give it a cuddle
- Hold its hand (it follows you around until you let go)
- Pick it up / Put it down

**The menu on the furniture:** the fridge has five foods and two drinks, the toy box has
three toys, the nap corner has blankets. You carry one thing at a time.

## What baby monsters need

| Need | What they want | Where you get it |
| --- | --- | --- |
| 🍽️ Hungry | food | the fridge |
| 🍼 Thirsty | a bottle | the fridge |
| 😴 Sleepy | a blanket | the nap corner |
| 🧸 Bored | a toy | the toy box |
| 😢 Sad | a cuddle — no object, just get there | you |

**Fussy eaters.** Not every baby eats the same thing. Nibbles only eats socks. Pudding
only eats sweet things. Give a baby the wrong food and it gets *crosser*, not happier.

This works the same way ingredients work in Wren's Kitchen: every item carries little
labels, every fussy baby wants one particular label, and the game just checks whether they
match. It means every new food we invent works with every monster for free.

Fussiness is about food only. A baby that could never be given a drink it liked would just
be a dead end.

## Anomalies

This is the heart of it. There are two kinds, and they are different in what they look
like *and* in what happens if you are late.

**They look wrong, and it is easy to see.** No guessing games, no squinting. You can tell
from across the room.

### The shadow one

An ordinary little blue monster. Perfectly normal. Except its **shadow is a horned
triangle**, and everyone else's shadow is a round blob. The body and the shadow do not
match, and that is the whole tell.

If you are late: **it breaks the door down and eats the other children.** The run is over.

### The one with the teeth

Looks like a sweet square monster with antennae, until you notice the **teeth sticking
out** — a mouth far too full of them, and two long fangs at the corners.

If you are late: it breaks the door down, but it does *not* eat anybody. It **floats up
into the air and performs a ritual**, and it turns into the spiky triangle from the
drawing. Everyone has to go home. The run is over.

### The one minute rule

When an anomaly has a need, a countdown starts. Sixty seconds. The game makes absolutely
sure you know:

- a big red timer at the top of the screen
- the room darkens, more and more
- a red glow under the anomaly, pulsing faster as it runs down
- the door it is going to break starts rattling

Get there in time and it is fine, it is delighted, and it pays **three times** what an
ordinary baby pays. Anomalies are worth the fear.

**Why this mechanic is good.** Everything else in the game is forgiving — a bored baby is
just a bit grumpy. The anomaly timer is the only thing that can end you, so your attention
goes to it completely, and you feel it being pulled away from everything else. A game
where everything is equally dangerous is just noise. One thing that really matters, with a
warning before it does, is much scarier.

**It is always survivable.** You always get the look at drop-off, and you always get the
full minute with warnings. Losing should feel like *I was too slow*, never *that was
unfair*.

## Who you are

You pick a skin on the front screen, both from Wren's character sheet:

- **The Teacher** — long hair, glasses, a heart on her top
- **The Robot** — a slab head on a springy segmented neck

You also name your own daycare, and the name you type sits in the corner all game.

## How a day goes

| | |
| --- | --- |
| Day 1 | two babies, no anomalies. Learn where everything is. |
| Day 2 | three babies, no anomalies. |
| Day 3 | your first anomaly, and it is the only one. |
| Day 5+ | two anomalies at once |

Starting small matters. The first anomaly should arrive when you already know the room
well enough to be *annoyed* at being interrupted.

`?day=3` on the end of the address opens straight onto the first day with an anomaly in
it, so you do not have to play two quiet days every time you want to test the scary part.

## Still to decide

- What is the daycare *for*? Is there a shop — better cots, a bigger fridge, a stronger
  door?
- Messes and the mop. The bucket is in the corner of the room already, waiting.
- Do the parents get a proper home-time scene where they judge you?
- More monsters. Every new one is free content, so this is the best thing to add.
- Does the game ever end, or does it just get harder until it eats you?
- Sound. There is none yet.

## How it is built

3D, in the browser, same toolkit as Wren's Kitchen: three.js with every monster built out
of plain shapes at runtime, so there are no drawings to load and a new monster is a few
lines of code.

### Build order

1. ~~A room you can walk around~~ ✅
2. ~~One baby monster with one need you can answer~~ ✅
3. ~~The rest of the needs, and thought bubbles~~ ✅
4. ~~Parents dropping babies off, and a day that ends~~ ✅
5. ~~Anomalies: the tells, the timer, the darkening room~~ ✅
6. **Fussy eaters** ✅ — and now as many monsters as we can think of.

Next: messes and the mop, a shop to spend coins in, and sound.
