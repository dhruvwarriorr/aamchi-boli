"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CharacterSprite, type CharacterDirection } from "@/components/CharacterSprite";
import type { BoliWorldRect } from "@/lib/types/shared";

type Direction = "up" | "down" | "left" | "right";

type PlayerPosition = {
  x: number;
  y: number;
  direction: CharacterDirection;
  isMoving: boolean;
};

export type BoliWorldNpcPosition = {
  x: number;
  y: number;
};

/**
 * A responsive exploration layer for a static, full-screen Boli map.
 * The parent owns whether the learner is close enough to talk; this component
 * owns the animated character sprite and bounded movement controls.
 */
export type BoliWorldControlsProps = {
  /** Identifier for the player ("student" | "auto_driver"). */
  characterId?: string;
  /** Label shown above the learner's pixel marker. */
  characterName: string;
  /** Name shown in the contextual interaction affordance. */
  npcName: string;
  /** Identifier or mission id for the NPC. */
  npcId?: string;
  /** Pauses all movement and interactions while a response is loading or a modal is open. */
  enabled: boolean;
  /** The parent-controlled proximity gate for talking to the current NPC. */
  canInteract: boolean;
  /** Where the talkable NPC sits in the percentage-based world plane. */
  npcPosition?: BoliWorldNpcPosition;
  /** Where the learner's sprite starts, in the same percentage plane. */
  playerStart?: BoliWorldNpcPosition;
  /** Ground the learner may stand on. Empty means the whole bounded plane. */
  walkable?: BoliWorldRect[];
  /** Solid props the learner must walk around. */
  blockers?: BoliWorldRect[];
  /** Receives a change whenever the learner walks into or out of talk range. */
  onProximityChange?: (near: boolean) => void;
  /** Invoked by E, Enter, or the on-screen button when `canInteract` is true. */
  onInteract: () => void;
  /**
   * Show the D-pad and Talk button. Turn this off once dialogue begins: the
   * characters stay on the map, but the learner stops walking.
   */
  showControls?: boolean;
  /** Animate the NPC as if speaking, while a conversation is open. */
  npcTalking?: boolean;
  /** Extra classes for positioning this overlay inside the map container. */
  className?: string;
};

const KEY_TO_DIRECTION: Record<string, Direction | undefined> = {
  w: "up",
  arrowup: "up",
  s: "down",
  arrowdown: "down",
  a: "left",
  arrowleft: "left",
  d: "right",
  arrowright: "right",
};

const MIN_X = 5;
const MAX_X = 95;
const MIN_Y = 18;
const MAX_Y = 78;
/**
 * Percent-of-height per second. The horizontal rate is derived from the live
 * container aspect so walking left feels the same speed as walking up; using a
 * separate SPEED_X made horizontal movement ~2x faster in actual pixels.
 */
const SPEED = 36;
/** A press shorter than this counts as a discrete tap, not a hold. */
const TAP_MS = 180;
/** Talk reach, also in percent-of-height units. */
const NPC_TALK_RADIUS = 14;
/**
 * How close the learner may get before the NPC blocks them. Without this the
 * player sprite walks onto the same pixel as the NPC and the two overlap.
 */
const NPC_PERSONAL_SPACE = 7;
const DEFAULT_NPC_POSITION: BoliWorldNpcPosition = { x: 72, y: 58 };
const DEFAULT_PLAYER_START: BoliWorldNpcPosition = { x: 24, y: 66 };

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  return [element, active].some((node) => {
    if (!node) return false;
    return (
      node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLSelectElement ||
      node.isContentEditable ||
      Boolean(node.closest("[contenteditable='true']"))
    );
  });
}

/** True for elements whose own Enter/Space activation must be left alone. */
function isActivatableTarget(target: EventTarget | null): boolean {
  const node = target instanceof HTMLElement ? target : null;
  return Boolean(node?.closest("button, a, [role='button'], summary"));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function joinClasses(...classes: Array<string | undefined | false>): string {
  return classes.filter(Boolean).join(" ");
}

function insideRect(x: number, y: number, r: BoliWorldRect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/**
 * True when the learner may stand here: on some walkable ground and not inside
 * a solid prop. Movement is resolved one axis at a time against this, so
 * walking into a wall slides along it instead of stopping dead or passing through.
 */
function canStand(
  x: number,
  y: number,
  ground: BoliWorldRect[] | undefined,
  solids: BoliWorldRect[] | undefined
): boolean {
  if (ground && ground.length > 0 && !ground.some((r) => insideRect(x, y, r))) return false;
  if (solids && solids.some((r) => insideRect(x, y, r))) return false;
  return true;
}

/**
 * Stop the learner from standing inside the NPC by pushing any incursion back
 * out to the edge of their personal space, along the approach direction.
 */
function keepClearOfNpc(
  next: PlayerPosition,
  npc: BoliWorldNpcPosition,
  aspect: number
): PlayerPosition {
  const dx = (next.x - npc.x) * aspect;
  const dy = next.y - npc.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= NPC_PERSONAL_SPACE) return next;
  // Approaching dead-on leaves no direction to push along; stand just below.
  const [unitX, unitY] = distance === 0 ? [0, 1] : [dx / distance, dy / distance];
  return {
    ...next,
    x: clamp(npc.x + (unitX * NPC_PERSONAL_SPACE) / aspect, MIN_X, MAX_X),
    y: clamp(npc.y + unitY * NPC_PERSONAL_SPACE, MIN_Y, MAX_Y),
  };
}

/**
 * `x` is a percentage of width and `y` a percentage of height, so comparing them
 * directly makes the talk zone an ellipse as wide as the container is wide.
 * Scaling dx by the aspect ratio converts both onto one axis before measuring.
 */
function isNearNpc(player: PlayerPosition, npc: BoliWorldNpcPosition, aspect: number): boolean {
  return Math.hypot((player.x - npc.x) * aspect, player.y - npc.y) <= NPC_TALK_RADIUS;
}

/**
 * Drop this over a `position: relative` full-screen map.
 */
export function BoliWorldControls({
  characterId,
  characterName,
  npcName,
  npcId,
  enabled,
  canInteract,
  npcPosition,
  playerStart,
  walkable,
  blockers,
  onProximityChange,
  onInteract,
  showControls = true,
  npcTalking = false,
  className,
}: BoliWorldControlsProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Width / height of the map plane, used to keep reach and speed isotropic.
  const [aspect, setAspect] = useState(16 / 9);
  const aspectRef = useRef(aspect);
  const [position, setPosition] = useState<PlayerPosition>(() => ({
    x: clamp(playerStart?.x ?? DEFAULT_PLAYER_START.x, MIN_X, MAX_X),
    y: clamp(playerStart?.y ?? DEFAULT_PLAYER_START.y, MIN_Y, MAX_Y),
    direction: "right",
    isMoving: false,
  }));
  const resolvedNpcPosition = useMemo<BoliWorldNpcPosition>(
    () => ({
      x: clamp(npcPosition?.x ?? DEFAULT_NPC_POSITION.x, MIN_X, MAX_X),
      y: clamp(npcPosition?.y ?? DEFAULT_NPC_POSITION.y, MIN_Y, MAX_Y),
    }),
    [npcPosition?.x, npcPosition?.y]
  );
  const nearNpc = isNearNpc(position, resolvedNpcPosition, aspect);
  const interactionAvailable = canInteract && nearNpc;
  const keyboardDirectionsRef = useRef(new Set<Direction>());
  const pressStartedAtRef = useRef(new Map<Direction, number>());
  const touchDirectionsRef = useRef(new Set<Direction>());
  const positionRef = useRef(position);
  const enabledRef = useRef(enabled);
  const canInteractRef = useRef(canInteract);
  const npcPositionRef = useRef(resolvedNpcPosition);
  const walkableRef = useRef(walkable);
  const blockersRef = useRef(blockers);
  const onInteractRef = useRef(onInteract);
  const lastProximityRef = useRef<boolean | null>(null);

  useEffect(() => {
    enabledRef.current = enabled;
    canInteractRef.current = canInteract;
    npcPositionRef.current = resolvedNpcPosition;
    walkableRef.current = walkable;
    blockersRef.current = blockers;
    onInteractRef.current = onInteract;
  }, [blockers, canInteract, enabled, onInteract, resolvedNpcPosition, walkable]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      if (width > 0 && height > 0) {
        const next = width / height;
        aspectRef.current = next;
        setAspect(next);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (lastProximityRef.current === nearNpc) return;
    lastProximityRef.current = nearNpc;
    onProximityChange?.(nearNpc);
  }, [nearNpc, onProximityChange]);

  const clearMovement = useCallback(() => {
    keyboardDirectionsRef.current.clear();
    touchDirectionsRef.current.clear();
  }, []);

  const tryInteract = useCallback(() => {
    if (
      !enabledRef.current ||
      !canInteractRef.current ||
      !isNearNpc(positionRef.current, npcPositionRef.current, aspectRef.current)
    ) {
      return;
    }
    onInteractRef.current();
  }, []);

  const nudge = useCallback((direction: Direction) => {
    if (!enabledRef.current) return;
    const current = positionRef.current;
    const stepY = 3.2;
    const stepX = stepY / (aspectRef.current || 1);
    const next: PlayerPosition = {
      x: clamp(
        current.x + (direction === "left" ? -stepX : direction === "right" ? stepX : 0),
        MIN_X,
        MAX_X
      ),
      y: clamp(
        current.y + (direction === "up" ? -stepY : direction === "down" ? stepY : 0),
        MIN_Y,
        MAX_Y
      ),
      direction,
      isMoving: false,
    };
    const ground = walkableRef.current;
    const solids = blockersRef.current;
    const stepped: PlayerPosition = {
      ...next,
      x: canStand(next.x, current.y, ground, solids) ? next.x : current.x,
      y: canStand(canStand(next.x, current.y, ground, solids) ? next.x : current.x, next.y, ground, solids)
        ? next.y
        : current.y,
    };
    const settled = keepClearOfNpc(stepped, npcPositionRef.current, aspectRef.current || 1);
    const safe = canStand(settled.x, settled.y, ground, solids) ? settled : stepped;
    positionRef.current = safe;
    setPosition(safe);
  }, []);

  useEffect(() => {
    if (!enabled) clearMovement();
  }, [clearMovement, enabled]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!enabledRef.current || isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const direction = KEY_TO_DIRECTION[key];

      if (direction) {
        event.preventDefault();
        keyboardDirectionsRef.current.add(direction);
        return;
      }

      // Enter on a focused control belongs to that control; stealing it here
      // suppressed the synthesized click on Routes, Learning, and the D-pad.
      if (key === "enter" && isActivatableTarget(event.target)) return;
      if ((key === "e" || key === "enter") && !event.repeat) {
        event.preventDefault();
        tryInteract();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const direction = KEY_TO_DIRECTION[event.key.toLowerCase()];
      if (direction) keyboardDirectionsRef.current.delete(direction);
    };

    const onBlur = () => clearMovement();
    const onVisibilityChange = () => {
      if (document.hidden) clearMovement();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [clearMovement, tryInteract]);

  useEffect(() => {
    let animationFrame = 0;
    let lastFrame = performance.now();

    const move = (timestamp: number) => {
      animationFrame = window.requestAnimationFrame(move);
      const elapsed = Math.min(0.05, (timestamp - lastFrame) / 1000);
      lastFrame = timestamp;
      const current = positionRef.current;

      if (!enabledRef.current) {
        if (current.isMoving) {
          const next = { ...current, isMoving: false };
          positionRef.current = next;
          setPosition(next);
        }
        return;
      }

      const directions = new Set<Direction>([
        ...keyboardDirectionsRef.current,
        ...touchDirectionsRef.current,
      ]);
      let horizontal = 0;
      let vertical = 0;
      if (directions.has("left")) horizontal -= 1;
      if (directions.has("right")) horizontal += 1;
      if (directions.has("up")) vertical -= 1;
      if (directions.has("down")) vertical += 1;

      if (horizontal === 0 && vertical === 0) {
        if (current.isMoving) {
          const next = { ...current, isMoving: false };
          positionRef.current = next;
          setPosition(next);
        }
        return;
      }

      // 4-directional facing update prioritizing latest axis
      let facingDirection: CharacterDirection = current.direction;
      if (horizontal < 0) facingDirection = "left";
      else if (horizontal > 0) facingDirection = "right";
      else if (vertical < 0) facingDirection = "up";
      else if (vertical > 0) facingDirection = "down";

      // Normalize diagonal speed, then convert the vertical rate into the
      // horizontal percentage plane so both axes move at one pixel speed.
      const magnitude = horizontal !== 0 && vertical !== 0 ? Math.SQRT1_2 : 1;
      const speedX = SPEED / (aspectRef.current || 1);
      const ground = walkableRef.current;
      const solids = blockersRef.current;

      const wantX = clamp(current.x + horizontal * speedX * elapsed * magnitude, MIN_X, MAX_X);
      const wantY = clamp(current.y + vertical * SPEED * elapsed * magnitude, MIN_Y, MAX_Y);
      // Try each axis on its own: blocked horizontally, you can still slide vertically.
      const movedX = canStand(wantX, current.y, ground, solids) ? wantX : current.x;
      const movedY = canStand(movedX, wantY, ground, solids) ? wantY : current.y;

      const next: PlayerPosition = {
        x: movedX,
        y: movedY,
        direction: facingDirection,
        isMoving: movedX !== current.x || movedY !== current.y,
      };
      const settled = keepClearOfNpc(next, npcPositionRef.current, aspectRef.current || 1);
      // The push-out must never deposit the learner inside a wall.
      const safe = canStand(settled.x, settled.y, ground, solids) ? settled : next;
      positionRef.current = safe;
      setPosition(safe);
    };

    animationFrame = window.requestAnimationFrame(move);
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  const beginTouchMove = (direction: Direction) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!enabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pressStartedAtRef.current.set(direction, performance.now());
    touchDirectionsRef.current.add(direction);
  };

  const endTouchMove = (direction: Direction) => (event: React.PointerEvent<HTMLButtonElement>) => {
    const wasHeld = touchDirectionsRef.current.delete(direction);
    const startedAt = pressStartedAtRef.current.get(direction);
    pressStartedAtRef.current.delete(direction);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // A quick tap integrates almost no time in the rAF loop (~1% of width), so
    // the D-pad felt dead to mouse and touch users. Give short presses one step.
    if (wasHeld && startedAt !== undefined && performance.now() - startedAt < TAP_MS) {
      nudge(direction);
    }
  };

  const movementButton = (direction: Direction, label: string, glyph: string, extraClassName?: string) => (
    <button
      key={direction}
      type="button"
      aria-label={label}
      disabled={!enabled}
      className={joinClasses(
        "flex h-11 w-11 select-none items-center justify-center border-2 border-[#130f0b] bg-[#fff6dd] font-display text-xl font-black text-[#130f0b] shadow-[3px_3px_0_#130f0b] transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-45 touch-none",
        extraClassName
      )}
      onPointerDown={beginTouchMove(direction)}
      onPointerUp={endTouchMove(direction)}
      onPointerCancel={endTouchMove(direction)}
      onPointerLeave={endTouchMove(direction)}
      // Keyboard activation reports detail === 0; pointer taps are handled above.
      onClick={(event) => {
        if (event.detail === 0) nudge(direction);
      }}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );

  return (
    <>
      {/* Character layer: fixed to the viewport so its percentages match the
          full-bleed map image, and below the HUD column so cards stay legible. */}
      <div
        ref={rootRef}
        className="pointer-events-none fixed inset-0 z-[5] overflow-hidden"
        aria-hidden="true"
      >
      {/* Player character with animated walk cycles */}
      <div
        className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${position.x}%`, top: `${position.y}%` }}
        role="status"
        aria-label={`${characterName}'s position in the Mumbai map`}
      >
        <div className="relative flex flex-col items-center">
          <span className="mb-1 max-w-28 truncate border-2 border-[#130f0b] bg-[#fff6dd] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-[#130f0b] shadow-[2px_2px_0_#130f0b]">
            {characterName}
          </span>
          <CharacterSprite
            characterId={characterId}
            characterName={characterName}
            direction={position.direction}
            isMoving={position.isMoving}
          />
        </div>
      </div>

      {/* NPC Character with idle/greeting animations */}
      <div
        className="pointer-events-none absolute z-[9] -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${resolvedNpcPosition.x}%`, top: `${resolvedNpcPosition.y}%` }}
        aria-hidden="true"
      >
        <div className="flex flex-col items-center">
          <span className="mb-1 border-2 border-[#130f0b] bg-main px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-[#130f0b] shadow-[2px_2px_0_#130f0b]">
            {npcName}
          </span>
          <CharacterSprite
            characterId={npcId}
            characterName={npcName}
            isNpc
            nearPlayer={nearNpc}
            isTalking={npcTalking}
          />
        </div>
      </div>

      </div>

      {/* Control layer: stays inside the HUD column so buttons remain clickable. */}
      {showControls && (
      <div
        className={joinClasses("pointer-events-none absolute inset-0 z-20", className)}
        aria-label="Marathi map exploration controls"
      >
      <div className="pointer-events-auto absolute bottom-4 left-4 grid grid-cols-3 gap-1 sm:bottom-6 sm:left-6" aria-label="Movement controls">
        <span aria-hidden="true" />
        {movementButton("up", "Move up (W or Up Arrow)", "▲")}
        <span aria-hidden="true" />
        {movementButton("left", "Move left (A or Left Arrow)", "◀")}
        {movementButton("down", "Move down (S or Down Arrow)", "▼")}
        {movementButton("right", "Move right (D or Right Arrow)", "▶")}
        <p className="col-span-3 mt-1 text-center text-[9px] font-black uppercase tracking-[0.12em] text-[#fff6dd] [text-shadow:1px_1px_0_#130f0b]">
          WASD / arrows
        </p>
      </div>

      <div className="pointer-events-auto absolute bottom-5 right-4 sm:bottom-7 sm:right-6">
        <button
          type="button"
          disabled={!enabled || !interactionAvailable}
          aria-label={interactionAvailable ? `Talk to ${npcName}` : nearNpc ? `${npcName} cannot talk yet` : `${npcName} is not in range`}
          className="border-2 border-[#130f0b] bg-main px-4 py-3 font-display text-sm font-black uppercase tracking-[0.07em] text-[#130f0b] shadow-[4px_4px_0_#130f0b] transition hover:-translate-y-0.5 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
          onClick={tryInteract}
        >
          <span className="block text-[9px] tracking-[0.14em]">{interactionAvailable ? "E / Enter" : nearNpc ? "Please wait" : "Walk closer"}</span>
          <span className="mt-0.5 block">{interactionAvailable ? `Talk to ${npcName}` : nearNpc ? npcName : `${npcName} ahead`}</span>
        </button>
      </div>
      </div>
      )}
    </>
  );
}

