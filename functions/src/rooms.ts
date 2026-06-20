import { getFirestore, Timestamp, QuerySnapshot, DocumentData } from "firebase-admin/firestore";
import { Config } from "./config";

export const collectStaleRooms = async (
  allAnonUids: Set<string>,
  staleUids: Set<string>,
  config: Config,
  snapshot?: QuerySnapshot<DocumentData>
): Promise<string[]> => {
  const db = getFirestore();

  const roomThreshold = new Date();
  roomThreshold.setDate(roomThreshold.getDate() - config.ROOM_STALE_DAYS);

  const emptyRoomThreshold = new Date();
  emptyRoomThreshold.setDate(emptyRoomThreshold.getDate() - config.EMPTY_ROOM_STALE_DAYS);

  // Filter out the legacy "anonymous" placeholder stored in older rooms before real UIDs were tracked.
  const filterUids = (arr: string[]) => arr.filter((uid) => uid && uid !== "anonymous");

  const snap = snapshot ?? await db.collection("rooms").get();
  const staleRoomIds: string[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    // Combine players and spectators into a single deduplicated member set.
    const members: string[] = [
      ...new Set([
        ...filterUids(data.players || []),
        ...filterUids(data.spectators || []),
      ]),
    ];

    // Fall back to createdAt for rooms predating the lastActivity field.
    // If neither exists, treat as recently created to avoid deleting brand-new rooms.
    const effectiveActivity: Date = data.lastActivity
      ? (data.lastActivity as Timestamp).toDate()
      : data.createdAt
      ? (data.createdAt as Timestamp).toDate()
      : new Date(); // treat docs missing timestamps as recently created

    if (members.length === 0) {
      if (effectiveActivity < emptyRoomThreshold) {
        staleRoomIds.push(doc.id);
      }
      continue;
    }

    // Rooms where every member has a stale auth account are dead regardless of activity timestamp
    if (members.every((uid) => staleUids.has(uid))) {
      staleRoomIds.push(doc.id);
      continue;
    }

    // Protect rooms that contain any named (non-anonymous), non-stale member.
    // Limitation: a ghost UID (named user deleted outside this job, absent from allAnonUids/staleUids)
    // will incorrectly protect this room. Resolving it requires an extra Auth or Firestore lookup per member.
    const hasActiveNamedUser = members.some((uid) => !allAnonUids.has(uid) && !staleUids.has(uid));
    if (hasActiveNamedUser) continue;

    if (effectiveActivity < roomThreshold) {
      staleRoomIds.push(doc.id);
    }
  }

  return staleRoomIds;
};
