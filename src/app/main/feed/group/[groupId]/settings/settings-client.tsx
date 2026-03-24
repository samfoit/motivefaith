"use client";

import React, { useState, useCallback, useRef } from "react";
import { ArrowLeft, Shield, UserMinus, ChevronUp, ChevronDown, Camera } from "lucide-react";
import * as Tabs from "@radix-ui/react-tabs";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { TextArea } from "@/components/ui/TextArea";
import { Pill } from "@/components/ui/Badge";
import { InviteLinkSheet } from "@/components/social/InviteLinkSheet";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import {
  useUpdateGroup,
  useDeleteGroup,
  useRemoveGroupMember,
  useUpdateMemberRole,
  useRegenerateInviteCode,
} from "@/lib/hooks/useGroups";
import type { Group, GroupMemberProfile } from "@/lib/types/groups";

const TAB_TRIGGER_CLASS = cn(
  "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
  "text-[var(--color-text-secondary)]",
  "data-[state=active]:bg-brand data-[state=active]:text-white",
  "hover:text-[var(--color-text-primary)]",
);

interface SettingsClientProps {
  group: Group;
  members: GroupMemberProfile[];
  userId: string;
}

export function SettingsClient({ group, members, userId }: SettingsClientProps) {
  const router = useRouter();
  const { show: showToast, ToastElements } = useToast();

  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const removeMember = useRemoveGroupMember();
  const updateRole = useUpdateMemberRole();
  const regenerateCode = useRegenerateInviteCode();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [avatarUrl, setAvatarUrl] = useState(group.avatar_url ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [updatingRoleUserId, setUpdatingRoleUserId] = useState<string | null>(null);

  const handleSaveDetails = useCallback(async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      await updateGroup.mutateAsync({
        groupId: group.id,
        updates: {
          name: name.trim(),
          description: description.trim() || null,
        },
      });
      showToast({ variant: "success", title: "Group updated" });
      router.refresh();
    } catch {
      showToast({ variant: "error", title: "Failed to update" });
    } finally {
      setIsSaving(false);
    }
  }, [name, description, group.id, updateGroup, showToast, router]);

  const handleAvatarUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const ALLOWED_TYPES: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
      };
      const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

      const ext = ALLOWED_TYPES[file.type];
      if (!ext) {
        showToast({
          variant: "error",
          title: "Unsupported file type",
          description: "Use JPEG, PNG, WebP, or GIF.",
        });
        return;
      }
      if (file.size > MAX_SIZE) {
        showToast({
          variant: "error",
          title: "File too large",
          description: "Image must be under 5 MB.",
        });
        return;
      }

      setIsUploadingAvatar(true);
      const supabase = createClient();
      const path = `${group.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("group-avatars")
        .upload(path, file, { upsert: true });

      if (uploadError) {
        showToast({ variant: "error", title: "Upload failed" });
        setIsUploadingAvatar(false);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("group-avatars").getPublicUrl(path);

      try {
        await updateGroup.mutateAsync({
          groupId: group.id,
          updates: { avatar_url: publicUrl },
        });
        setAvatarUrl(publicUrl);
        showToast({ variant: "success", title: "Group photo updated" });
        router.refresh();
      } catch {
        showToast({ variant: "error", title: "Failed to update group photo" });
      } finally {
        setIsUploadingAvatar(false);
      }
    },
    [group.id, updateGroup, showToast, router],
  );

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      setRemovingUserId(memberId);
      try {
        await removeMember.mutateAsync({
          groupId: group.id,
          userId: memberId,
        });
        showToast({ variant: "info", title: "Member removed" });
        router.refresh();
      } catch {
        showToast({ variant: "error", title: "Failed to remove" });
      } finally {
        setRemovingUserId(null);
      }
    },
    [group.id, removeMember, showToast, router],
  );

  const handleUpdateRole = useCallback(
    async (memberId: string, newRole: "admin" | "member") => {
      setUpdatingRoleUserId(memberId);
      try {
        await updateRole.mutateAsync({
          groupId: group.id,
          userId: memberId,
          role: newRole,
        });
        showToast({
          variant: "success",
          title: newRole === "admin" ? "Promoted to admin" : "Demoted to member",
        });
        router.refresh();
      } catch {
        showToast({ variant: "error", title: "Failed to update role" });
      } finally {
        setUpdatingRoleUserId(null);
      }
    },
    [group.id, updateRole, showToast, router],
  );

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await deleteGroup.mutateAsync(group.id);
      router.replace("/main/feed");
    } catch {
      showToast({ variant: "error", title: "Failed to delete group" });
      setIsDeleting(false);
    }
  }, [group.id, deleteGroup, router, showToast]);

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 pt-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 text-[var(--color-text-secondary)]" />
          </button>
          <h1
            className="font-display font-bold text-[var(--color-text-primary)]"
            style={{ fontSize: "var(--text-xl)" }}
          >
            Group Settings
          </h1>
        </div>

        <Tabs.Root defaultValue="details">
          <Tabs.List
            className="flex gap-1 p-1 rounded-lg bg-[var(--color-bg-secondary)] mb-6"
            aria-label="Group settings sections"
          >
            <Tabs.Trigger value="details" className={TAB_TRIGGER_CLASS}>
              Details
            </Tabs.Trigger>
            <Tabs.Trigger value="members" className={TAB_TRIGGER_CLASS}>
              Members
            </Tabs.Trigger>
            <Tabs.Trigger value="invites" className={TAB_TRIGGER_CLASS}>
              Invites
            </Tabs.Trigger>
          </Tabs.List>

          {/* Details Tab */}
          <Tabs.Content value="details" className="space-y-4">
            {/* Group photo */}
            <div className="flex flex-col items-center gap-2">
              <div className="relative">
                <Avatar src={avatarUrl} name={group.name} size="lg" />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingAvatar}
                  className={cn(
                    "absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-brand text-white",
                    "flex items-center justify-center shadow-sm",
                    "hover:bg-brand-hover transition-colors",
                    "disabled:opacity-50",
                  )}
                  aria-label="Change group photo"
                >
                  <Camera className="w-3.5 h-3.5" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={handleAvatarUpload}
                />
              </div>
              <p className="text-xs text-[var(--color-text-tertiary)]">
                {isUploadingAvatar ? "Uploading…" : "Tap to change group photo"}
              </p>
            </div>

            <Input
              label="Group name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <TextArea
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
            <Button
              onClick={handleSaveDetails}
              loading={isSaving}
              disabled={!name.trim() || isSaving}
              className="w-full"
            >
              Save changes
            </Button>

            {/* Danger zone */}
            <div className="mt-8 rounded-lg bg-elevated p-4 shadow-sm border border-red-100">
              <p className="text-sm font-medium text-miss">Delete group</p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 mb-3">
                This permanently deletes the group and all its data
              </p>
              {!deleteConfirm ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setDeleteConfirm(true)}
                >
                  <span className="text-miss">Delete group</span>
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteConfirm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleDelete}
                    loading={isDeleting}
                    className="bg-miss hover:bg-red-600 text-white"
                  >
                    Confirm delete
                  </Button>
                </div>
              )}
            </div>
          </Tabs.Content>

          {/* Members Tab */}
          <Tabs.Content value="members" className="space-y-2">
            {members.map((member) => {
              const isMe = member.user_id === userId;
              return (
                <div
                  key={member.user_id}
                  className="flex items-center gap-3 rounded-lg bg-elevated p-3 shadow-sm"
                >
                  <Avatar
                    src={member.profile.avatar_url}
                    name={member.profile.display_name}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {member.profile.display_name}
                        {isMe && " (you)"}
                      </p>
                      {member.role === "admin" && (
                        <Pill size="sm" variant="default">
                          <Shield className="w-3 h-3 mr-0.5" />
                          Admin
                        </Pill>
                      )}
                    </div>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      @{member.profile.username}
                    </p>
                  </div>

                  {/* Admin actions (don't show for self) */}
                  {!isMe && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateRole(
                            member.user_id,
                            member.role === "admin" ? "member" : "admin",
                          )
                        }
                        disabled={updatingRoleUserId === member.user_id}
                        className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-50"
                        title={
                          member.role === "admin"
                            ? "Demote to member"
                            : "Promote to admin"
                        }
                      >
                        {member.role === "admin" ? (
                          <ChevronDown className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                        ) : (
                          <ChevronUp className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(member.user_id)}
                        disabled={removingUserId === member.user_id}
                        className="p-1.5 rounded-lg hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] hover:text-miss transition-colors disabled:opacity-50"
                        title="Remove member"
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </Tabs.Content>

          {/* Invites Tab */}
          <Tabs.Content value="invites" className="space-y-4">
            <p className="text-sm text-[var(--color-text-secondary)]">
              Share this invite link with friends to add them to the group.
            </p>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => setInviteOpen(true)}
            >
              View invite link
            </Button>
          </Tabs.Content>
        </Tabs.Root>
      </div>

      <InviteLinkSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        inviteCode={group.invite_code}
        isAdmin={true}
        onRegenerate={async () => {
          await regenerateCode.mutateAsync(group.id);
          router.refresh();
        }}
      />

      {ToastElements}
    </div>
  );
}
