"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextArea";
import { useToast } from "@/components/ui/Toast";
const REASONS = [
  { value: "illegal", label: "Illegal activity" },
  { value: "csam", label: "Child exploitation (CSAM)" },
  { value: "intimate_imagery", label: "Non-consensual intimate imagery" },
  { value: "copyright", label: "Copyright infringement" },
  { value: "harassment", label: "Harassment or abuse" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
] as const;

interface ReportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: "completion" | "message" | "profile" | "group";
  contentId: string;
}

export function ReportSheet({
  open,
  onOpenChange,
  contentType,
  contentId,
}: ReportSheetProps) {
  const { show } = useToast();
  const [reason, setReason] = useState<string>("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  function reset() {
    setReason("");
    setDescription("");
  }

  async function handleSubmit() {
    if (!reason) return;

    setLoading(true);

    // Auth is handled via cookies by createServerSupabase() in the API route.
    // No Authorization header needed — same-origin fetch includes cookies automatically.
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contentType,
        contentId,
        reason,
        description: description.trim() || undefined,
      }),
    });

    setLoading(false);

    if (res.ok) {
      show({
        title: "Report submitted",
        description: "Thank you. We will review this content.",
        variant: "success",
      });
      reset();
      onOpenChange(false);
    } else if (res.status === 429) {
      show({
        title: "Too many reports",
        description: "Please wait before submitting another report.",
        variant: "error",
      });
    } else {
      show({
        title: "Report failed",
        description: "Something went wrong. Please try again.",
        variant: "error",
      });
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
      title="Report Content"
      description="Select a reason for reporting this content."
      size="md"
    >
      <fieldset className="space-y-2 mt-2">
        <legend className="sr-only">Report reason</legend>
        {REASONS.map((r) => (
          <label
            key={r.value}
            className="flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            <input
              type="radio"
              name="report-reason"
              value={r.value}
              checked={reason === r.value}
              onChange={() => setReason(r.value)}
              className="w-4 h-4 accent-[var(--color-brand)]"
            />
            <span className="text-sm text-[var(--color-text-primary)]">
              {r.label}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="mt-4">
        <TextArea
          label="Additional details (optional)"
          placeholder="Provide any additional context..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={3}
        />
      </div>

      <div className="mt-4 flex gap-3">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => {
            reset();
            onOpenChange(false);
          }}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          disabled={!reason}
          loading={loading}
          onClick={handleSubmit}
        >
          Submit Report
        </Button>
      </div>
    </Sheet>
  );
}
