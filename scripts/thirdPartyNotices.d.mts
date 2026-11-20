import type { Plugin } from 'vite'

export function noticesFor(packageDirs: Iterable<string>): string
export function createThirdPartyNotices(): { collect: Plugin; emit: Plugin }
export function thirdPartyNotices(): Plugin
