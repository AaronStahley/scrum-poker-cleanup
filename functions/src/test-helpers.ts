import { Config } from "./config";

export const makeTimestamp = (date: Date) => ({ toDate: () => date });

export const makeDocSnapshot = (id: string, data: Record<string, unknown> | null) => ({
  id,
  exists: data !== null,
  data: () => data,
  ref: { id },
});

export const daysAgo = (n: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

export const testConfig: Config = {
  DRY_RUN: true,
  USER_STALE_DAYS: 30,
  ORPHAN_USER_STALE_DAYS: 7,
  PLAYER_STALE_DAYS: 30,
  ROOM_STALE_DAYS: 7,
  EMPTY_ROOM_STALE_DAYS: 1,
  ENABLE_USER_CLEANUP: true,
  ENABLE_PLAYER_CLEANUP: true,
  ENABLE_ROOM_CLEANUP: true,
};
