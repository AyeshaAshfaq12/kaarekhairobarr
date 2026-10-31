import 'server-only'
import { requestCache as cache } from './request-cache'
import { prisma } from './db'

export type PortalSettings = {
  minimumAge: number
  handbookUrl: string
  bandOnTrack: number // achievement % at or above which a member is "On track"
  bandClose: number // achievement % at or above which a member is "Close"
}

export const DEFAULT_SETTINGS: PortalSettings = {
  minimumAge: 16,
  handbookUrl: '',
  bandOnTrack: 100,
  bandClose: 70,
}

export const getSettings = cache(async (): Promise<PortalSettings> => {
  const rows = await prisma.setting.findMany()
  const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<PortalSettings>) }
})
