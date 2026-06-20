export interface Config {
  DRY_RUN: boolean;
  USER_STALE_DAYS: number;
  ORPHAN_USER_STALE_DAYS: number;
  PLAYER_STALE_DAYS: number;
  ROOM_STALE_DAYS: number;
  EMPTY_ROOM_STALE_DAYS: number;
  ENABLE_USER_CLEANUP: boolean;
  ENABLE_PLAYER_CLEANUP: boolean;
  ENABLE_ROOM_CLEANUP: boolean;
}

function parseIntEnv(key: string, fallback: number): number {
  const val = parseInt(process.env[key] ?? "", 10);
  return Number.isNaN(val) ? fallback : val;
}

export const config: Config = {
  DRY_RUN: process.env.DRY_RUN !== "false",
  USER_STALE_DAYS: parseIntEnv("USER_STALE_DAYS", 30),
  ORPHAN_USER_STALE_DAYS: parseIntEnv("ORPHAN_USER_STALE_DAYS", 7),
  PLAYER_STALE_DAYS: parseIntEnv("PLAYER_STALE_DAYS", 30),
  ROOM_STALE_DAYS: parseIntEnv("ROOM_STALE_DAYS", 7),
  EMPTY_ROOM_STALE_DAYS: parseIntEnv("EMPTY_ROOM_STALE_DAYS", 1),
  ENABLE_USER_CLEANUP: process.env.ENABLE_USER_CLEANUP !== "false",
  ENABLE_PLAYER_CLEANUP: process.env.ENABLE_PLAYER_CLEANUP !== "false",
  ENABLE_ROOM_CLEANUP: process.env.ENABLE_ROOM_CLEANUP !== "false",
};
