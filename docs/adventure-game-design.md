<!--
  THE GAME'S RULES. The source of truth for what Thockquest IS; its sibling
  docs/adventure-platform.md is the source of truth for how the platform
  underneath is BUILT. They do not overlap.

  The body below is the design plan as authored, unedited. An OLDER version
  of it once lived here, was deleted by 5523f8f as if it were a point-in-time
  record, and was briefly restored before this one replaced it -- that older
  text described five stats and a different stat table, and reading it as
  current produced two "the code contradicts the design" findings that were
  nothing of the kind. If a rule here and the code disagree, check which
  version you are holding before believing either.

  Where CONVERSATION has since moved a rule on, it is recorded under
  "Deviations settled since" at the foot -- never by editing the plan's own
  prose, so the two can always be told apart.

  Open questions live in ONE place: adventure-platform.md's numbered list.
-->

# Thockquest Design Plan

## Introduction

Thockquest is a minigame integrated into the editor that is based around the game's revolving escape menu.

## Integration

Thockquest lives entirely within the "Escape Menu" and can be toggled in the active slot by right clicking the user guide button.

The game is entirely based on presenting the user with choices selected via the Escape Menu. Selecting a choice does not close the menu as in regular interaction. Only the escape button does.

The game's narration is displayed in the chapter bar. After each selection, a brief description explains the outcome in the chapter bar. In the format **[action taken]:** *Description*. The action take is printed in bold, the outcome in italic. Any numbers in the description are shown bold and italic.

The players stats are shown in the tab bar above the editor in the following format:
[fa-heart][health] | [fa-hand-fist][Might] [fa-wind][Agility] [fa-eye][Perception] [fa-brain][Intellect] [fa-lips][Charisma] [fa-clover][Luck] | [fa-coins][Gold] [fa-book][motes of experience] [fa-up-long][motes till next stat point] [fa-star][acquired stat points] [fa-trophy][fame]

## Gameplay Loop

The game takes place in levels. Each level has a predetermined number of encounters, ends in a boss encounter and has a number of mini boss encounters on the way there. The regular encounters are started when the user selects "Go hunting", "Go exploring" or "Special encounter".

The game tracks stats. These are base stats that carry over from level to level. The user can select a stat point for every n motes of experience they collect where n = 10 + 5*[total acquired stat points]. Items can be acquired at the beginning of levels, as loot after combat and in other events. It can can grant major boosts and lead to a more dramatic change in stats as the user progressed through one level. The user can pick one piece of gear to keep at the end of each level (not cumulative). The user can also acquire traits while adventuring. At the end of each level, they can choose one trait to keep (not cumulative).

Throughout the game the user collects motes of experience, pieces of gold and fame, the latter being the score the user tries to beat on a run. Fame is gained through each defeated mini boss and boss. Motes of experience and pieces of gold are awared as quantized units and determine how you start the next level. At the beginning of each level, the player can exchange motes of experience for traits and pieces of gold for items. These are selected from a random offering in the circle menu. The amount of selections offered depends on user stats. Items and traits are only in effect for one level, except for the permanently selected ones.

## Stats

All stats are capped at 6 before item gains. Stat checks are rolled against a Difficulty Rating (DR) +  D6. If the user's stat matches or exceeds the rolled number, the check is passed. Apart from checks, the stats also have these added effects:

- Might
   - Hit Points: 50 + 15*Resilience
   - Damage Multiplier: 50% + 15%*Might
- Agility
   - Chance to dodge: 50% + 5%*Agility
   - Number of actions = 2 + Agility/2
- Perception
   - Number of encounter choices each step = 2 + Perception/2
   - Chance to hit: 50% + 5%*Perception
- Intellect
   - Unlocks spells (see combat)
- Charisma
   - Unlocks charisma based actions (see combat)
- Luck
   - Number of selection choices for items and traits = 2 + Luck/2
   - Chance for double damage (crit): 20% + 10%*Luck

## Encounters

### Go Hunting
Selection of Monsters
- Classes (determines health and damage modifiers, special actions, number of actions and loot)
   - Fighter
   - Mage
   - Thief
- Types
   - Normal
   - Elite (increased percentage modifier to health, damage, actions and loot)
   - Group (reduced percentage modifier to health, damage, actions and loot, but multiple monsters)
- Races (additional modifiers and special actions)
   - ...

### Go Exploring
Selection of Areas (each have unique encounters to be determined)
- Swamp
- Forest
- Plains
- Mountains

### Chance Encounter
Selection of Encounters (to be determined)
- Trader
- Distress
- Bard
- Pet

## Combat

### Combat Encounter Structure
- Combat round start menu with tactical choices
   - Only one choice as a placeholder: Begin combat
   - After a choice has been taken, all actions are set to their maximum (see combat rounds) and combat starts.
- Combat round starts
   - Player and monster take actions, affecting their health and potentially loot outcomes
   - Effects carry over into the next round if there is one
- Combat round ends when
   - player has been defeated,
      - Result: Game Over Menu
   - all monsters have been defeated
      - Result: Loot Menu
   - all actions have been used
      - Result: Combat round start menu
- Loot Menu with selections
   - Gold (1 piece) + Mote(s) of experience (# depend on encounter)
   - Item (choices depend on luck) + Mote of experience(s) (# depend on encounter)

### Combat rounds
   - every monster and player each have a number of actions
      - Chance for player to take an action = player_actions / (player_actions + monster actions)
      - If the player doesn't take an action, the monster does
      - after taking an action, the number of available actions drops by one
   - Monster actions
      - Attack
         - On each attack the monster makes, the player has a selection of defensive choices
         - The likelihood of a choice appearing is calculated based on the stats
         - Multiple choices can be available (only dodge at the moment, but more are to be added)
         - On a choice, depending on a stat check, a bonus may become available.
         - Even if there is only one choice available, the player selects it because the selction also serves as a feedback for the player
      - Special Attack
         - same as attack
      - Flee
         - choice of pursuit based on agility
      - Talk
         - choice of negotiation actions based on charisma
   - Player actions
      - Attack
      - Special Attack
      - Charisma Actions
      - Spells

### Special Attacks
- Trait unlocked
- Item unlocked
- Stat unlocked (# of uses per combat = stat/unlock level)
   - Might
      - 2: Haymaker (+100% damage -20% chance to hit)
      - 3: Stomp (AE damage for 50% and stun: -1 monster action)
      - 5: Second Wind (return player health to full)
   - Perception
      - 2: [to be determined]
      - 3: [to be determined]
      - 5: [to be determined]
   - Agility
      - 2: [to be determined]
      - 3: [to be determined]
      - 5: [to be determined]
   - Luck
      - 2: [to be determined]
      - 3: [to be determined]
      - 5: [to be determined]

### Charisma Actions
- Unlocked  based on Charisma (Chance to fail = Tier * [number of uses this combat] / Charisma)
- Spell-List
   - Tier 0 
      - Plead (all enemies lose 1 action)
   - Tier 1
      - Suggest (forces a single enemy's next action to be "talk")
   - Tier 2
      - Taunt (forces enemy to attack only for the rest of the round)
   - Tier 3
      - Confuse (the enemy's next attack will target itself or a friend)
   - Tier 4
      - Terrify (forces enemies to flee, with reduced loot options)
   - Tier 5
      - Overwhelm (forces enemies to surrender, leaving full loot)
   - Tier 6
      - Command (a single enemy joins your ranks and fights for you until it dies)

### Spells
- Learned at the beginning of a level based on Intellect
   - Total spell picks = 2*Intellect
   - Max spells per tier = Intellect - Tier
- Spell-List
   - [to be determined]

---

## Deviations settled since (not part of the plan above)

Decisions taken in conversation after this plan was written. The plan's own
text is left as authored; this is what has moved.

- **Resilience** in the hit-point formula is a leftover. Physical attack and
  physical defence are one stat — Might — which is why the formula is written
  under Might while naming Resilience. There is no seventh stat.
- **Stat points and fame points are spendable at any time**, not only at a
  level's end.
- **Fame is the stat-point ladder fed by gold**, on identical numbers:
  `10 + 5 × points spent`, so 10, 15, 25, 40, 60, 85 … Gold earned drives
  fame points exactly as experience earned drives stat points
  (`model/milestones.ts`).
- **A miss is the least fun thing in the game, and a dodge is one of the most.**
  Both are "nothing happened", and they are not the same event to a player: a
  miss is the game refusing an action they took, and a dodge is an action of
  their own working. Equal hit and dodge chances therefore do not read as
  balanced, they read as flat. This is the reason the knob below is shaped the
  way it is rather than as a damage or hit-point dial.
- **THE THUMB ON THE SCALE** (`successAdjust`, 0…1) scales a player's chance
  to FAIL and a monster's chance to SUCCEED:

      player:  1 − (1 − p) × (1 − t)
      monster: p × (1 − t)

  Both sides keep reading the same stat table, the same contested formulas and
  the same rules, so a point of Agility is worth what it was worth and two
  characters cannot change places — the thumb moves them both. It pushes the
  player toward landing blows AND toward dodging, which is exactly the pair of
  outcomes that feel like agency. Applied at the roll, never folded into what
  a character is worth; fixed on a run when the run starts.
- **A RUN CARRIES THREE OF EACH KIND**, and a fame unlock may later raise it.
  At the limit, taking something new is not refused — it is a CHOICE about
  what to give up, asked in the ring, and nothing is paid or taken until it is
  answered. That holds at every acquisition: loot, the trader, the Oracle.
- **THE OUTPOST stands between the road and the level**, and only while there
  is something to spend: ten of either currency. Three doors — the trader
  (items, for gold), the Oracle (traits, for motes), and *move to camp*, which
  gets on with the level. Each shop lays out **six**, each costs **ten**, and
  the player buys until the purse cannot pay. A door that cannot be paid for,
  or whose table is bare, is not offered at all.

  The stock is the OUTPOST's, rolled once per visit: leaving one door and
  opening the other — or the same one again — finds the table it left, less
  what was bought. Since the road comes before any earnings on level one, the
  outpost is first seen at the start of level two.
- **A RUN HOLDS ONE OF EACH THING, EVER.** Duplicates do not exist: every
  effect a modifier carries is declarative, so a second copy is not a second
  object, it is the same one applying twice. Nothing offers what is already
  held, and acquiring it again does nothing.
- **WHAT SURVIVES A LEVEL is marked on the strip**, whose pills are toggles.
  The number that survives is an ALLOWANCE — one item and one trait today,
  and a fame unlock is expected to raise it, which is why it is a rule the
  code asks for rather than a "one" written into the level's end. Pressing a
  marked pill clears it; pressing an unmarked one when the allowance is full
  drops the oldest mark to make room, so at an allowance of one a press moves
  the choice, and at any larger one a set can be rearranged without emptying
  it first.

  **Fewer marks than the allowance is the ordinary case, not an empty state**:
  the rest is filled with the most recently acquired, because those are the
  ones the player has had least use out of. So exactly `min(allowance, held)`
  pills are lit per kind at all times and every one of them is true. The marks
  are spent when the level ends, so the next level's default is its own newest
  finds.
- **Hit points are the BUDGET FOR ONE LEVEL.** They wear down encounter by
  encounter with nothing to restore them, and they are reset when the level
  ends — each level is its own journey (which is why a new region is chosen
  for each), and the player rests up between them. Already built: `advanceLevel`
  refills to maximum, in the same place armor is rebuilt from what is held.
- **Healing is DEFERRED, not ruled out.** Recovery makes the balance hard to
  read: every question about how long a run should last gets two answers at
  once, and the ones that matter now are about damage, actions and armor.
  So the order is — get the balance right with no healing at all, then
  introduce healing and equally punishing new damage sources TOGETHER, as one
  layer balanced against itself. In total that layer should barely move the
  baseline: a tightly managed system that balances to zero, whose point is to
  make the player find a way to absorb swings without going into overdraft.
  Nothing in the effect vocabulary can heal today, deliberately, so that layer
  arrives as a decision rather than by accident.
- **CHANGING MAXIMUM HIT POINTS IS NOT HEALING, as long as current moves with
  it.** Raising the maximum and the current together restores nothing that was
  lost and leaves the equation readable. The two directions are one rule:

  - Raising the maximum WITHOUT raising the current would be *taking damage*
    equal to the delta, so the grant is not optional.
  - Lowering the maximum lowers the current with it.

  Built as `followMaxHitPoints`, applied around every effect rather than in
  the branches that happen to change a maximum today.

  The falling case is only PLANNED for one moment — the end of a level, where
  items and traits are given up. **Restore the player's hit points first, then
  remove them**, so the fall lands on a full pool rather than driving a
  depleted one negative and tripping something that reads a hit-point total as
  a death.
- **Temporary hit-point changes, if they ever arrive, get their own ruleset** —
  likely leaving the player at 1 rather than killing them. Nothing about them
  is decided; they are named here so the rule above is not later assumed to
  cover them.
- **Monsters grow stronger per LEVEL, not per combat round.**
- **A combat round** is one unit of combat: from all parties holding all
  their actions to all parties having spent them, after which the counts
  reset. It is what makes Agility's action count mean anything.
- **Every action in a round is a ring choice**, whichever side owns it. On a
  player action the ring offers offensive choices (attack, special attack,
  charisma actions, spells); on a monster action it offers the player's
  reactive ones (dodge, flee, defend). The total choices a player makes in a
  round is therefore the combined action count of every party in it.
- **Icons.** `fa-lips` (charisma) is Font Awesome Pro and does not exist in
  the free set shipped here — `fa-masks-theater` is used instead. Agility is
  `fa-feather-pointed` rather than `fa-wind`.
- **The tab bar carries armor** (`fa-shield-halved`), which the plan's status
  line does not mention, as `items(natural)` — two pools that behave
  differently, so never their sum.
- **Gold and motes left the tab bar** for the stats row below the editor,
  beside the item and trait pills they buy.

### Monsters

- A monster has **base stats**, from its CLASS, on the same scale the player's
  origins use. The player origins' bases stand in for now.
- Its **type** shifts every base stat by a flat amount, and type is orthogonal
  to class — a mini boss or a boss is a random class carrying that type:

  | type | base stats |
  | --- | --- |
  | Group | −1 |
  | Regular | 0 |
  | Elite | +1 |
  | Mini boss | +2 |
  | Boss | +3 |

- Derived stats come off those base stats the way the player's do, and are
  then scaled by a **power multiplier of `factor^level`** — easy 1.02, normal
  1.05, hard 1.1, insane 1.2.
- The player's edge is meant to come from ITEMS AND TRAITS and from
  leveraging them well, not from out-statting a monster.

### Damage

- The damage multiplier applies to a **universal base damage of 10**, both
  sides. One parameter, expected to be tuned.

### Contested stats

Every stat check is made RELATIVE to the opposing stat, not against a fixed
number. Each stat has a counter:

| stat | countered by |
| --- | --- |
| Might | Might |
| Agility | Agility |
| Perception | Luck |
| Luck | Perception |
| Charisma | Intellect |
| Intellect | Charisma |

The **delta** (mine − theirs) is added to my side of the check. A player with
Agility 3 dodging a monster with Agility 5 has `50% + 5%×(3−5)` = 40%.

### A combat round

- Every party has a number of actions; at the start of a round they are all
  restored to maximum.
- Whose action it is: `player_actions / (player_actions + monster_actions)`,
  rolled per action. If it is not the player's, it is a monster's. The chosen
  side's remaining count drops by one.
- **Every action in the round is one ring choice for the player**, whichever
  side owns it: on the player's action the ring offers offensive choices, on
  a monster's it offers the player's reactive ones.
- The round ends when every action has been spent → the round-start tactical
  menu. Combat ends when the player is defeated (→ game over) or every
  monster is (→ loot).
- "For the rest of the round" means until every action point has been spent.
  Stomp reduces the CURRENT monster action pool by 1 — there is no duration
  model behind it.

### Offensive actions

Attack only, for now.

Every player attack draws a **hidden defensive choice from the enemy**, from
the same set the player picks from. The enemy takes the best outcome.

### Defensive choices

Offered to the player when a monster acts.

- **Dodge** — appears only if the contested Agility check passes, so it is
  offered with probability `50% + 5%×(agility delta)`. Taken, the attack does
  not land.
- **Defend** — always offered. Damage is reduced by armor, and the armor
  decay check applies. The attack may still miss.
- **Flee** — no armor reduction, and the attack may still miss. Ends the
  encounter unless the enemy passes a contested Agility check to pursue,
  `50% + 5%×(agility delta)`.
- **Take the hit** — the enemy's chance to miss drops to zero. Damage lands
  in full, with no armor check.

**Armor** (an extension to the plan, not in its body) lives here: two pools,
`fromItems` which decays as it absorbs and `natural` from traits which decay
cannot touch. It applies on **Defend** and nowhere else.

### A group is one hydra

A group is fought as a SINGLE monster with a shared pool: hit points and
actions are one member's times the head count, and one blow is still one
member's blow — a group hits more often, not harder.

The pool divides into as many equal bands as there are members. Each band the
cumulative damage crosses costs the group **one member's worth of actions**,
taken off whatever is currently left and floored at zero. That is
deliberately biased toward the player: the member that just fell is assumed
to be the one who would have acted LAST, so killing it takes actions the
group still had rather than actions it had already spent.

The head count is content, per encounter; an encounter that does not name one
gets **three**.

### What a monster does when attacked

Dodge if the contested check offers it, otherwise defend. The ordering is
total, so there is no judgement in it.

**A monster never decides to flee.** Fleeing is a state the player puts it
in — a successful Terrify, or a talk event that checks Charisma — and if it
is available the monster takes it. A monster that could run on its own would
make Terrify meaningless, since it would already be doing the thing Terrify
is for. The chance on those is `50% + 5%` per point of the contested stat,
like everything else, until it is tuned.

### What a won encounter pays

A LOOT SCREEN offers a choice between **one piece of gold** and **an item**
(with as many items to pick from as Luck allows, `2 + Luck/2`).

How many loot screens there are is one escalating check, run after the fight:
a base of **50% + 5% per point of Luck**, and every repeat is **fifty points
worse** than the one before, until one fails. The monster's TYPE raises the
starting chance, past certainty on purpose. At Luck 0 the run of chances is:

| type | chances, in order | screens guaranteed |
| --- | --- | --- |
| group, regular | 50% | 1 |
| elite | 100%, 50% | 2 |
| mini boss | 150%, 100%, 50% | 3 |
| boss | 200%, 150%, 100%, 50% | 4 |

MOTES OF EXPERIENCE work the identical way, one procedure with one number
changed: one mote is automatic, and the extras are the same escalating check
against **Intellect** instead of Luck, with the same type bonus. They are
awarded **after every loot screen has been through**, as the player returns
to encounter selection — what you found, then what you learned.

### What an encounter pays, by how it ended

The amounts above are the win. The shape of the rest:

| how it ended | gold | experience | loot menu | spends an encounter |
| --- | --- | --- | --- | --- |
| monsters defeated | 1 | the encounter's | yes | yes |
| the MONSTER fled | 1 | the encounter's, in full | no | yes |
| the PLAYER fled | — | — | no | **yes** |
| the player was defeated | — | — | no | — |

A monster that ran still pays: you beat it, you just did not get to search
it. One gold is not a special case for that — the loot menu's gold branch is
one piece too, so a flight pays exactly that branch with no choice offered.

The player's own flight pays nothing and **still spends one of the level's
ten**, which is what makes running a decision rather than a free reroll.

### A level's layout, and what it offers

Ten encounters. Encounters 5 and 9 are mini bosses; encounter 10 is the boss.
At those three there is **no choice** — the encounter is the encounter. The
rest are chosen from `2 + Perception/2` offers.

The **first** offer is always a random species at REGULAR rank, so no reading
of the dice opens a level with a choice between three packs. Every further
offer is drawn at random from the three offerable ranks — group, regular,
elite — and must be a combination not already on the list. Mini boss and boss
are placed, never rolled.

Uniqueness is by **class and rank**, and deliberately not by species as well.
The rule is there to make the list varied, and three regular warriors from
three species is the same fight three times wearing different names.

### Species

A monster is a SPECIES, a CLASS and a TYPE. The class supplies base stats (the
three fighting classes, on the player origins' own scale — warrior, thief,
mage); the species adds its own modifiers and decides what the thing is
CALLED at each rank, and which classes it may be there. A rank may have
several forms — a beast group is wolves or boars, and which it is settles the
name and the class together.

| species | modifiers |
| --- | --- |
| Goblin | +2 Luck, −1 Might, −2 Charisma, +1 Agility |
| Orc | +2 Might, −1 Intellect, −2 Charisma, +1 Perception |
| Beast | +2 Perception, −3 Intellect, +1 Agility |

| | group | regular | elite | mini boss | boss |
| --- | --- | --- | --- | --- | --- |
| Goblin | Band of Goblins *(thief)* | Goblin *(any)* | Goblin Veteran *(any)* | Goblin Chieftain *(warrior)* | Goblin Lord *(mage)* |
| Orc | Pack of Orcs *(warrior)* | Orc *(any)* | Orc Brute *(warrior)* | Orc Squad Leader *(mage)* | Orc Demon *(warrior)* |
| Beast | Pack of Wolves *(thief)* / Pack of Boars *(warrior)* | Large Wolf *(thief)* / Large Boar *(warrior)* | Dire Wolf *(warrior)* / Enraged Boar *(warrior)* | Dire Bear *(warrior)* / Shadow Stag *(mage)* | Hulking Grizzly *(warrior)* |

### How narration is written

`**[what you did]:** *what happened*`, with any number in the description
**bold and italic** — which is `**8**` INSIDE the italic run, nesting, rather
than a mark of its own. Two marks, and deliberately not Markdown: this text
sits in a pill on a bar one line high, so a heading or a list would have
nowhere to be. An unmatched mark stays a literal asterisk.

### A run sets out whole

A new game's hit points are derived before any stat exists, so they start at
the floor of `50 + 15 × Might` with no Might. Character creation then raises
the maximum without raising the current, which put a warrior into their first
fight at 50 of 80. Creation now ends by restoring hit points to full.

### Names

"Special Encounter", "Charisma Actions", and **Region** for the level's
opening choice. Go Exploring's destinations are areas within a level.

**"Special Encounter" is superseded.** The hub cell of that name was removed
rather than built: what it would have been became the omen, which arrives on
its own before each of the three fixed encounters instead of being a way to
go looking for one. The open-encounter screen now offers Go Hunting and Go
Exploring and nothing else. "Charisma Actions" and **Region** stand.

### What the PLAYER is, is an ORIGIN — "class" is the monster's

The plan uses both words for the player ("Classes" in the loop, "the player
origins" under monsters). Settled: **origin**, everywhere the player is
meant. **Class** stays the MONSTER axis — warrior, thief, mage, what a
monster fights like — which is the plan's own use of it under Encounters, and
is otherwise held free.

### "Fame unlock" is called a fame PURCHASE in the code

The plan's term is kept in this document, where it is the author's. The code
reserves "unlock" for the permanent unlocks a run EARNS and calls what fame
BUYS a purchase, because the two were otherwise one word for two lists that
outlive each other differently (`model/famePurchases.ts` against
`model/permanentUnlocks.ts`).

### Rounding

Down, wherever a rule produces a fraction — including a special attack's
`stat / unlock level` uses.

### What the power multiplier touches

Hit points and damage, and nothing else. Not the chances — `factor^level` on
a 0..1 chance saturates rather than scales, and a monster pinned at 100%
dodge has stopped getting stronger and started being unhittable. Not the
action count either, for now: an extra action is a whole extra decision in
the round, a bigger step than a curve should take on its own.

It applies to MONSTERS only. The player's growth is stat points plus items
and traits.

*(Later, and not built: mobs drawing traits from a random table every five
levels or so, as an additional challenge.)*

### One derive function, opponent optional — and one chance resolver

`deriveStats(own, opponent?)`. The formulas that do not involve an opponent
ignore the argument; the contested ones subtract the opponent's counter. An
ABSENT opponent contributes **zero**, so the contested formula and the stat
table above are the same formula: `50% + 5% × (Agility − 0)` is
`50% + 5% × Agility`. There is no second function and no split return type.

Every chance in the game has that one shape — a base, a step per point, and
the stat it reads — so an action **declares** those two numbers
(`StatChance`) and hands them to one resolver rather than writing the contest
out again. Dodge is `50% + 5%` on Agility, a crit `20% + 10%` on Luck, a
pursuit `50% + 5%` on Agility, a fear attempt `50% + 5%` on Charisma.

**Might's counter is not used by the damage multiplier**, which is a
coefficient rather than a check. Might-versus-Might belongs to special
attacks and to content still to come.

### Charisma actions: the chance to fail

A base chance from the monster's TYPE, plus a term for the tier and how hard
it has been leaned on:

| type | base chance to fail |
| --- | --- |
| Group | 0% |
| Regular | 20% |
| Elite | 40% |
| Mini boss | 60% |
| Boss | 80% |

plus `Tier × uses this combat / Charisma`.

So a tier 0 action never becomes likelier to fail; at Charisma 6 a tier 2
ability adds 33% after its first use and 67% after its second; and an action
of the **highest tier a character can use** adds a full 100% after one use.

**The highest charisma-action tier a character can use IS their Charisma.**
That is the unlock rule — the plan gives one for spells and none for charisma
actions — and it is also the only value at which `Tier × 1 / Charisma` comes
to 1, which is what makes the sentence above true.

The divisor is the player's OWN Charisma, uncontested. The monster's
resistance is the type base — contesting the divisor as well would divide by
`Charisma − Intellect`, which is zero or negative whenever the monster is the
smarter one. A group never resists: crowd control works on crowds.

### The pace constraint, and what Charisma and Intellect became under it

The plan above gives Intellect "unlocks spells" and Charisma a list of
actions, and leaves both as lists to be written. What settled them was not a
list but a CONSTRAINT on the whole fight, stated by the author:

> We have to keep the game simple and fluid, like an auto battler where you
> make meaningful choices with stats, traits and items, then mostly see how
> successful your choices play out in a run. The game has countless
> consecutive rounds. This can only stay fun by keeping a high pace. We can't
> expect the player to spend 10 seconds on making a choice between dealing 2
> or 5 damage to a monster when it takes 20 attacks to bring down a monster,
> there are 10 monsters to a level and double digits of level to make it
> through.

Everything below follows from it. **The default mode for a player is attack.**
Charm-based abilities happen on their own, every round, with nothing to
choose; magical attacks arrive by chance and appear as cells already sorted so
that the first one is the right one.

**The ring, on the player's action**, in this order: the available magical
attacks from highest spell level to lowest, then Attack, then Prepare.

#### Prepare

An action that executes no attack and increases the power of the next one.
That attack gains, per point:

| stat | what a point buys the prepared attack |
| --- | --- |
| Might | +10% damage |
| Luck | +10% crit chance |
| Perception | +10% hit chance |
| Charisma | 10% chance to lower the monster's action points to zero |
| Agility | 10% chance to execute twice |

…and it also executes the highest level magical attack available to the
player, on top of its regular attack.

#### Charm effects (Charisma)

Take effect at the beginning of a round of combat and last until the end of it
(all actions spent). Several may be in effect at once. Each has a chance of
`(Charisma − effect level) / 12` to come up.

| level | effect |
| --- | --- |
| 0 | each time the monster attacks, a charm check (base 0%, scale 10%) makes it not take an action instead |
| 2 | the same check makes it attack itself instead, and always hit |
| 4 | the same check makes it die instead |

When one or more are active for a round, a single pill `[fa-masks-theater #]`
says so, `#` being how many; hovering it lists them from strongest to weakest.
When one fires, the action icon is replaced by the mask: followed by the
player icon for the first, by the damage number and the monster icon for the
second, and by the killed icon for the third.

#### Magical attacks (Intellect)

**SUPERSEDES the plan's own spell rule above** (learned at the beginning of a
level, `2 × Intellect` total picks, `Intellect − Tier` per tier). Each
magical attack has a chance of `(Intellect − level) / 12` to become
available, and when one of a given level becomes available, all lower levels
become available with it.

Magical attacks are **not mitigated by armour** — which certain monster types
have, working exactly as the player's does — and **cannot be dodged or miss**.

| level | spell | effect |
| --- | --- | --- |
| 0 | Singe | enhances a regular attack to count as a magical attack |
| 1 | Plague | the monster loses 20% of its current health at the end of every round |
| 2 | Ignite | the monster takes 10% of a regular attack in damage after every action it takes (stacking) |
| 3 | Lightning Bolt | a magical attack; then a Luck check with base chance 50% to repeat, until the check fails for the first time |
| 4 | Lightning Storm | the monster takes regular magical damage (as Singe) at the end of every round |
| 5 | Meteor Strike | the monster takes double regular damage and loses all action points for this round |

#### What the code decided, where the spec did not say

Recorded here rather than left to be inferred from the implementation, and
each is the author's to overrule:

- **The charms are rolled when the round opens; the spell hand is rolled per
  ACTION.** The spec times the charms that way and was silent on the spells.
  They were given the same timing at first, and the author corrected it: a
  round that reached Meteor reached it for every action in that round, and a
  Meteor streak is not what the chance is meant to buy.
- **Availability is uncontested; the charm check is contested.** What a
  monster's wits are worth is settled by the check that fires, so contesting
  the "is it up" roll as well would charge the player for its Intellect twice.
- **ACTIVE EFFECTS STACK** (the author's, settling it): a second Plague takes
  twice the share, a second Storm throws twice the bolt, a second Prepare
  doubles every term. Nothing is withheld for already being in effect. A
  preparation is spent by an Attack only — a spell cast while prepared leaves
  it banked — and an attack spends every one of them at once. Its rider fires
  once per PREPARATION and does not multiply with the swings: the swings are
  one action's worth of blows, the preparations are what was paid for them.
- **The bolt's chain is bounded** at ten strikes. Its repeat chance is
  contested Luck on a base of a half and reaches certainty, which would not
  terminate. A terminator, not a rule.
- **Ignite's and the lasting spells' clocks are different**: Ignite answers
  the monster's actions, Plague and the Storm answer the round.
- **Monster armour is a per-TYPE table** (0/0/1/2/3 by group/regular/elite/
  mini boss/boss), carried in the natural pool so it never decays, and not
  scaled by the power multiplier. A first pass, meant to be tuned.

#### Every pill documents its own arithmetic

A later addition by the author, and it applies to the whole bar rather than
to the charm pill it started with:

> Let's actually have tooltip info for every pill that documents the math
> briefly. Example: `Hit: [rolled]|[needed] Crit: [rolled]|[needed] Damage:
> [total] = [rolled]([min]-[max]) x [crit multiplier]` … in that spirit for
> all pills adapted accordingly for misses, dodges etc.

*(The example named a `(min-max)` a blow's damage did not then have. It does
now — see the next section, which the author added for exactly that reason —
so the line reads `Damage: 11 = 5 (4-7, best of 2) x 2 crit`, with the band
in DAMAGE rather than in shares because that is the unit the rest of the line
is in.)*

The shape, everywhere: a roll is `rolled|needed` in whole percentages, and a
sum is written with its terms. Where a glyph is ambiguous the tooltip says so
in words — a dodge and a miss share a mark, so a dodged blow says it was
dodged.

#### Damage is a range, and two stats read it

> Let's add damage ranges. From 100% - spread to 100%.
> `spread = base_spread * (6 - perception) / 6`
>
> That means spread can become negative which reverses left and right
> boundaries of the interval. The user gets one extra roll for damage per
> point of luck. The best of these rolls is picked.

A blow's nominal damage is its CEILING, not its value. **Perception** closes
the band — at the base stat cap of 6 the spread is zero and a character does
full damage every time, and past the cap the spread goes negative and the band
runs from 100% UP, so gear that carries Perception past what a run can reach
stops buying consistency and starts buying damage. **Luck** buys draws rather
than a bonus: one extra per point, best taken, so it can stop a blow landing
at the floor but can never push it past the ceiling.

**What the code decided:**

- `base_spread` is **0.5**, which the spec did not give. Named
  (`BASE_DAMAGE_SPREAD`) and tunable; at Perception 0 a blow lands anywhere
  from half its nominal to all of it.
- The pivot is **6**, the base stat cap, which is what makes "a maxed run
  does full damage" the reward rather than a coincidence.
- **It reads the ATTACKER's stats, whoever that is** — a lucky monster rolls
  its damage as many times as a lucky player. The spec said "the user",
  which may have meant the player narrowly; applying it to the attacker is
  the reading that keeps the invariant every other chance in this game holds
  to (both sides read one stat table, which is the whole reason the thumb is
  shaped the way it is). **This is the one thing here to overrule if it was
  meant the other way.**
- **A band with no width is not drawn from at all**, rather than drawn from
  and always yielding the same answer: a wasted draw moves the seeded rng
  stream, so every later roll in the run would shift for nothing.
- It applies to **attacks**, which includes every magical strike and the
  Lightning Storm's bolt ("regular magical damage, the same as Singe"). It
  does NOT apply to Plague (a share of what the monster has left) or Ignite
  (a share of a nominal): those are drips, not blows being swung, and a band
  on a number that is already one or two hit points is noise.

- **FAME AND STAT POINTS ARE BOTH SPENT WITHIN A RUN.** The plan above has
  fame persisting between runs; it does not. What persists instead is a
  separate list of PERMANENT UNLOCKS — available origins at the start, and
  whatever else — earned by meeting conditions on what a run SPENT of either
  currency rather than by carrying the currency forward. Those conditions and
  that list are not written yet.
- **A FAME POINT BUYS THE RUN'S SHAPE**, on four purchases:

  | | carried | kept between levels |
  |---|---|---|
  | items | **Strong Back**, 1 point | **Large Coffers**, 2 points |
  | traits | **Experienced**, 1 point | **Stubborn**, 2 points |

  Keeping costs twice what carrying costs, because a carried modifier is lost
  at the level's end and a kept one is the only thing that compounds.

  Each is repeatable, and the CAP IS A TOTAL rather than a number of
  purchases: **six carried at once and three surviving a level**, from a base
  of three and one. So Strong Back and Experienced can be bought three times
  each, and Large Coffers and Stubborn twice.

- **AN ORIGIN WORKS LIKE AN ITEM: it STACKS with what the player spends.**
  Its gifts are no longer written into the run's base stats, where they
  quietly spent part of the player's own allowance — a Warrior began at Might
  2 and could put only four more in. **Every run now has all six points in
  every stat**, whatever it plays as, and the origin adds on top of them. A
  Warrior who spends all six into Might fights at 8.
- **PERMANENT UNLOCKS are what crosses between runs**, earned by what a run
  REACHED rather than by carrying currency forward. The first:

  **Berserker** — an origin, available from the start of every run once
  earned.
  +4 Might, +2 Agility, −2 Intellect, +100% damage, and **no armour from
  worn gear**: items' decaying armour is worth nothing to them, while natural
  armour from traits still counts, so a Berserker can be tough without ever
  being armoured.

  Earned by **spending six points into Might in one run** — reaching 6/6.

- **A SPECIAL EVENT STANDS BEFORE EVERY MINI BOSS AND BOSS** — three a level,
  at the only three encounters a player cannot choose their way around. It
  gives something for nothing, and asks which:

  - **one rest**, always offered, worth `10 + 2 x Might`;
  - **`2 + Intellect / 2` traits**, drawn from the region's own ten.

  Intellect WIDENS the choice rather than improving it. Taking a trait with
  full hands asks what to give up, exactly as loot does.

  This is the first healing in the game, and it is not the healing layer the
  plan defers: a rest you give a trait up for, at three fixed moments, rather
  than recovery as a mechanic.
- **THE SIX REGIONS ARE A RING, and the traits are authored on the borders
  between them.** Thirty traits, each in two regions, ten per region is
  `30 x 2 = 60 = 6 x 10` — a hexagon. Six groups of five sit on the six
  borders; a region is the two groups it lies between.

  | | border behind | border ahead |
  |---|---|---|
  | A sprawling cave system | In the dark | Stone and cold |
  | The foothills of a snowy range | Stone and cold | The long march |
  | A city gone to ruin | The long march | Scavengers |
  | A fever-ridden fen | Scavengers | Desperation |
  | The ember wastes | Desperation | Fortune |
  | A remote island | Fortune | In the dark |

  So **neighbours share five traits and opposite regions share none** — the
  world has a grain, and a player who wants a particular trait can travel
  along it. A region's two border names are what the choice shows, because
  ten trait names is more than a choice may cost to read.
