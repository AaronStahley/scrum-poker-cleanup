import { getFirestore, QuerySnapshot, DocumentData } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { Config } from "./config";
import { collectStaleAuthUsers } from "./users";
import { collectStalePlayers } from "./players";
import { collectStaleRooms } from "./rooms";

export interface PhaseResult {
  identified: number;
  deleted: number;
  errors: number;
}

export interface CleanupResult {
  dryRun: boolean;
  duration_ms: number;
  staleAuthUsers: PhaseResult;
  stalePlayers: PhaseResult;
  staleRooms: PhaseResult;
  errors: string[];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export const runCleanup = async (config: Config): Promise<CleanupResult> => {
  const start = Date.now();
  const db = getFirestore();
  const auth = getAuth();
  const errors: string[] = [];

  const result: CleanupResult = {
    dryRun: config.DRY_RUN,
    duration_ms: 0,
    staleAuthUsers: { identified: 0, deleted: 0, errors: 0 },
    stalePlayers: { identified: 0, deleted: 0, errors: 0 },
    staleRooms: { identified: 0, deleted: 0, errors: 0 },
    errors,
  };

  // Phase 1: Collect stale auth users + full anon UID set.
  // allAnonUids is needed by the room collector to detect named users.
  let staleUids: string[] = [];
  let allAnonUids = new Set<string>();
  let phase1Ok = true;

  if (config.ENABLE_USER_CLEANUP || config.ENABLE_ROOM_CLEANUP) {
    try {
      const userResult = await collectStaleAuthUsers(config);
      staleUids = userResult.staleUids;
      allAnonUids = userResult.allAnonUids;
      result.staleAuthUsers.identified = staleUids.length;
    } catch (err) {
      phase1Ok = false;
      const msg = `Failed to collect stale auth users: ${err}`;
      errors.push(msg);
      console.error(msg);
    }
  }

  // Phase 2: Collect stale player docs
  let stalePlayerIds: string[] = [];
  if (config.ENABLE_PLAYER_CLEANUP) {
    try {
      // Only seed from staleUids when user cleanup is enabled — otherwise operators
      // intending to preserve auth accounts would still lose their player docs.
      stalePlayerIds = await collectStalePlayers(
        config,
        config.ENABLE_USER_CLEANUP ? new Set(staleUids) : new Set()
      );
      result.stalePlayers.identified = stalePlayerIds.length;
    } catch (err) {
      const msg = `Failed to collect stale players: ${err}`;
      errors.push(msg);
      console.error(msg);
    }
  }

  // Phase 3: Collect stale rooms — fetch the snapshot here and reuse it in Phase 4a.
  // Skipped if Phase 1 failed because allAnonUids would be empty, producing unreliable results.
  let staleRoomIds: string[] = [];
  let roomsSnapshot: QuerySnapshot<DocumentData> | undefined;
  if (config.ENABLE_ROOM_CLEANUP && phase1Ok) {
    try {
      roomsSnapshot = await db.collection("rooms").get();
      // Only treat auth-stale UIDs as absent members when user cleanup is also enabled.
      staleRoomIds = await collectStaleRooms(
        allAnonUids,
        config.ENABLE_USER_CLEANUP ? new Set(staleUids) : new Set(),
        config,
        roomsSnapshot
      );
      result.staleRooms.identified = staleRoomIds.length;
    } catch (err) {
      const msg = `Failed to collect stale rooms: ${err}`;
      errors.push(msg);
      console.error(msg);
    }
  }

  if (config.DRY_RUN) {
    result.duration_ms = Date.now() - start;
    return result;
  }

  // Phase 4a: Patch stale player UIDs out of room arrays before deleting player docs.
  // Skip rooms that are themselves being deleted to avoid unnecessary writes.
  // Ensure rooms snapshot is available — Phase 3 may have been skipped if room cleanup is off.
  if (stalePlayerIds.length > 0 && !roomsSnapshot) {
    roomsSnapshot = await db.collection("rooms").get();
  }

  let phase4aOk = true;
  if (stalePlayerIds.length > 0) {
    try {
      const stalePlayerSet = new Set(stalePlayerIds);
      const staleRoomSet = new Set(staleRoomIds);
      const snap = roomsSnapshot!;

      let batch = db.batch();
      let opsInBatch = 0;

      for (const roomDoc of snap.docs) {
        if (staleRoomSet.has(roomDoc.id)) continue;

        const data = roomDoc.data();
        const originalPlayers: string[] = data.players || [];
        const originalSpectators: string[] = data.spectators || [];

        const filteredPlayers = originalPlayers.filter((uid) => !stalePlayerSet.has(uid));
        const filteredSpectators = originalSpectators.filter((uid) => !stalePlayerSet.has(uid));

        const changed =
          filteredPlayers.length !== originalPlayers.length ||
          filteredSpectators.length !== originalSpectators.length;

        if (!changed) continue;

        batch.update(roomDoc.ref, { players: filteredPlayers, spectators: filteredSpectators });
        opsInBatch++;

        if (opsInBatch === 500) {
          await batch.commit();
          batch = db.batch();
          opsInBatch = 0;
        }
      }

      if (opsInBatch > 0) await batch.commit();
    } catch (err) {
      phase4aOk = false;
      const msg = `Failed to patch stale players out of rooms: ${err}`;
      errors.push(msg);
      console.error(msg);
      result.stalePlayers.errors++;
    }
  }

  // Phase 4b: Delete stale room documents
  if (staleRoomIds.length > 0) {
    try {
      for (const roomChunk of chunk(staleRoomIds, 500)) {
        const batch = db.batch();
        for (const roomId of roomChunk) {
          batch.delete(db.collection("rooms").doc(roomId));
        }
        await batch.commit();
        result.staleRooms.deleted += roomChunk.length;
      }
    } catch (err) {
      const msg = `Failed to delete stale rooms: ${err}`;
      errors.push(msg);
      console.error(msg);
      result.staleRooms.errors++;
    }
  }

  // Phase 4c: Delete stale player documents.
  // Skipped if Phase 4a failed — deleting docs while rooms still reference those UIDs leaves dangling refs.
  let phase4cOk = true;
  if (stalePlayerIds.length > 0) {
    if (!phase4aOk) {
      phase4cOk = false;
      console.warn("Skipping Phase 4c: Phase 4a (room patching) did not complete cleanly");
    } else {
      try {
        for (const playerChunk of chunk(stalePlayerIds, 500)) {
          const batch = db.batch();
          for (const playerId of playerChunk) {
            batch.delete(db.collection("players").doc(playerId));
          }
          await batch.commit();
          result.stalePlayers.deleted += playerChunk.length;
        }
      } catch (err) {
        phase4cOk = false;
        const msg = `Failed to delete stale player docs: ${err}`;
        errors.push(msg);
        console.error(msg);
        result.stalePlayers.errors++;
      }
    }
  }

  // Phase 4d: Delete stale Firebase Auth users (max 1000 per deleteUsers call).
  // Skipped if Phase 4c failed — deleting auth accounts while player docs remain creates orphan docs.
  if (staleUids.length > 0 && config.ENABLE_USER_CLEANUP && phase4cOk) {
    try {
      for (const uidChunk of chunk(staleUids, 1000)) {
        const deleteResult = await auth.deleteUsers(uidChunk);
        result.staleAuthUsers.deleted += deleteResult.successCount;
        result.staleAuthUsers.errors += deleteResult.failureCount;
        deleteResult.errors.forEach((e) =>
          errors.push(`Auth delete error uid=${uidChunk[e.index]}: ${e.error.message}`)
        );
      }
    } catch (err) {
      const msg = `Failed to delete stale auth users: ${err}`;
      errors.push(msg);
      console.error(msg);
      result.staleAuthUsers.errors++;
    }
  }

  result.duration_ms = Date.now() - start;
  return result;
};
