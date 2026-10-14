"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export interface UseAudioPlaybackReturn {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  /** Spread onto the `<audio>` element alongside its `src`. */
  audioProps: {
    ref: React.RefObject<HTMLAudioElement | null>;
    preload: "metadata";
    onLoadedMetadata: () => void;
    onDurationChange: () => void;
    onTimeUpdate: () => void;
    onPlay: () => void;
    onPause: () => void;
    onEnded: () => void;
  };
  playing: boolean;
  /** Seconds into the file. */
  current: number;
  /** Seconds; 0 until it is known. */
  duration: number;
  toggle: () => void;
  seek: (seconds: number) => void;
}

/**
 * Play/pause, position and length for a custom-drawn `<audio>` player.
 *
 * A file straight from MediaRecorder (Chrome's webm) has no duration in its
 * header, so the element reports Infinity until it has read to the end.
 * Seeking far past the end makes it do that up front; the timeupdate that
 * follows carries the real length, and the playhead goes back to 0.
 */
export function useAudioPlayback(): UseAudioPlaybackReturn {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  /** True while forcing Chrome to work out a recorder file's length. */
  const probingRef = useRef(false);

  const onLoadedMetadata = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (Number.isFinite(el.duration)) {
      setDuration(el.duration);
      return;
    }
    probingRef.current = true;
    el.currentTime = 1e101;
  }, []);

  const onDurationChange = useCallback(() => {
    const d = audioRef.current?.duration;
    if (d && Number.isFinite(d) && !probingRef.current) setDuration(d);
  }, []);

  const onTimeUpdate = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (probingRef.current) {
      if (!Number.isFinite(el.duration)) return;
      probingRef.current = false;
      setDuration(el.duration);
      el.currentTime = 0;
      return;
    }
    setCurrent(el.currentTime);
  }, []);

  const onPlay = useCallback(() => setPlaying(true), []);
  const onPause = useCallback(() => setPlaying(false), []);
  const onEnded = useCallback(() => {
    setPlaying(false);
    setCurrent(0);
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    return () => el?.pause();
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }, []);

  const seek = useCallback((t: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = t;
    setCurrent(t);
  }, []);

  return {
    audioRef,
    audioProps: {
      ref: audioRef,
      preload: "metadata",
      onLoadedMetadata,
      onDurationChange,
      onTimeUpdate,
      onPlay,
      onPause,
      onEnded,
    },
    playing,
    current,
    duration,
    toggle,
    seek,
  };
}
