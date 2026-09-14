// Every stage the director can reach, in one registry.
//
// A stage that is not in this list cannot be entered, which makes the list
// the honest answer to "what is built". Adding a stage is one import and
// one entry; nothing else in the platform changes.

import { registerStages } from '../core/stage'
import { welcomeStage, WELCOME_STAGE_ID } from './welcome'
import { settingsStage } from './settings'
import { characterCreationStage } from './characterCreation'
import { regionSelectStage } from './regionSelect'
import { outpostStage } from './outpost'
import { marketStage } from './market'
import { encounterSelectStage } from './encounterSelect'
import { huntStage } from './hunt'
import { statPointStage } from './statPoints'
import { combatStage } from './combat'
import { lootStage } from './loot'
import { underConstructionStage } from './underConstruction'

export const STAGES = registerStages([
  welcomeStage,
  settingsStage,
  characterCreationStage,
  regionSelectStage,
  outpostStage,
  marketStage,
  encounterSelectStage,
  huntStage,
  statPointStage,
  combatStage,
  lootStage,
  underConstructionStage,
])

export const ROOT_STAGE_ID = WELCOME_STAGE_ID
