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
