import { getFirestore } from "firebase-admin/firestore";
import { collectStaleRooms } from "./rooms";
import { makeTimestamp, makeDocSnapshot, daysAgo, testConfig } from "./test-helpers";

// collectStaleRooms always receives a snapshot in these tests so db is never queried,
// but getFirestore() is still called unconditionally and must not throw.
jest.mock("firebase-admin/firestore", () => ({ getFirestore: jest.fn(), Timestamp: {} }));

beforeEach(() => {
  jest.clearAllMocks();
  (getFirestore as jest.Mock).mockReturnValue({});
});

const makeRoomDoc = (
  id: string,
  opts: {
    players?: string[];
    spectators?: string[];
    lastActivity?: ReturnType<typeof makeTimestamp>;
    createdAt?: ReturnType<typeof makeTimestamp>;
  } = {}
) =>
  makeDocSnapshot(id, {
    players: opts.players ?? [],
    spectators: opts.spectators ?? [],
    ...(opts.lastActivity !== undefined && { lastActivity: opts.lastActivity }),
    ...(opts.createdAt !== undefined && { createdAt: opts.createdAt }),
  });

const makeSnapshot = (docs: ReturnType<typeof makeDocSnapshot>[]) =>
  ({ docs } as any);

describe("collectStaleRooms", () => {
  it("flags empty room older than EMPTY_ROOM_STALE_DAYS", async () => {
    const snap = makeSnapshot([
      makeRoomDoc("r1", { createdAt: makeTimestamp(daysAgo(5)) }),
    ]);

    const result = await collectStaleRooms(new Set(), new Set(), testConfig, snap);

    expect(result).toContain("r1");
  });

  it("keeps empty room within EMPTY_ROOM_STALE_DAYS", async () => {
    const snap = makeSnapshot([
      makeRoomDoc("r1", { createdAt: makeTimestamp(new Date()) }),
    ]);

    const result = await collectStaleRooms(new Set(), new Set(), testConfig, snap);

    expect(result).not.toContain("r1");
  });

  it("treats room with only 'anonymous' placeholder as empty", async () => {
    const snap = makeSnapshot([
      makeRoomDoc("r1", {
        players: ["anonymous"],
        createdAt: makeTimestamp(daysAgo(5)),
      }),
    ]);

    const result = await collectStaleRooms(new Set(), new Set(), testConfig, snap);

    expect(result).toContain("r1");
  });

  it("flags room where every member is in staleUids regardless of timestamp", async () => {
    const snap = makeSnapshot([
      makeRoomDoc("r1", {
        players: ["uid-stale"],
        lastActivity: makeTimestamp(new Date()), // very recent
      }),
    ]);

    const result = await collectStaleRooms(
      new Set(["uid-stale"]),
      new Set(["uid-stale"]),
      testConfig,
      snap
    );

    expect(result).toContain("r1");
  });

  it("protects room with at least one active named user", async () => {
    const allAnonUids = new Set(["uid-anon"]);
    const snap = makeSnapshot([
      makeRoomDoc("r1", {
        players: ["uid-named", "uid-anon"],
        createdAt: makeTimestamp(daysAgo(30)),
      }),
    ]);

    const result = await collectStaleRooms(allAnonUids, new Set(), testConfig, snap);

    expect(result).not.toContain("r1");
  });

  it("flags room with only anon members past roomThreshold", async () => {
    const allAnonUids = new Set(["uid-anon"]);
    const snap = makeSnapshot([
      makeRoomDoc("r1", {
        players: ["uid-anon"],
        lastActivity: makeTimestamp(daysAgo(10)),
      }),
    ]);

    const result = await collectStaleRooms(allAnonUids, new Set(), testConfig, snap);

    expect(result).toContain("r1");
  });

  it("keeps room with only anon members within roomThreshold", async () => {
    const allAnonUids = new Set(["uid-anon"]);
    const snap = makeSnapshot([
      makeRoomDoc("r1", {
        players: ["uid-anon"],
        lastActivity: makeTimestamp(daysAgo(3)),
      }),
    ]);

    const result = await collectStaleRooms(allAnonUids, new Set(), testConfig, snap);

    expect(result).not.toContain("r1");
  });

  it("falls back to createdAt when lastActivity is absent", async () => {
    const allAnonUids = new Set(["uid-anon"]);
    const snap = makeSnapshot([
      makeRoomDoc("r1", {
        players: ["uid-anon"],
        createdAt: makeTimestamp(daysAgo(10)),
      }),
    ]);

    const result = await collectStaleRooms(allAnonUids, new Set(), testConfig, snap);

    expect(result).toContain("r1");
  });

  it("treats room with missing timestamps as recently created (not stale)", async () => {
    const snap = makeSnapshot([makeDocSnapshot("r1", { players: [], spectators: [] })]);

    const result = await collectStaleRooms(new Set(), new Set(), testConfig, snap);

    expect(result).not.toContain("r1");
  });

  it("deduplicates members across players and spectators arrays", async () => {
    // uid-stale appears in both arrays — should still count as one member
    const snap = makeSnapshot([
      makeRoomDoc("r1", {
        players: ["uid-stale"],
        spectators: ["uid-stale"],
        lastActivity: makeTimestamp(new Date()),
      }),
    ]);

    const result = await collectStaleRooms(
      new Set(["uid-stale"]),
      new Set(["uid-stale"]),
      testConfig,
      snap
    );

    expect(result).toContain("r1");
  });

  it("checks spectators when determining if all members are stale", async () => {
    // players is empty but a stale spectator keeps the "all stale" path active
    const snap = makeSnapshot([
      makeRoomDoc("r1", {
        players: [],
        spectators: ["uid-stale"],
        lastActivity: makeTimestamp(new Date()),
      }),
    ]);

    const result = await collectStaleRooms(
      new Set(["uid-stale"]),
      new Set(["uid-stale"]),
      testConfig,
      snap
    );

    expect(result).toContain("r1");
  });

  it("protects room when a named user is in spectators only", async () => {
    const allAnonUids = new Set<string>();
    const snap = makeSnapshot([
      makeRoomDoc("r1", {
        players: [],
        spectators: ["uid-named"],
        createdAt: makeTimestamp(daysAgo(30)),
      }),
    ]);

    const result = await collectStaleRooms(allAnonUids, new Set(), testConfig, snap);

    expect(result).not.toContain("r1");
  });
});
