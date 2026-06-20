import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { config } from "./config";
import { collectStaleAuthUsers } from "./users";
import { collectStalePlayers } from "./players";
import { collectStaleRooms } from "./rooms";

initializeApp({ projectId: "thescrumpoker" });

const db = getFirestore();

const filterUids = (arr: string[]) =>
  (arr || []).filter((uid: string) => uid && uid !== "anonymous");

async function fetchNamesByUid(uids: string[]): Promise<Map<string, string>> {
  const nameByUid = new Map<string, string>();
  if (uids.length === 0) return nameByUid;

  const refs = uids.map((uid) => db.collection("players").doc(uid));
  const docs = await db.getAll(...refs);

  for (const doc of docs) {
    if (!doc.exists) continue;
    const data = doc.data()!;
    nameByUid.set(doc.id, data.name || data.displayName || data.username || "(no name)");
  }

  return nameByUid;
}

async function main() {
  if (!config.DRY_RUN) {
    console.error("ERROR: DRY_RUN is not enabled. Set DRY_RUN=true before running locally.");
    process.exit(1);
  }

  console.log("=== Scrum Poker Cleanup — DRY RUN ===");
  console.log("Config:", JSON.stringify(config, null, 2));

  const start = Date.now();

  // Phase 1: Auth users — also needed by room cleanup for allAnonUids
  let userResult = { staleUids: [] as string[], orphanUids: [] as string[], allAnonUids: new Set<string>() };
  if (config.ENABLE_USER_CLEANUP || config.ENABLE_ROOM_CLEANUP) {
    userResult = await collectStaleAuthUsers(config);
  }

  const staleUidSet = new Set(userResult.staleUids);
  const nameByUid = await fetchNamesByUid(userResult.staleUids);

  if (config.ENABLE_USER_CLEANUP) {
    console.log("\n--- Phase 1: Stale Auth Users ---");
    const orphanUidSet = new Set(userResult.orphanUids);
    const staleWithDoc = userResult.staleUids.filter((uid) => !orphanUidSet.has(uid));

    console.log(`Total anonymous UIDs: ${userResult.allAnonUids.size}`);
    console.log(`\n  Stale users with player doc (${staleWithDoc.length} would be deleted, threshold: ${config.USER_STALE_DAYS} days):`);
    staleWithDoc.forEach((uid) => console.log(`    ${uid}  ${nameByUid.get(uid) ?? "(unknown)"}`));
    console.log(`\n  Orphan users — no player doc (${userResult.orphanUids.length} would be deleted, threshold: ${config.ORPHAN_USER_STALE_DAYS} days):`);
    userResult.orphanUids.forEach((uid) => console.log(`    ${uid}`));
  }

  // Phase 2: Players
  let stalePlayers: string[] = [];
  if (config.ENABLE_PLAYER_CLEANUP) {
    console.log("\n--- Phase 2: Stale Player Docs ---");
    stalePlayers = await collectStalePlayers(config, staleUidSet);
    console.log(`Stale player docs (${stalePlayers.length} would be deleted, threshold: ${config.PLAYER_STALE_DAYS} days):`);
    stalePlayers.forEach((id) => console.log(`  players/${id}  ${nameByUid.get(id) ?? "(unknown)"}`));
  }

  // Phase 3: Rooms
  let staleRooms: string[] = [];
  if (config.ENABLE_ROOM_CLEANUP) {
    console.log("\n--- Phase 3: Stale Rooms ---");
    staleRooms = await collectStaleRooms(userResult.allAnonUids, staleUidSet, config);
    console.log(`Stale rooms (${staleRooms.length} would be deleted, threshold: ${config.ROOM_STALE_DAYS} days / empty: ${config.EMPTY_ROOM_STALE_DAYS} day):`);
    if (staleRooms.length > 0) {
      const roomDocs = await db.getAll(...staleRooms.map((id) => db.collection("rooms").doc(id)));
      roomDocs.forEach((doc) => {
        const roomName = doc.exists ? (doc.data()!.name || "(unnamed)") : "(not found)";
        console.log(`  rooms/${doc.id}  "${roomName}"`);
      });
    }
  }

  // Optional: inspect a specific room by passing its ID as a CLI argument
  const roomIds = process.argv.slice(2);
  for (const roomId of roomIds) {
    console.log(`\n--- Room Inspection: ${roomId} ---`);
    const roomDoc = await db.collection("rooms").doc(roomId).get();
    if (!roomDoc.exists) {
      console.log("  Room not found.");
      continue;
    }
    const data = roomDoc.data()!;
    const players = filterUids(data.players);
    const spectators = filterUids(data.spectators);
    const allMembers = [...new Set([...players, ...spectators])];

    if (allMembers.length === 0) {
      console.log("  Room has no members.");
      continue;
    }

    const memberNames = await fetchNamesByUid(allMembers);
    const staleInRoom = allMembers.filter((uid) => staleUidSet.has(uid));
    const activeInRoom = allMembers.filter((uid) => !staleUidSet.has(uid));

    console.log(`  Total members: ${allMembers.length} (${players.length} players, ${spectators.length} spectators)`);
    console.log(`  Stale members (${staleInRoom.length}):`);
    staleInRoom.forEach((uid) => console.log(`    ${uid}  ${memberNames.get(uid) ?? "(no player doc)"}`));
    console.log(`  Active members (${activeInRoom.length}):`);
    activeInRoom.forEach((uid) => console.log(`    ${uid}  ${memberNames.get(uid) ?? "(no player doc)"}`));
  }

  console.log(`\n=== DRY RUN COMPLETE (${Date.now() - start}ms) ===`);
  console.log(`Would delete: ${userResult.staleUids.length} auth users, ${stalePlayers.length} player docs, ${staleRooms.length} rooms`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
