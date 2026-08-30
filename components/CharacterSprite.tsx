"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

export type CharacterDirection = "down" | "up" | "left" | "right";

export type CharacterSpriteProps = {
  /** Playable role ("student" | "auto_driver") or NPC identifier. */
  characterId?: string;
  /** Character display name (e.g. "Aarav", "Raju", "Meera Tai"). */
  characterName: string;
  /** Facing direction. */
  direction?: CharacterDirection;
  /** Is the character actively walking? */
  isMoving?: boolean;
  /** Is this an NPC? */
  isNpc?: boolean;
  /** True when the player is close enough to interact with this NPC. */
  nearPlayer?: boolean;
  /** True while this NPC is mid-conversation, so it animates as if speaking. */
  isTalking?: boolean;
  /** Custom sizing or positioning classes. */
  className?: string;
};

/**
 * Preloaded sprite registry pointing to transparent 16-bit character frames.
 */
/**
 * Sprite registry generated from the transparent 16-bit frames on disk.
 * Every generated frame is registered here so animations use the full set.
 */
const SPRITE_PATHS: Record<string, Record<string, string[]>> = {
  aarav: {
    down: [
      "/aamchi-boli/sprites/aarav/down-0.png",
      "/aamchi-boli/sprites/aarav/down-1.png",
      "/aamchi-boli/sprites/aarav/down-2.png",
      "/aamchi-boli/sprites/aarav/down-3.png",
    ],
    left: [
      "/aamchi-boli/sprites/aarav/left-0.png",
      "/aamchi-boli/sprites/aarav/left-1.png",
      "/aamchi-boli/sprites/aarav/left-2.png",
      "/aamchi-boli/sprites/aarav/left-3.png",
    ],
    right: [
      "/aamchi-boli/sprites/aarav/right-0.png",
      "/aamchi-boli/sprites/aarav/right-1.png",
      "/aamchi-boli/sprites/aarav/right-2.png",
      "/aamchi-boli/sprites/aarav/right-3.png",
    ],
    up: [
      "/aamchi-boli/sprites/aarav/up-0.png",
      "/aamchi-boli/sprites/aarav/up-1.png",
      "/aamchi-boli/sprites/aarav/up-2.png",
      "/aamchi-boli/sprites/aarav/up-3.png",
    ],
  },
  ananya: {
    idle: [
      "/aamchi-boli/sprites/ananya/idle-0.png",
      "/aamchi-boli/sprites/ananya/idle-1.png",
      "/aamchi-boli/sprites/ananya/idle-2.png",
      "/aamchi-boli/sprites/ananya/idle-3.png",
    ],
    left: [
      "/aamchi-boli/sprites/ananya/left-0.png",
      "/aamchi-boli/sprites/ananya/left-1.png",
      "/aamchi-boli/sprites/ananya/left-2.png",
      "/aamchi-boli/sprites/ananya/left-3.png",
    ],
    right: [
      "/aamchi-boli/sprites/ananya/right-0.png",
      "/aamchi-boli/sprites/ananya/right-1.png",
      "/aamchi-boli/sprites/ananya/right-2.png",
      "/aamchi-boli/sprites/ananya/right-3.png",
    ],
    wave: [
      "/aamchi-boli/sprites/ananya/wave-0.png",
      "/aamchi-boli/sprites/ananya/wave-1.png",
      "/aamchi-boli/sprites/ananya/wave-2.png",
      "/aamchi-boli/sprites/ananya/wave-3.png",
    ],
  },
  meera: {
    idle: [
      "/aamchi-boli/sprites/meera/idle-0.png",
      "/aamchi-boli/sprites/meera/idle-1.png",
      "/aamchi-boli/sprites/meera/idle-2.png",
      "/aamchi-boli/sprites/meera/idle-3.png",
    ],
    left: [
      "/aamchi-boli/sprites/meera/left-0.png",
      "/aamchi-boli/sprites/meera/left-1.png",
      "/aamchi-boli/sprites/meera/left-2.png",
      "/aamchi-boli/sprites/meera/left-3.png",
    ],
    right: [
      "/aamchi-boli/sprites/meera/right-0.png",
      "/aamchi-boli/sprites/meera/right-1.png",
      "/aamchi-boli/sprites/meera/right-2.png",
      "/aamchi-boli/sprites/meera/right-3.png",
    ],
    talk: [
      "/aamchi-boli/sprites/meera/talk-0.png",
      "/aamchi-boli/sprites/meera/talk-1.png",
      "/aamchi-boli/sprites/meera/talk-2.png",
      "/aamchi-boli/sprites/meera/talk-3.png",
    ],
    wave: [
      "/aamchi-boli/sprites/meera/wave-0.png",
      "/aamchi-boli/sprites/meera/wave-1.png",
      "/aamchi-boli/sprites/meera/wave-2.png",
      "/aamchi-boli/sprites/meera/wave-3.png",
    ],
  },
  nisha: {
    idle: [
      "/aamchi-boli/sprites/nisha/idle-0.png",
    ],
    left: [
      "/aamchi-boli/sprites/nisha/left-0.png",
      "/aamchi-boli/sprites/nisha/left-1.png",
    ],
    point: [
      "/aamchi-boli/sprites/nisha/point-0.png",
      "/aamchi-boli/sprites/nisha/point-1.png",
    ],
    right: [
      "/aamchi-boli/sprites/nisha/right-0.png",
      "/aamchi-boli/sprites/nisha/right-1.png",
    ],
    up: [
      "/aamchi-boli/sprites/nisha/up-0.png",
      "/aamchi-boli/sprites/nisha/up-1.png",
    ],
    wave: [
      "/aamchi-boli/sprites/nisha/wave-0.png",
    ],
  },
  raju: {
    down: [
      "/aamchi-boli/sprites/raju/down-0.png",
      "/aamchi-boli/sprites/raju/down-1.png",
      "/aamchi-boli/sprites/raju/down-2.png",
      "/aamchi-boli/sprites/raju/down-3.png",
    ],
    left: [
      "/aamchi-boli/sprites/raju/left-0.png",
      "/aamchi-boli/sprites/raju/left-1.png",
      "/aamchi-boli/sprites/raju/left-2.png",
      "/aamchi-boli/sprites/raju/left-3.png",
    ],
    right: [
      "/aamchi-boli/sprites/raju/right-0.png",
      "/aamchi-boli/sprites/raju/right-1.png",
      "/aamchi-boli/sprites/raju/right-2.png",
      "/aamchi-boli/sprites/raju/right-3.png",
    ],
    up: [
      "/aamchi-boli/sprites/raju/up-0.png",
      "/aamchi-boli/sprites/raju/up-1.png",
      "/aamchi-boli/sprites/raju/up-2.png",
      "/aamchi-boli/sprites/raju/up-3.png",
    ],
  },
};

/**
 * Return the first animation track this character actually has, walking a
 * preference list. Frame counts differ per character, so nothing may assume a
 * fixed track exists.
 */
function pickTrack(key: string, preferred: string[]): string[] {
  const set = SPRITE_PATHS[key] ?? {};
  for (const name of preferred) {
    const frames = set[name];
    if (frames && frames.length > 0) return frames;
  }
  const fallback = Object.values(set).find((frames) => frames.length > 0);
  return fallback ?? [];
}

/**
 * Build a moving cycle for an NPC. Characters were generated with different
 * frame sets, so when none of the preferred tracks has more than one frame we
 * stitch the single frames together rather than leaving the NPC frozen.
 */
function npcCycle(key: string, preferred: string[]): string[] {
  const set = SPRITE_PATHS[key] ?? {};
  for (const name of preferred) {
    const frames = set[name];
    if (frames && frames.length > 1) return frames;
  }
  const stitched = [...new Set(preferred.flatMap((name) => (set[name] ?? []).slice(0, 2)))];
  return stitched.length > 0 ? stitched : pickTrack(key, preferred);
}

function resolveCharacterKey(characterId?: string, name?: string): "aarav" | "raju" | "meera" | "nisha" | "ananya" {
  const normId = (characterId ?? "").toLowerCase();
  const normName = (name ?? "").toLowerCase();

  if (normId === "student" || normName.includes("aarav")) return "aarav";
  if (normId === "auto_driver" || normName.includes("raju")) return "raju";
  if (normId.includes("meera") || normName.includes("meera")) return "meera";
  if (normId.includes("nisha") || normName.includes("nisha")) return "nisha";
  if (normId.includes("ananya") || normName.includes("ananya")) return "ananya";

  return "aarav";
}

/**
 * Animated pixel-art character sprite with transparent background.
 */
export function CharacterSprite({
  characterId,
  characterName,
  direction = "down",
  isMoving = false,
  isNpc = false,
  nearPlayer = false,
  isTalking = false,
  className = "",
}: CharacterSpriteProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [npcWaveIndex, setNpcWaveIndex] = useState(0);
  const [imageError, setImageError] = useState(false);

  const characterKey = useMemo(
    () => resolveCharacterKey(characterId, characterName),
    [characterId, characterName]
  );

  // Playable walk cycle tick
  useEffect(() => {
    if (!isMoving || isNpc) return;
    const interval = setInterval(() => {
      setFrameIndex((current) => (current + 1) % 4);
    }, 135);
    return () => clearInterval(interval);
  }, [isMoving, isNpc]);

  // NPC idle / waving / talking cycle tick. Talking reads faster than idling.
  useEffect(() => {
    if (!isNpc) return;
    const interval = setInterval(
      () => setNpcWaveIndex((current) => (current + 1) % 12),
      isTalking ? 220 : nearPlayer ? 300 : 420
    );
    return () => clearInterval(interval);
  }, [isNpc, isTalking, nearPlayer]);

  // Determine current image source
  const currentWalkFrame = isMoving && !isNpc ? frameIndex : 0;
  const imageSrc = useMemo(() => {
    if (isNpc) {
      const track = isTalking
        ? npcCycle(characterKey, ["talk", "point", "wave", "idle"])
        : nearPlayer
          ? npcCycle(characterKey, ["wave", "point", "talk", "idle"])
          : npcCycle(characterKey, ["idle", "wave"]);
      return track.length ? track[npcWaveIndex % track.length] : "";
    }

    // Playable character: walk cycle for the current facing.
    const dirFrames = pickTrack(characterKey, [direction, "down", "idle"]);
    return dirFrames.length ? dirFrames[currentWalkFrame % dirFrames.length] : "";
  }, [characterKey, currentWalkFrame, direction, isNpc, isTalking, nearPlayer, npcWaveIndex]);

  const bobOffset = isMoving ? (frameIndex % 2 === 1 ? -3 : 0) : 0;

  return (
    <div
      className={`relative flex flex-col items-center select-none ${className}`}
      style={{ imageRendering: "pixelated" }}
    >
      {/* Ground contact shadow */}
      <div
        className="absolute bottom-0 h-2.5 w-8 rounded-full bg-black/40 blur-[0.5px] transition-transform duration-75"
        style={{
          transform: isMoving ? `scale(${frameIndex % 2 === 1 ? 0.9 : 1.05})` : "scale(1)",
        }}
        aria-hidden="true"
      />

      {/* NPC Interactive Ground Halo */}
      {isNpc && (
        <div
          className={`pointer-events-none absolute -bottom-1 h-5 w-11 rounded-full border-2 border-[#ffbf00] transition-all duration-300 ${
            nearPlayer
              ? "bg-[#ffbf00]/30 shadow-[0_0_12px_#ffbf00] animate-pulse scale-110"
              : "bg-[#ffbf00]/15 opacity-75"
          }`}
          aria-hidden="true"
        />
      )}

      {/* Footstep dust particles when moving */}
      {isMoving && !isNpc && (
        <div
          className="pointer-events-none absolute bottom-1 h-1 w-2 rounded-full bg-[#fff6dd]/60 blur-[0.3px] transition-all duration-100"
          style={{
            left: frameIndex % 2 === 1 ? "18%" : "68%",
            opacity: frameIndex % 2 === 1 ? 0.8 : 0.4,
          }}
          aria-hidden="true"
        />
      )}

      {/* Main Character Sprite Image */}
      <div
        className="relative h-14 w-11 transition-transform duration-75"
        style={{
          transform: `translateY(${bobOffset}px)`,
        }}
      >
        {!imageError ? (
          <Image
            src={imageSrc}
            alt={`${characterName} sprite`}
            fill
            sizes="48px"
            unoptimized
            priority
            onError={() => setImageError(true)}
            className="object-contain [image-rendering:pixelated] drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]"
          />
        ) : (
          /* High-quality pixel fallback if asset load blips */
          <div className="relative h-full w-full flex items-center justify-center">
            <span className="h-9 w-7 border-2 border-[#130f0b] bg-[#f7b578] shadow-[2px_2px_0_#130f0b] rounded-sm" />
          </div>
        )}
      </div>
    </div>
  );
}
