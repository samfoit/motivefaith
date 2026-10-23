"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { TextArea } from "@/components/ui/TextArea";
import { FriendPicker } from "@/components/social/FriendPicker";
import { useCreateGroup } from "@/lib/hooks/useGroups";
import { useToast } from "@/components/ui/Toast";

interface NewGroupClientProps {
  userId: string;
  friends: {
    id: string;
    display_name: string;
    username: string;
    avatar_url: string | null;
  }[];
}

export function NewGroupClient({ userId, friends }: NewGroupClientProps) {
  const router = useRouter();
  const createGroup = useCreateGroup();
  const { show: showToast, ToastElements } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);

  const toggleFriend = (friendId: string) => {
    setSelectedFriends((prev) =>
      prev.includes(friendId)
        ? prev.filter((id) => id !== friendId)
        : [...prev, friendId],
    );
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;

    try {
      const group = await createGroup.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        createdBy: userId,
        initialMemberIds: selectedFriends,
      });

      showToast({ variant: "success", title: "Group created!" });
      router.push(`/main/feed/group/${group.id}`);
      router.refresh();
    } catch {
      showToast({ variant: "error", title: "Failed to create group" });
    }
  };

  return (
    <div>
      <div className="max-w-lg mx-auto px-4 pt-4 space-y-5">
        {/* Form */}
        <Input
          label="Group name"
          placeholder="e.g. Morning Accountability Crew"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        <TextArea
          label="Description (optional)"
          placeholder="What's this group about?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />

        {/* Friend picker */}
        {friends.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">
              Invite friends (optional)
            </p>
            <FriendPicker
              friends={friends}
              selectedIds={selectedFriends}
              onToggle={toggleFriend}
              mode="multi"
              searchPlaceholder="Search friends to invite\u2026"
            />
          </div>
        )}

        {/* Pinned above the bottom nav, so a long friend list doesn't push
            the button out of reach. */}
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 border-t border-border bg-[var(--color-bg-primary)] px-4 py-3">
          <Button
            className="w-full"
            size="lg"
            onClick={handleSubmit}
            loading={createGroup.isPending}
            disabled={!name.trim() || createGroup.isPending}
          >
            Create Group
          </Button>
        </div>
      </div>

      {ToastElements}
    </div>
  );
}
