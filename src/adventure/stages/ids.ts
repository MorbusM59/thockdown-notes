// Every stage's id, in one place.
//
// Stages refer to each other by id to say where a choice goes, and an
// encounter is a CHAIN of them that comes back to where it started --
// encounterSelect to hunt to combat to loot and round again. Importing those
// ids from each other's modules makes that chain a cycle of imports, which
// ES modules will resolve to `undefined` at evaluation time if one of them is
// ever read at the top level rather than inside a function. Naming them here
// means the chain of TRANSITIONS can be a cycle while the chain of IMPORTS
// stays a tree.

export const WELCOME_STAGE_ID = 'welcome'
export const SETTINGS_STAGE_ID = 'settings'
export const CHARACTER_CREATION_STAGE_ID = 'characterCreation'
export const REGION_SELECT_STAGE_ID = 'regionSelect'
export const ENCOUNTER_SELECT_STAGE_ID = 'encounterSelect'
export const HUNT_STAGE_ID = 'hunt'
export const COMBAT_STAGE_ID = 'combat'
export const LOOT_STAGE_ID = 'loot'
export const UNDER_CONSTRUCTION_STAGE_ID = 'underConstruction'
