import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Config } from "./config";

export const collectStalePlayers = async (config: Config, staleUids: Set<string> = new Set()): Promise<string[]> => {
  const db = getFirestore();
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - config.PLAYER_STALE_DAYS);

  // Full collection scan so we catch both explicit null and absent currentRoom fields.
  // Firestore's == null filter silently omits documents where the field was never written,
  // which would cause legacy player docs to accumulate indefinitely.
  const snapshot = await db.collection("players").get();

  const stale = new Set(
    snapshot.docs
      .filter((doc) => {
        const data = doc.data();
        if (data.currentRoom) return false;
        const lastActivity: Date = data.lastJoinedAt
          ? (data.lastJoinedAt as Timestamp).toDate()
          : data.createdAt
          ? (data.createdAt as Timestamp).toDate()
          : new Date(); // treat docs missing timestamps as recently created
        return lastActivity < threshold;
      })
      .map((doc) => doc.id)
  );

  // Also include players whose auth account is stale, even if they still have an active currentRoom.
  const uidsToCheck = Array.from(staleUids).filter((uid) => !stale.has(uid));
  if (uidsToCheck.length > 0) {
    const refs = uidsToCheck.map((uid) => db.collection("players").doc(uid));
    const docs = await db.getAll(...refs);
    for (const doc of docs) {
      if (doc.exists) stale.add(doc.id);
    }
  }

  return Array.from(stale);
};
