import { getFirestore } from "firebase-admin/firestore";
import { collectStalePlayers } from "./players";
import { makeTimestamp, makeDocSnapshot, daysAgo, testConfig } from "./test-helpers";

jest.mock("firebase-admin/firestore", () => ({ getFirestore: jest.fn(), Timestamp: {} }));

const mockCollection = {
  get: jest.fn(),
  doc: jest.fn((id: string) => ({ id })),
};
const mockDb = {
  collection: jest.fn(() => mockCollection),
  getAll: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (getFirestore as jest.Mock).mockReturnValue(mockDb);
});

const makePlayerDoc = (
  id: string,
  opts: {
    currentRoom?: string | null;
    lastJoinedAt?: ReturnType<typeof makeTimestamp>;
    createdAt?: ReturnType<typeof makeTimestamp>;
  } = {}
) =>
  makeDocSnapshot(id, {
    currentRoom: opts.currentRoom ?? null,
    ...(opts.lastJoinedAt !== undefined && { lastJoinedAt: opts.lastJoinedAt }),
    ...(opts.createdAt !== undefined && { createdAt: opts.createdAt }),
  });

const setupSnapshot = (docs: ReturnType<typeof makeDocSnapshot>[]) => {
  mockCollection.get.mockResolvedValue({ docs });
};

describe("collectStalePlayers", () => {
  it("flags player with null currentRoom and old lastJoinedAt", async () => {
    setupSnapshot([makePlayerDoc("p1", { lastJoinedAt: makeTimestamp(daysAgo(45)) })]);
    mockDb.getAll.mockResolvedValue([]);

    const result = await collectStalePlayers(testConfig);

    expect(result).toContain("p1");
  });

  it("keeps player with active currentRoom via time-based path", async () => {
    setupSnapshot([
      makePlayerDoc("p1", {
        currentRoom: "room-abc",
        lastJoinedAt: makeTimestamp(daysAgo(45)),
      }),
    ]);
    mockDb.getAll.mockResolvedValue([]);

    const result = await collectStalePlayers(testConfig);

    expect(result).not.toContain("p1");
  });

  it("flags legacy player where currentRoom field is absent", async () => {
    // No currentRoom field at all — treated as not in a room
    const doc = makeDocSnapshot("p-legacy", {
      lastJoinedAt: makeTimestamp(daysAgo(45)),
    });
    setupSnapshot([doc]);
    mockDb.getAll.mockResolvedValue([]);

    const result = await collectStalePlayers(testConfig);

    expect(result).toContain("p-legacy");
  });

  it("falls back to createdAt when lastJoinedAt is absent", async () => {
    setupSnapshot([makePlayerDoc("p1", { createdAt: makeTimestamp(daysAgo(45)) })]);
    mockDb.getAll.mockResolvedValue([]);

    const result = await collectStalePlayers(testConfig);

    expect(result).toContain("p1");
  });

  it("treats player with missing timestamps as recently created (not stale)", async () => {
    setupSnapshot([makeDocSnapshot("p-nodates", { currentRoom: null })]);
    mockDb.getAll.mockResolvedValue([]);

    const result = await collectStalePlayers(testConfig);

    expect(result).not.toContain("p-nodates");
  });

  it("keeps player with recent lastJoinedAt", async () => {
    setupSnapshot([makePlayerDoc("p1", { lastJoinedAt: makeTimestamp(daysAgo(5)) })]);
    mockDb.getAll.mockResolvedValue([]);

    const result = await collectStalePlayers(testConfig);

    expect(result).not.toContain("p1");
  });

  it("includes player with active room when UID is in staleUids", async () => {
    setupSnapshot([
      makePlayerDoc("p-active-room", {
        currentRoom: "room-abc",
        lastJoinedAt: makeTimestamp(daysAgo(5)),
      }),
    ]);
    mockDb.getAll.mockResolvedValue([
      makeDocSnapshot("p-stale-auth", { currentRoom: "room-abc" }),
    ]);

    const result = await collectStalePlayers(testConfig, new Set(["p-stale-auth"]));

    expect(result).toContain("p-stale-auth");
    expect(result).not.toContain("p-active-room");
  });

  it("skips staleUid when no player doc exists", async () => {
    setupSnapshot([]);
    mockDb.getAll.mockResolvedValue([makeDocSnapshot("uid-no-doc", null)]);

    const result = await collectStalePlayers(testConfig, new Set(["uid-no-doc"]));

    expect(result).not.toContain("uid-no-doc");
  });

  it("deduplicates when staleUid is also caught by time-based path", async () => {
    setupSnapshot([makePlayerDoc("p1", { lastJoinedAt: makeTimestamp(daysAgo(45)) })]);
    mockDb.getAll.mockResolvedValue([makeDocSnapshot("p1", { currentRoom: null })]);

    const result = await collectStalePlayers(testConfig, new Set(["p1"]));

    expect(result.filter((id) => id === "p1")).toHaveLength(1);
  });
});
