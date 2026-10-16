"use client";

import React, { useState, useCallback, useRef } from "react";
import {
  Camera,
  Link2,
  MoreHorizontal,
  Pencil,
  Shield,
  ShieldOff,
  Trash2,
  UserMinus,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { TextArea } from "@/components/ui/TextArea";
import { Sheet } from "@/components/ui/Sheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { InviteLinkSheet } from "@/components/social/InviteLinkSheet";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { AvatarCropper } from "@/components/ui/AvatarCropper";
import { uploadAvatar } from "@/lib/utils/avatar-upload";
import { MAX_AVATAR_SOURCE_BYTES } from "@/lib/constants/limits";
import {
  useUpdateGroup,
  useDeleteGroup,
  useRemoveGroupMember,
  useUpdateMemberRole,
  useRegenerateInviteCode,
} from "@/lib/hooks/useGroups";
import type { Group, GroupMemberProfile } from "@/lib/types/groups";

/** The profile page's section heading, so the two settings pages match. */
function SectionHeading({
  icon: Icon,
  children,
}: {
  icon: typeof Users;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-text-tertiary" />
      <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
        {children}
      </h2>
    </div>
  );
}

interface SettingsClientProps {
  group: Group;
  members: GroupMemberProfile[];
  userId: string;
}

export function SettingsClient({
  group,
  members,
  userId,
}: SettingsClientProps) {
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
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [updatingRoleUserId, setUpdatingRoleUserId] = useState<string | null>(
    null,
  );
  // The member whose options sheet is open, and the one being asked about
  // removal: a second step, so the sheet can close before the dialog opens.
  const [optionsFor, setOptionsFor] = useState<GroupMemberProfile | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<GroupMemberProfile | null>(null);

  // Save only shows once something has changed.
  const isDirty =
    name.trim() !== group.name ||
    description.trim() !== (group.description ?? "");

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

  // A picked photo goes to the cropper first; only the square chosen there is
  // uploaded.
  const handleAvatarPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Cleared so picking the same photo again still opens the cropper.
      e.target.value = "";
      if (!file) return;

      const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
      if (!ALLOWED_TYPES.has(file.type)) {
        showToast({
          variant: "error",
          title: "Unsupported file type",
          description: "Use JPEG, PNG, WebP, or GIF.",
        });
        return;
      }
      if (file.size > MAX_AVATAR_SOURCE_BYTES) {
        showToast({
          variant: "error",
          title: "File too large",
          description: "Choose a photo under 25 MB.",
        });
        return;
      }

      setCropFile(file);
    },
    [showToast],
  );

  const handleAvatarCropped = useCallback(
    async (blob: Blob) => {
      setCropFile(null);
      setIsUploadingAvatar(true);
      const supabase = createClient();

      let publicUrl: string;
      try {
        publicUrl = await uploadAvatar(supabase, "group-avatars", group.id, blob);
      } catch {
        showToast({ variant: "error", title: "Upload failed" });
        setIsUploadingAvatar(false);
        return;
      }

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
        setConfirmRemove(null);
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
          title:
            newRole === "admin" ? "Made an admin" : "No longer an admin",
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

  const sortedMembers = [...members].sort((x, y) => {
    // You first, then admins, then everyone else by name.
    if (x.user_id === userId) return -1;
    if (y.user_id === userId) return 1;
    if ((x.role === "admin") !== (y.role === "admin")) return x.role === "admin" ? -1 : 1;
    return x.profile.display_name.localeCompare(y.profile.display_name);
  });

  return (
    <div className="min-h-screen">
      {/* One scrolling page in the profile page's style. It used to be three
          tabs, one of them holding a single button, with member actions as
          bare chevron icons nobody could read. */}
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-5">
        {/* The group's photo: the whole avatar is the button. */}
        <div className="flex flex-col items-center gap-2 pb-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingAvatar}
            className="relative rounded-full transition-opacity active:opacity-80 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            aria-label="Change group photo"
          >
            <Avatar src={avatarUrl} name={name.trim() || group.name} size="lg" />
            <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-brand text-on-brand flex items-center justify-center shadow-sm ring-2 ring-bg-primary">
              <Camera className="w-3.5 h-3.5" />
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleAvatarPick}
          />
          <p className="text-xs text-text-tertiary" aria-live="polite">
            {isUploadingAvatar ? "Uploading…" : "Tap to change the photo"}
          </p>
        </div>

        {/* Details */}
        <section>
          <SectionHeading icon={Pencil}>Details</SectionHeading>
          <div className="rounded-lg bg-elevated p-4 shadow-sm space-y-4">
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <TextArea
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the group is for"
              rows={3}
            />
            {isDirty && (
              <Button
                onClick={handleSaveDetails}
                loading={isSaving}
                disabled={!name.trim() || isSaving}
                className="w-full"
              >
                Save changes
              </Button>
            )}
          </div>
        </section>

        {/* Members */}
        <section>
          <SectionHeading icon={Users}>
            {members.length} {members.length === 1 ? "Member" : "Members"}
          </SectionHeading>
          <div className="rounded-lg bg-elevated shadow-sm divide-y divide-border overflow-hidden">
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-brand-ink hover:bg-surface-hover transition-colors"
            >
              <span className="w-8 h-8 shrink-0 rounded-full bg-brand-light flex items-center justify-center">
                <Link2 className="w-4 h-4" />
              </span>
              Invite with a link
            </button>

            {sortedMembers.map((member) => {
              const isMe = member.user_id === userId;
              return (
                <div key={member.user_id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar
                    src={member.profile.avatar_url}
                    name={member.profile.display_name}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {member.profile.display_name}
                      {isMe && <span className="font-normal text-text-tertiary"> (you)</span>}
                    </p>
                    <p className="text-xs text-text-tertiary truncate">
                      @{member.profile.username}
                    </p>
                  </div>
                  {member.role === "admin" && (
                    <span className="shrink-0 text-xs text-text-tertiary">Admin</span>
                  )}
                  {/* Your own row has nothing to change: there's no options
                      button, so it doesn't look like there is. */}
                  {!isMe && (
                    <button
                      type="button"
                      onClick={() => setOptionsFor(member)}
                      disabled={
                        removingUserId === member.user_id ||
                        updatingRoleUserId === member.user_id
                      }
                      className="-mr-2 shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-50"
                      aria-label={`Options for ${member.profile.display_name}`}
                    >
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Delete, apart from the rest as on the profile page. */}
        <section className="pt-4 border-t border-surface-hover">
          <Button
            variant="ghost"
            size="md"
            onClick={() => setDeleteOpen(true)}
            className="w-full justify-start text-miss"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete group</span>
          </Button>
        </section>
      </div>

      {/* A member's options */}
      <Sheet
        open={!!optionsFor}
        onOpenChange={(open) => {
          if (!open) setOptionsFor(null);
        }}
        size="sm"
        title={optionsFor?.profile.display_name}
      >
        {optionsFor && (
          <div className="rounded-lg bg-bg-secondary divide-y divide-border overflow-hidden mb-4">
            <button
              type="button"
              onClick={() => {
                const member = optionsFor;
                setOptionsFor(null);
                void handleUpdateRole(
                  member.user_id,
                  member.role === "admin" ? "member" : "admin",
                );
              }}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-text-primary hover:bg-surface-hover transition-colors"
            >
              {optionsFor.role === "admin" ? (
                <ShieldOff className="w-5 h-5 text-text-secondary" />
              ) : (
                <Shield className="w-5 h-5 text-text-secondary" />
              )}
              {optionsFor.role === "admin" ? "Remove as admin" : "Make admin"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmRemove(optionsFor);
                setOptionsFor(null);
              }}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-miss hover:bg-surface-hover transition-colors"
            >
              <UserMinus className="w-5 h-5" />
              Remove from group
            </button>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={!!confirmRemove}
        onOpenChange={(open) => {
          if (!open) setConfirmRemove(null);
        }}
        title={`Remove ${confirmRemove?.profile.display_name ?? "member"}?`}
        description="They'll stop seeing the group's messages and need a new invite to come back."
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirmRemove) void handleRemoveMember(confirmRemove.user_id);
        }}
        loading={!!confirmRemove && removingUserId === confirmRemove.user_id}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${group.name}?`}
        description="Its messages, challenges and shared history are deleted for everyone. This can't be undone."
        confirmLabel="Delete group"
        onConfirm={handleDelete}
        loading={isDeleting}
      />

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

      <AvatarCropper
        file={cropFile}
        onConfirm={handleAvatarCropped}
        onCancel={() => setCropFile(null)}
        title="Move and scale group photo"
      />
      {ToastElements}
    </div>
  );
}
