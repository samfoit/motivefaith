"use client";

import { useState, useCallback } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Badge";
import { Sheet } from "@/components/ui/Sheet";
import { TextArea } from "@/components/ui/TextArea";
import { useToast } from "@/components/ui/Toast";

// ── Types ──

interface Reporter {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
}

interface CompletionContent {
  id: string;
  notes: string | null;
  evidence_url: string | null;
  completed_at: string;
  habits?: { title: string; emoji: string } | null;
}

interface MessageContent {
  id: string;
  content: string;
  created_at: string;
  groups?: { name: string } | null;
}

interface Report {
  id: string;
  reporter_id: string;
  content_type: string;
  content_id: string;
  reason: string;
  description: string | null;
  status: string;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  reviewed_by: string | null;
  created_at: string;
  reporter: Reporter | null;
  content: CompletionContent | MessageContent | null;
}

interface ModerationClientProps {
  initialReports: Report[];
  initialTotal: number;
}

// ── Constants ──

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "reviewed", label: "Reviewed" },
  { value: "actioned", label: "Actioned" },
  { value: "dismissed", label: "Dismissed" },
];

const CONTENT_TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "completion", label: "Completion" },
  { value: "message", label: "Message" },
  { value: "profile", label: "Profile" },
  { value: "group", label: "Group" },
];

const REASON_OPTIONS = [
  { value: "", label: "All reasons" },
  { value: "illegal", label: "Illegal activity" },
  { value: "csam", label: "CSAM" },
  { value: "intimate_imagery", label: "Intimate imagery" },
  { value: "copyright", label: "Copyright" },
  { value: "harassment", label: "Harassment" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
];

const REASON_LABELS: Record<string, string> = {
  illegal: "Illegal activity",
  csam: "CSAM",
  intimate_imagery: "Intimate imagery",
  copyright: "Copyright",
  harassment: "Harassment",
  spam: "Spam",
  other: "Other",
};

const STATUS_VARIANT: Record<string, "default" | "health" | "social" | "learning"> = {
  pending: "learning",
  reviewed: "default",
  actioned: "social",
  dismissed: "default",
};

// ── Component ──

export function ModerationClient({ initialReports, initialTotal }: ModerationClientProps) {
  const { show: showToast, ToastElements } = useToast();

  // Filter state
  const [statusFilter, setStatusFilter] = useState("pending");
  const [contentTypeFilter, setContentTypeFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");

  // Data state
  const [reports, setReports] = useState<Report[]>(initialReports);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  // Detail sheet
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const limit = 20;
  const totalPages = Math.ceil(total / limit);

  const fetchReports = useCallback(
    async (p: number, status: string, contentType: string, reason: string) => {
      setLoading(true);
      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (status) params.set("status", status);
      if (contentType) params.set("contentType", contentType);
      if (reason) params.set("reason", reason);

      try {
        const res = await fetch(`/api/admin/reports?${params}`);
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        setReports(data.reports);
        setTotal(data.total);
        setPage(p);
      } catch {
        showToast({ variant: "error", title: "Failed to load reports" });
      } finally {
        setLoading(false);
      }
    },
    [showToast],
  );

  const handleFilterChange = (
    newStatus?: string,
    newContentType?: string,
    newReason?: string,
  ) => {
    const s = newStatus ?? statusFilter;
    const ct = newContentType ?? contentTypeFilter;
    const r = newReason ?? reasonFilter;
    if (newStatus !== undefined) setStatusFilter(s);
    if (newContentType !== undefined) setContentTypeFilter(ct);
    if (newReason !== undefined) setReasonFilter(r);
    fetchReports(0, s, ct, r);
  };

  const handleDismiss = async (report: Report) => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId: report.id,
          status: "dismissed",
          reviewerNotes: reviewerNotes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("update failed");
      showToast({ variant: "success", title: "Report dismissed" });
      setSheetOpen(false);
      setSelectedReport(null);
      setReviewerNotes("");
      fetchReports(page, statusFilter, contentTypeFilter, reasonFilter);
    } catch {
      showToast({ variant: "error", title: "Failed to dismiss report" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteContent = async (report: Report) => {
    if (report.content_type !== "completion" && report.content_type !== "message") {
      showToast({ variant: "error", title: "Cannot delete this content type" });
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/content", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId: report.id,
          contentType: report.content_type,
          contentId: report.content_id,
          reviewerNotes: reviewerNotes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("delete failed");
      showToast({ variant: "success", title: "Content deleted and report actioned" });
      setSheetOpen(false);
      setSelectedReport(null);
      setReviewerNotes("");
      fetchReports(page, statusFilter, contentTypeFilter, reasonFilter);
    } catch {
      showToast({ variant: "error", title: "Failed to delete content" });
    } finally {
      setActionLoading(false);
    }
  };

  const openDetail = (report: Report) => {
    setSelectedReport(report);
    setReviewerNotes(report.reviewer_notes ?? "");
    setSheetOpen(true);
  };

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function renderContentPreview(report: Report) {
    if (!report.content) {
      return (
        <p className="text-xs text-[var(--color-text-tertiary)] italic">
          Content unavailable (may have been deleted)
        </p>
      );
    }

    if (report.content_type === "completion") {
      const c = report.content as CompletionContent;
      return (
        <div className="text-xs text-[var(--color-text-secondary)] space-y-0.5">
          {c.habits && (
            <p>
              {c.habits.emoji} <span className="font-medium">{c.habits.title}</span>
            </p>
          )}
          {c.notes && <p className="line-clamp-2">{c.notes}</p>}
          {c.evidence_url && <p className="text-[var(--color-brand)]">Has media</p>}
        </div>
      );
    }

    if (report.content_type === "message") {
      const m = report.content as MessageContent;
      return (
        <div className="text-xs text-[var(--color-text-secondary)] space-y-0.5">
          {m.groups && (
            <p>
              in <span className="font-medium">{m.groups.name}</span>
            </p>
          )}
          <p className="line-clamp-2">{m.content}</p>
        </div>
      );
    }

    return null;
  }

  return (
    <div className="min-h-screen pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Header */}
        <h1
          className="font-display font-bold text-[var(--color-text-primary)]"
          style={{ fontSize: "var(--text-xl)" }}
        >
          Moderation
        </h1>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2">
          <select
            value={statusFilter}
            onChange={(e) => handleFilterChange(e.target.value, undefined, undefined)}
            className="rounded-md border border-[var(--color-surface-hover)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={contentTypeFilter}
            onChange={(e) => handleFilterChange(undefined, e.target.value, undefined)}
            className="rounded-md border border-[var(--color-surface-hover)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
          >
            {CONTENT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={reasonFilter}
            onChange={(e) => handleFilterChange(undefined, undefined, e.target.value)}
            className="rounded-md border border-[var(--color-surface-hover)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-sm text-[var(--color-text-primary)]"
          >
            {REASON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Report list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-lg bg-elevated p-4 shadow-sm animate-pulse h-24"
              />
            ))}
          </div>
        ) : reports.length === 0 ? (
          <div className="rounded-lg bg-elevated p-8 shadow-sm text-center">
            <p className="text-sm text-[var(--color-text-secondary)]">
              No reports found
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <button
                key={report.id}
                type="button"
                onClick={() => openDetail(report)}
                className="w-full text-left rounded-lg bg-elevated p-4 shadow-sm hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <div className="flex items-start gap-3">
                  <Avatar
                    src={report.reporter?.avatar_url}
                    name={report.reporter?.display_name}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-[var(--color-text-primary)]">
                        {report.reporter?.display_name ?? "Unknown"}
                      </span>
                      <Pill size="sm" variant={STATUS_VARIANT[report.status] ?? "default"}>
                        {report.status}
                      </Pill>
                      <Pill size="sm">
                        {report.content_type}
                      </Pill>
                    </div>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {REASON_LABELS[report.reason] ?? report.reason}
                      {" \u00B7 "}
                      {formatDate(report.created_at)}
                    </p>
                    {report.description && (
                      <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2">
                        {report.description}
                      </p>
                    )}
                    {renderContentPreview(report)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <Button
              variant="secondary"
              size="sm"
              disabled={page === 0 || loading}
              onClick={() => fetchReports(page - 1, statusFilter, contentTypeFilter, reasonFilter)}
            >
              Previous
            </Button>
            <span className="text-xs text-[var(--color-text-secondary)]">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages - 1 || loading}
              onClick={() => fetchReports(page + 1, statusFilter, contentTypeFilter, reasonFilter)}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      {/* Detail Sheet */}
      <Sheet
        open={sheetOpen}
        onOpenChange={(v) => {
          if (!v) {
            setSelectedReport(null);
            setReviewerNotes("");
          }
          setSheetOpen(v);
        }}
        title="Report Details"
        size="lg"
      >
        {selectedReport && (
          <div className="space-y-4 mt-2">
            {/* Reporter info */}
            <div className="flex items-center gap-3">
              <Avatar
                src={selectedReport.reporter?.avatar_url}
                name={selectedReport.reporter?.display_name}
                size="md"
              />
              <div>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">
                  {selectedReport.reporter?.display_name ?? "Unknown"}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  @{selectedReport.reporter?.username ?? "unknown"}
                </p>
              </div>
            </div>

            {/* Report metadata */}
            <div className="flex flex-wrap gap-2">
              <Pill size="sm" variant={STATUS_VARIANT[selectedReport.status] ?? "default"}>
                {selectedReport.status}
              </Pill>
              <Pill size="sm">{selectedReport.content_type}</Pill>
              <Pill size="sm" variant="social">
                {REASON_LABELS[selectedReport.reason] ?? selectedReport.reason}
              </Pill>
            </div>

            <p className="text-xs text-[var(--color-text-secondary)]">
              Reported {formatDate(selectedReport.created_at)}
            </p>

            {/* Report description */}
            {selectedReport.description && (
              <div>
                <p className="text-xs font-medium text-[var(--color-text-primary)] mb-1">
                  Description
                </p>
                <p className="text-sm text-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)] rounded-md p-3">
                  {selectedReport.description}
                </p>
              </div>
            )}

            {/* Content preview */}
            <div>
              <p className="text-xs font-medium text-[var(--color-text-primary)] mb-1">
                Reported Content
              </p>
              <div className="bg-[var(--color-bg-secondary)] rounded-md p-3">
                {renderContentPreview(selectedReport)}
              </div>
            </div>

            {/* Reviewer notes */}
            <TextArea
              label="Reviewer notes"
              placeholder="Add notes about this review..."
              value={reviewerNotes}
              onChange={(e) => setReviewerNotes(e.target.value)}
              maxLength={2000}
              rows={3}
            />

            {/* Actions */}
            {selectedReport.status === "pending" && (
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  className="flex-1"
                  loading={actionLoading}
                  onClick={() => handleDismiss(selectedReport)}
                >
                  Dismiss
                </Button>
                {(selectedReport.content_type === "completion" ||
                  selectedReport.content_type === "message") && (
                  <Button
                    variant="primary"
                    className="flex-1 bg-[var(--color-miss)] hover:bg-[var(--color-miss)]/90"
                    loading={actionLoading}
                    onClick={() => handleDeleteContent(selectedReport)}
                  >
                    Delete Content
                  </Button>
                )}
              </div>
            )}

            {selectedReport.reviewed_at && (
              <p className="text-xs text-[var(--color-text-tertiary)]">
                Reviewed {formatDate(selectedReport.reviewed_at)}
              </p>
            )}
          </div>
        )}
      </Sheet>

      {ToastElements}
    </div>
  );
}
