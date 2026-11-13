import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/utils/csrf", () => ({ verifyCsrf: vi.fn(() => null) }));

/** The moderator's own session: used for who they are, and to close the report. */
const session = vi.hoisted(() => ({
  isAdmin: true,
  reportUpdates: [] as Record<string, unknown>[],
  updateError: null as { message: string } | null,
}));

vi.mock("@/lib/utils/admin", async () => {
  const { jsonResponse } = await import("@/lib/utils/api-helpers");
  return {
    requireAdmin: vi.fn(async () =>
      session.isAdmin
        ? {
            ok: true as const,
            userId: "admin-1",
            supabase: {
              from: () => ({
                update: (values: Record<string, unknown>) => ({
                  eq: async () => {
                    session.reportUpdates.push(values);
                    return { error: session.updateError };
                  },
                }),
              }),
            },
          }
        : { ok: false as const, response: jsonResponse({ error: "Forbidden" }, { status: 403 }) },
    ),
  };
});

/** The database and storage as the service role sees them. */
const db = vi.hoisted(() => ({
  available: true,
  tables: {} as Record<string, Record<string, unknown>[]>,
  stored: new Set<string>(),
  storageError: null as { message: string } | null,
  deleteError: null as { message: string } | null,
  /** What happened, in order: "remove:<path>" and "delete:<table>:<id>". */
  log: [] as string[],
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => {
    if (!db.available) return null;
    return {
      from: (table: string) => ({
        select: () => ({
          eq: (column: string, value: string) => ({
            maybeSingle: async () => ({
              data: (db.tables[table] ?? []).find((row) => row[column] === value) ?? null,
              error: null,
            }),
          }),
        }),
        delete: () => ({
          eq: async (column: string, value: string) => {
            if (db.deleteError) return { error: db.deleteError };
            db.log.push(`delete:${table}:${value}`);
            db.tables[table] = (db.tables[table] ?? []).filter((row) => row[column] !== value);
            return { error: null };
          },
        }),
      }),
      storage: {
        from: (bucket: string) => ({
          list: async () => ({ data: [], error: null }),
          remove: async (paths: string[]) => {
            if (db.storageError) return { data: null, error: db.storageError };
            for (const path of paths) {
              db.log.push(`remove:${bucket}/${path}`);
              db.stored.delete(`${bucket}/${path}`);
            }
            return { data: [], error: null };
          },
        }),
      },
    };
  },
}));

const { DELETE } = await import("../route");

const AUTHOR = "a1111111-1111-4111-8111-111111111111";
const OTHER = "c3333333-3333-4333-8333-333333333333";
const REPORT = "d4444444-4444-4444-8444-444444444444";
const COMPLETION = "e5555555-5555-4555-8555-555555555555";
const MESSAGE = "f6666666-6666-4666-8666-666666666666";
const PHOTO = `${AUTHOR}/capture/reported.webp`;
const PRIVATE_PHOTO = `${AUTHOR}/private/kept-private.webp`;

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/admin/content", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function takeDownCompletion() {
  return DELETE(request({ reportId: REPORT, contentType: "completion", contentId: COMPLETION }));
}

beforeEach(() => {
  session.isAdmin = true;
  session.reportUpdates = [];
  session.updateError = null;
  db.available = true;
  db.storageError = null;
  db.deleteError = null;
  db.log = [];
  db.tables = {
    content_reports: [{ id: REPORT, content_type: "completion", content_id: COMPLETION }],
    completions: [{ id: COMPLETION, user_id: AUTHOR, evidence_url: PHOTO }],
    completion_private_content: [],
    group_messages: [{ id: MESSAGE, user_id: AUTHOR, media_path: PHOTO }],
  };
  db.stored = new Set([`completions/${PHOTO}`, `completions/${PRIVATE_PHOTO}`]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("DELETE /api/admin/content", () => {
  it("is for admins", async () => {
    session.isAdmin = false;
    const res = await takeDownCompletion();
    expect(res.status).toBe(403);
    expect(db.log).toEqual([]);
  });

  it("removes the photo from storage, then the check-in, and closes the report", async () => {
    const res = await takeDownCompletion();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, reportId: REPORT, contentId: COMPLETION });
    // The file first: with the row gone there would be no record of which file to remove.
    expect(db.log).toEqual([`remove:completions/${PHOTO}`, `delete:completions:${COMPLETION}`]);
    expect(db.stored.has(`completions/${PHOTO}`)).toBe(false);
    expect(db.tables.completions).toEqual([]);
    expect(session.reportUpdates).toHaveLength(1);
    expect(session.reportUpdates[0]).toMatchObject({ status: "actioned", reviewed_by: "admin-1" });
  });

  it("removes media the check-in kept private as well", async () => {
    db.tables.completions = [{ id: COMPLETION, user_id: AUTHOR, evidence_url: null }];
    db.tables.completion_private_content = [{ completion_id: COMPLETION, evidence_url: PRIVATE_PHOTO }];

    expect((await takeDownCompletion()).status).toBe(200);
    expect(db.log).toEqual([`remove:completions/${PRIVATE_PHOTO}`, `delete:completions:${COMPLETION}`]);
  });

  it("removes a group message's media and the message", async () => {
    db.tables.content_reports = [{ id: REPORT, content_type: "message", content_id: MESSAGE }];

    const res = await DELETE(request({ reportId: REPORT, contentType: "message", contentId: MESSAGE }));
    expect(res.status).toBe(200);
    expect(db.log).toEqual([`remove:completions/${PHOTO}`, `delete:group_messages:${MESSAGE}`]);
  });

  it("deletes a check-in that has no media without calling storage", async () => {
    db.tables.completions = [{ id: COMPLETION, user_id: AUTHOR, evidence_url: null }];

    expect((await takeDownCompletion()).status).toBe(200);
    expect(db.log).toEqual([`delete:completions:${COMPLETION}`]);
  });

  it("finds the file behind the signed URL an old check-in holds", async () => {
    db.tables.completions = [
      {
        id: COMPLETION,
        user_id: AUTHOR,
        evidence_url: `https://project.supabase.co/storage/v1/object/sign/completions/${PHOTO}?token=abc`,
      },
    ];

    expect((await takeDownCompletion()).status).toBe(200);
    expect(db.log[0]).toBe(`remove:completions/${PHOTO}`);
  });

  it("changes nothing when storage refuses, so it can be tried again", async () => {
    db.storageError = { message: "storage is down" };

    const res = await takeDownCompletion();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Nothing was deleted/);
    expect(db.tables.completions).toHaveLength(1);
    expect(session.reportUpdates).toEqual([]);
  });

  it("does not close the report when the row could not be deleted", async () => {
    db.deleteError = { message: "deadlock detected" };

    const res = await takeDownCompletion();
    expect(res.status).toBe(500);
    expect(session.reportUpdates).toEqual([]);
  });

  it("only deletes what the report is about", async () => {
    // A real report, pointed at some other check-in.
    const unrelated = "99999999-9999-4999-8999-999999999999";
    db.tables.completions.push({ id: unrelated, user_id: OTHER, evidence_url: `${OTHER}/capture/fine.webp` });

    const res = await DELETE(request({ reportId: REPORT, contentType: "completion", contentId: unrelated }));
    expect(res.status).toBe(404);
    expect(db.log).toEqual([]);

    // And a report that does not exist.
    const noReport = await DELETE(
      request({ reportId: "11111111-1111-4111-8111-111111111111", contentType: "completion", contentId: COMPLETION }),
    );
    expect(noReport.status).toBe(404);
    expect(db.log).toEqual([]);
  });

  it("leaves a file alone when the row names one in somebody else's folder", async () => {
    const theirs = `${OTHER}/capture/not-the-authors.webp`;
    db.stored.add(`completions/${theirs}`);
    db.tables.completions = [{ id: COMPLETION, user_id: AUTHOR, evidence_url: theirs }];

    expect((await takeDownCompletion()).status).toBe(200);
    expect(db.log).toEqual([`delete:completions:${COMPLETION}`]);
    expect(db.stored.has(`completions/${theirs}`)).toBe(true);
  });

  it("closes the report when the content is already gone", async () => {
    db.tables.completions = [];

    const res = await takeDownCompletion();
    expect(res.status).toBe(200);
    expect(db.log).toEqual([`delete:completions:${COMPLETION}`]);
    expect(session.reportUpdates).toHaveLength(1);
  });

  it("says so when the content went but the report could not be closed", async () => {
    session.updateError = { message: "timeout" };

    const body = await (await takeDownCompletion()).json();
    expect(body).toMatchObject({ deleted: true, warning: "Content deleted but report status update failed" });
    expect(db.tables.completions).toEqual([]);
  });

  it("refuses a malformed request before touching anything", async () => {
    const bad = [
      { reportId: "nope", contentType: "completion", contentId: COMPLETION },
      { reportId: REPORT, contentType: "profile", contentId: COMPLETION },
      { reportId: REPORT, contentType: "completion", contentId: "nope" },
      { reportId: REPORT, contentType: "completion", contentId: COMPLETION, reviewerNotes: 5 },
    ];
    for (const body of bad) {
      expect((await DELETE(request(body))).status).toBe(400);
    }
    expect(db.log).toEqual([]);
  });

  it("fails clearly when the server has no service key", async () => {
    db.available = false;

    const res = await takeDownCompletion();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Server misconfigured");
    expect(db.tables.completions).toHaveLength(1);
  });
});
