import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Config } from "./config";

export interface AuthUserResult {
  staleUids: string[];
  orphanUids: string[];
  allAnonUids: Set<string>;
}

export const collectStaleAuthUsers = async (config: Config): Promise<AuthUserResult> => {
  const auth = getAuth();
  const db = getFirestore();
  const allAnonUids = new Set<string>();

  const threshold = new Date();
  threshold.setDate(threshold.getDate() - config.USER_STALE_DAYS);

  const orphanThreshold = new Date();
  orphanThreshold.setDate(orphanThreshold.getDate() - config.ORPHAN_USER_STALE_DAYS);

  const anonAuthMetadata = new Map<string, { lastSignInTime?: string; creationTime: string }>();
  let pageToken: string | undefined;

  do {
    const result = await auth.listUsers(1000, pageToken);
    for (const user of result.users) {
      if (user.providerData.length !== 0) continue;
      allAnonUids.add(user.uid);
      anonAuthMetadata.set(user.uid, {
        lastSignInTime: user.metadata.lastSignInTime,
        creationTime: user.metadata.creationTime,
      });
    }
    pageToken = result.pageToken;
  } while (pageToken);

  // Batch-fetch player docs for all anonymous users to get lastJoinedAt.
  // lastSignInTime on anonymous Auth accounts reflects first account creation,
  // not subsequent app visits, making it an unreliable staleness signal.
  const uids = Array.from(allAnonUids);
  const playerDocMap = new Map<string, Timestamp | null>();

  for (let i = 0; i < uids.length; i += 500) {
    const chunk = uids.slice(i, i + 500);
    const refs = chunk.map((uid) => db.collection("players").doc(uid));
    const docs = await db.getAll(...refs);
    for (const doc of docs) {
      const data = doc.exists ? doc.data()! : null;
      playerDocMap.set(doc.id, data?.lastJoinedAt ?? null);
    }
  }

  const staleUids: string[] = [];
  const orphanUids: string[] = [];

  for (const uid of uids) {
    const lastJoinedAt = playerDocMap.get(uid);

    if (lastJoinedAt) {
      // Player doc has room activity — use that as the source of truth
      if (lastJoinedAt.toDate() < threshold) staleUids.push(uid);
    } else {
      // No player doc — user bounced without ever joining a room.
      // Use the shorter orphan threshold against Auth metadata.
      const meta = anonAuthMetadata.get(uid)!;
      const lastActivity = meta.lastSignInTime
        ? new Date(meta.lastSignInTime)
        : new Date(meta.creationTime);
      if (lastActivity < orphanThreshold) {
        staleUids.push(uid);
        orphanUids.push(uid);
      }
    }
  }

  return { staleUids, orphanUids, allAnonUids };
};
