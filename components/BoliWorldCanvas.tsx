"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CharacterSprite, type CharacterDirection } from "@/components/CharacterSprite";
import { useCoarsePointer } from "@/components/MobileControls";
import { getCachedImage, preloadImage } from "@/lib/image-cache";
import type { BoliMapHotspot, BoliMission, BoliWorldRect } from "@/lib/types/shared";

type Axis = "up" | "down" | "left" | "right";

export type BoliWorldPlayerState = {
  x: number;
  y: number;
  direction: CharacterDirection;
  isMoving: boolean;
};

export type BoliWorldCanvasProps = {
  mission: BoliMission;
  imageSrc?: string;
  characterName: string;
  paused?: boolean;
  completed?: boolean;
  onInteract: (hotspot: BoliMapHotspot) => void;
  onNearChange?: (hotspot: BoliMapHotspot | null) => void;
  onPosition?: (position: BoliWorldPlayerState) => void;
};

const KEY_TO_AXIS: Record<string, Axis | undefined> = {
  w: "up",
  arrowup: "up",
  s: "down",
  arrowdown: "down",
  a: "left",
  arrowleft: "left",
  d: "right",
  arrowright: "right",
};
const MIN_X = 4;
const MAX_X = 96;
const MIN_Y = 14;
const MAX_Y = 88;
const SPEED = 30;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function insideRect(x: number, y: number, rect: BoliWorldRect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function canStand(x: number, y: number, mission: BoliMission) {
  const zones = mission.walkableZones?.length ? mission.walkableZones : mission.walkable;
  if (zones.length && !zones.some((zone) => insideRect(x, y, "w" in zone ? zone : { ...zone, w: zone.width, h: zone.height }))) return false;
  return !(mission.blockers ?? []).some((rect) => insideRect(x, y, rect));
}

function isEditableTarget(target: EventTarget | null) {
  const node = target instanceof HTMLElement ? target : null;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return [node, active].some((item) => item instanceof HTMLInputElement || item instanceof HTMLTextAreaElement || item?.isContentEditable);
}

function spriteIdForHotspot(hotspot: BoliMapHotspot, mission: BoliMission) {
  if (hotspot.id.includes("meera")) return "meera";
  if (hotspot.id.includes("nisha")) return "nisha";
  if (hotspot.id.includes("raju")) return "raju";
  return mission.npcName;
}

function closestHotspot(player: BoliWorldPlayerState, hotspots: BoliMapHotspot[]) {
  const npcs = hotspots.filter((hotspot) => hotspot.kind === "npc");
  let best: BoliMapHotspot | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const hotspot of npcs) {
    const distance = Math.hypot(player.x - hotspot.x, player.y - hotspot.y);
    if (distance <= hotspot.radius && distance < bestDistance) {
      best = hotspot;
      bestDistance = distance;
    }
  }
  return best;
}

/** Full-viewport canvas world with code-owned collision and a touch joystick. */
export function BoliWorldCanvas({
  mission,
  imageSrc,
  characterName,
  paused = false,
  completed = false,
  onInteract,
  onNearChange,
  onPosition,
}: BoliWorldCanvasProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const keysRef = useRef(new Set<Axis>());
  const touchRef = useRef({ x: 0, y: 0 });
  const playerRef = useRef<BoliWorldPlayerState>({ ...mission.playerStart, direction: "right", isMoving: false });
  const pausedRef = useRef(paused);
  const missionRef = useRef(mission);
  const onInteractRef = useRef(onInteract);
  const onNearRef = useRef(onNearChange);
  const onPositionRef = useRef(onPosition);
  const nearRef = useRef<string | null>(null);
  const [player, setPlayer] = useState<BoliWorldPlayerState>(() => ({ ...mission.playerStart, direction: "right", isMoving: false }));
  const [nearHotspotId, setNearHotspotId] = useState<string | null>(null);
  const [joystick, setJoystick] = useState({ active: false, x: 0, y: 0 });
  const [landscapeHint, setLandscapeHint] = useState(false);
  const coarsePointer = useCoarsePointer();

  const hotspots = useMemo(() => mission.mapHotspots?.length ? mission.mapHotspots : [{
    id: `${mission.id}-npc`, kind: "npc" as const, name: mission.npcName,
    x: mission.npcPosition.x, y: mission.npcPosition.y, radius: 13,
  }], [mission]);
  const npcHotspot = hotspots.find((hotspot) => hotspot.kind === "npc") ?? hotspots[0];

  useEffect(() => {
    pausedRef.current = paused;
    if (paused) keysRef.current.clear();
  }, [paused]);
  useEffect(() => {
    onInteractRef.current = onInteract;
    onNearRef.current = onNearChange;
    onPositionRef.current = onPosition;
  }, [onInteract, onNearChange, onPosition]);
  useEffect(() => {
    missionRef.current = mission;
    playerRef.current = { ...mission.playerStart, direction: "right", isMoving: false };
    nearRef.current = null;
    onNearRef.current?.(null);
  }, [mission]);

  useEffect(() => {
    const checkOrientation = () => setLandscapeHint(window.innerWidth < 700 && window.innerHeight > window.innerWidth);
    checkOrientation();
    window.addEventListener("resize", checkOrientation);
    return () => window.removeEventListener("resize", checkOrientation);
  }, []);

  useEffect(() => {
    const source = imageSrc || mission.mapAssetPath || "";
    let cancelled = false;
    imageRef.current = getCachedImage(source);
    if (source && !imageRef.current) {
      preloadImage(source).then((img) => {
        if (!cancelled) imageRef.current = img;
      }).catch(() => {});
    }
    return () => { cancelled = true; imageRef.current = null; };
  }, [imageSrc, mission.mapAssetPath]);

  const interact = useCallback(() => {
    if (pausedRef.current || completed) return;
    const near = closestHotspot(playerRef.current, missionRef.current.mapHotspots ?? []);
    if (near) onInteractRef.current(near);
  }, [completed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (pausedRef.current || isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const axis = KEY_TO_AXIS[key];
      if (axis) {
        event.preventDefault();
        keysRef.current.add(axis);
        if (!event.repeat) {
          const current = playerRef.current;
          const dx = axis === "left" ? -1 : axis === "right" ? 1 : 0;
          const dy = axis === "up" ? -1 : axis === "down" ? 1 : 0;
          const nextX = clamp(current.x + dx * 1.2, MIN_X, MAX_X);
          const nextY = clamp(current.y + dy * 1.2, MIN_Y, MAX_Y);
          const resolvedX = canStand(nextX, current.y, missionRef.current) ? nextX : current.x;
          const resolvedY = canStand(resolvedX, nextY, missionRef.current) ? nextY : current.y;
          const next = {
            x: resolvedX,
            y: resolvedY,
            direction: axis,
            isMoving: resolvedX !== current.x || resolvedY !== current.y,
          };
          playerRef.current = next;
          setPlayer(next);
          onPositionRef.current?.(next);
        }
      } else if ((key === "e" || key === "enter") && !event.repeat) {
        event.preventDefault();
        interact();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const axis = KEY_TO_AXIS[event.key.toLowerCase()];
      if (axis) keysRef.current.delete(axis);
    };
    const clear = () => keysRef.current.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clear);
    };
  }, [interact]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const current = playerRef.current;
      if (!pausedRef.current && !completed) {
        let x = 0;
        let y = 0;
        if (keysRef.current.has("left")) x -= 1;
        if (keysRef.current.has("right")) x += 1;
        if (keysRef.current.has("up")) y -= 1;
        if (keysRef.current.has("down")) y += 1;
        x += touchRef.current.x;
        y += touchRef.current.y;
        const length = Math.hypot(x, y);
        if (length > 1) { x /= length; y /= length; }
        const moving = Math.abs(x) + Math.abs(y) > 0.05;
        if (moving) {
          const direction: CharacterDirection = Math.abs(x) >= Math.abs(y) ? (x < 0 ? "left" : "right") : (y < 0 ? "up" : "down");
          const nextX = clamp(current.x + x * SPEED * dt, MIN_X, MAX_X);
          const nextY = clamp(current.y + y * SPEED * dt, MIN_Y, MAX_Y);
          const resolvedX = canStand(nextX, current.y, missionRef.current) ? nextX : current.x;
          const resolvedY = canStand(resolvedX, nextY, missionRef.current) ? nextY : current.y;
          const next = { x: resolvedX, y: resolvedY, direction, isMoving: resolvedX !== current.x || resolvedY !== current.y };
          playerRef.current = next;
          setPlayer(next);
          onPositionRef.current?.(next);
        } else if (current.isMoving) {
          const next = { ...current, isMoving: false };
          playerRef.current = next;
          setPlayer(next);
          onPositionRef.current?.(next);
        }
      }
      const near = closestHotspot(playerRef.current, hotspots);
      const nearId = near?.id ?? null;
      if (nearRef.current !== nearId) {
        nearRef.current = nearId;
        setNearHotspotId(nearId);
        onNearRef.current?.(near);
      }
      const canvas = canvasRef.current;
      const root = rootRef.current;
      if (!canvas || !root) return;
      const rect = root.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const width = rect.width;
      const height = rect.height;
      const img = imageRef.current;
      if (img?.naturalWidth) {
        const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
        const drawW = img.naturalWidth * scale;
        const drawH = img.naturalHeight * scale;
        ctx.drawImage(img, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
      } else {
        ctx.fillStyle = "#2d211b";
        ctx.fillRect(0, 0, width, height);
      }
      // Canvas-owned world affordances: objective pulse, landmark dots, and a subtle vignette.
      const pulse = 0.55 + Math.sin(now / 380) * 0.2;
      for (const hotspot of hotspots) {
        const px = (hotspot.x / 100) * width;
        const py = (hotspot.y / 100) * height;
        if (hotspot.kind === "npc") {
          ctx.beginPath();
          ctx.arc(px, py + 22, nearId === hotspot.id ? 28 : 18, 0, Math.PI * 2);
          ctx.strokeStyle = nearId === hotspot.id ? `rgba(255,191,0,${pulse})` : "rgba(255,246,221,.42)";
          ctx.lineWidth = nearId === hotspot.id ? 4 : 2;
          ctx.stroke();
        } else if (hotspot.kind === "landmark" || hotspot.kind === "goal") {
          ctx.fillStyle = hotspot.kind === "goal" ? `rgba(217,255,131,${pulse})` : "rgba(255,246,221,.7)";
          ctx.fillRect(px - 3, py - 3, 6, 6);
        }
      }
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "rgba(7,5,4,.2)");
      gradient.addColorStop(0.6, "rgba(7,5,4,0)");
      gradient.addColorStop(1, "rgba(7,5,4,.68)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [completed, hotspots]);

  const setTouchVector = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.max(1, Math.hypot(dx, dy));
    const scale = Math.min(1, 34 / distance);
    const next = { x: (dx / 34) * scale, y: (dy / 34) * scale };
    touchRef.current = next;
    setJoystick({ active: true, x: next.x * 23, y: next.y * 23 });
  };
  const endTouch = () => {
    touchRef.current = { x: 0, y: 0 };
    setJoystick({ active: false, x: 0, y: 0 });
  };

  const npcPosition = npcHotspot ? { left: `${npcHotspot.x}%`, top: `${npcHotspot.y}%` } : { left: "60%", top: "58%" };
  const nearNpc = nearHotspotId === npcHotspot?.id;

  return (
    <div ref={rootRef} className="absolute inset-0 overflow-hidden bg-[#201814]" aria-label="Aamchi Boli Mumbai world">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 z-[4]">
        <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${player.x}%`, top: `${player.y}%` }}>
          <span className="mb-1 block rounded border-2 border-black bg-[#fff6dd] px-2 py-0.5 text-center text-[9px] font-black uppercase text-black shadow-[2px_2px_0_#130f0b]">{characterName}</span>
          <CharacterSprite characterId="learner" characterName={characterName} direction={player.direction} isMoving={player.isMoving} />
        </div>
        <div className="absolute -translate-x-1/2 -translate-y-1/2" style={npcPosition}>
          <span className={`mb-1 block rounded border-2 border-black px-2 py-0.5 text-center text-[9px] font-black uppercase text-black shadow-[2px_2px_0_#130f0b] ${nearNpc ? "bg-[#d9ff83]" : "bg-main"}`}>{mission.npcName}</span>
          <CharacterSprite characterId={spriteIdForHotspot(npcHotspot, mission)} characterName={mission.npcName} isNpc nearPlayer={nearNpc} isTalking={!paused && !completed} />
        </div>
      </div>
      {landscapeHint && (
        <div className="absolute inset-x-4 top-20 z-20 rounded-base border-2 border-black bg-[#fff6dd] p-3 text-center text-sm font-bold text-black shadow-shadow">Rotate your phone sideways for the best Mumbai map view.</div>
      )}
      {!completed && !paused && coarsePointer && (
        <div className="absolute bottom-[calc(48dvh+1.25rem)] left-5 z-20 flex items-end gap-5 sm:bottom-8 sm:left-8">
          <div
            className="relative h-[92px] w-[92px] touch-none rounded-full border-2 border-black/70 bg-black/25 shadow-[3px_3px_0_rgba(0,0,0,.55)]"
            onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setTouchVector(event); }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setTouchVector(event); }}
            onPointerUp={endTouch}
            onPointerCancel={endTouch}
          >
            <span className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-black bg-main shadow-[2px_2px_0_#130f0b] transition-transform" style={{ transform: `translate(calc(-50% + ${joystick.x}px), calc(-50% + ${joystick.y}px))` }} />
          </div>
          <button type="button" onClick={interact} disabled={!nearNpc} className="rounded-base border-2 border-black bg-main px-4 py-3 font-display text-sm font-black uppercase text-black shadow-shadow disabled:cursor-not-allowed disabled:opacity-45">
            <span className="block text-[9px] tracking-widest">{nearNpc ? "E / Enter" : "Walk closer"}</span>
            <span>{nearNpc ? `Talk to ${mission.npcName}` : mission.npcName}</span>
          </button>
        </div>
      )}
    </div>
  );
}
