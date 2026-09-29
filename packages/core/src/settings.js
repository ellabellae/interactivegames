// @ts-check
// One settings object controls every threshold that makes a gesture easier or
// harder. Pages never hard-code these numbers; they read them from the active
// profile, so a profile can be swapped per user without touching game code.
//
// Values in STANDARD are the ones the original prototypes shipped with
// (see legacy/). Where two prototypes disagreed, the chosen value is noted.

/**
 * @typedef {object} RaiseSettings
 * @property {number} travelPx  upward distance that counts as one raise
 * @property {number} maxS      the raise must cover travelPx within this many seconds
 *
 * @typedef {object} Settings
 * @property {string} id
 * @property {string} label
 * @property {{ handLostFrames: number }} tracking
 * @property {{ on: number, off: number, holdFrames: number }} pinch
 * @property {{ smoothing: number }} cursor
 * @property {{ padPx: number, brickGrabPx: number, partGrabPx: number, brickCellPx: [number, number], snapCells: number }} targets
 * @property {{
 *   stir: { turnsPerCount: number },
 *   chop: { travelPx: number },
 *   flick: { minSpeedPxPerS: number, cooldownS: number },
 *   shake: { travelPx: number },
 *   raise: RaiseSettings | null,
 * }} gestures
 * @property {{
 *   repsScale: number,
 *   tempo: { startBpm: number, bpmPerStep: number, maxBpm: number },
 *   wrongDrop: "bonk" | "soft" | "none",
 *   countdownMs: number,
 * }} game
 * @property {{
 *   rotateGain: { x: number, y: number },
 *   rotateEase: number,
 *   scaleEase: number,
 *   twoHandScale: { from: [number, number], to: [number, number], clamp: [number, number] },
 * }} viewer
 */

/** @type {Settings} */
export const STANDARD = {
  id: "standard",
  label: "Standard",

  tracking: {
    // Video frames with no hand on a player's side before their cursor and
    // anything they hold are released. kitchen-race used 10, brick-race 12.
    handLostFrames: 10,
  },

  pinch: {
    // Thumb-tip to index-tip distance divided by hand size (wrist to middle
    // knuckle). Two thresholds (hysteresis) so a wobbly pinch doesn't flicker.
    on: 0.30,       // closer than this starts a pinch
    off: 0.42,      // must open wider than this to release
    holdFrames: 2,  // frames the pinch must hold before it counts
  },

  cursor: {
    // Share of the way the cursor moves toward the hand each video frame.
    // 1 = raw, lower = smoother but laggier. kitchen-race 0.55, brick-race 0.50.
    smoothing: 0.5,
  },

  targets: {
    padPx: 26,              // kitchen: extra px around a station item's circle
    brickGrabPx: 28,        // bricks: max px from pinch point to a brick's edge
    partGrabPx: 110,        // heart viewer: px from a part's projected centre when the ray misses
    brickCellPx: [22, 34],  // bricks: grid cell size range (bigger = bigger bricks and drop spots)
    snapCells: 0.5,         // bricks: a drop counts within this many cells of the right spot
  },

  gestures: {
    stir: { turnsPerCount: 1 },                        // full circles over the target per count
    chop: { travelPx: 22 },                            // up/down travel between direction changes
    flick: { minSpeedPxPerS: 1100, cooldownS: 0.6 },   // upward speed for a flick, and gap between flicks
    shake: { travelPx: 14 },                           // side-to-side travel between direction changes
    raise: null,                                       // slow raise that replaces flick (gentle profile)
  },

  game: {
    repsScale: 1,                                          // multiplies each step's repetition count
    tempo: { startBpm: 138, bpmPerStep: 8, maxBpm: 176 },  // kitchen music speeds up with progress
    wrongDrop: "bonk",                                     // sound on a wrong drop: "bonk" | "soft" | "none"
    countdownMs: 800,                                      // time per 3-2-1 countdown tick
  },

  viewer: {
    rotateGain: { x: 0.9, y: 1.8 },  // × π radians across the full frame height / width
    rotateEase: 6,                    // per-second easing toward the target rotation
    scaleEase: 5,                     // per-second easing toward the target scale
    twoHandScale: { from: [0.15, 0.65], to: [0.55, 1.8], clamp: [0.4, 2.2] },  // hand gap -> zoom
  },
};

/** @type {Record<string, Settings>} */
export const PROFILES = { standard: STANDARD };

export const STORAGE_KEY = "heart-hands:settings";

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Deep-merge `patch` over `base`. Objects merge key by key; arrays and
 * primitives replace. Keys not present in `base` are ignored, so a stale or
 * mistyped override in storage can't add junk settings.
 * @template T
 * @param {T} base
 * @param {unknown} patch
 * @returns {T}
 */
export function mergeSettings(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return /** @type {T} */ (patch === undefined ? base : patch);
  /** @type {Record<string, unknown>} */
  const out = { ...base };
  for (const key of Object.keys(base)) {
    if (!(key in patch)) continue;
    const b = base[key], p = patch[key];
    if (b === null || isPlainObject(p) && isPlainObject(b)) out[key] = b === null ? p : mergeSettings(b, p);
    else if (typeof p === typeof b || Array.isArray(b) && Array.isArray(p)) out[key] = p;
  }
  return /** @type {T} */ (out);
}

/** @template T @param {T} o @returns {T} */
function deepFreeze(o) {
  if (isPlainObject(o) || Array.isArray(o)) { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
}

/**
 * The settings in effect: a preset plus any per-user overrides.
 * Unknown profile ids fall back to standard.
 * @param {string} [profileId]
 * @param {unknown} [overrides]
 * @returns {Readonly<Settings>}
 */
export function resolveSettings(profileId = "standard", overrides = undefined) {
  const base = PROFILES[profileId] ?? STANDARD;
  return deepFreeze(mergeSettings(structuredClone(base), overrides ?? {}));
}

/**
 * @typedef {{ profileId: string, overrides: unknown }} StoredChoice
 * @typedef {Pick<Storage, "getItem" | "setItem">} StorageLike
 */

/**
 * Browser storage if available. Private windows and blocked storage return null.
 * @returns {StorageLike | null}
 */
function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/**
 * Read the saved profile choice. Never throws: missing, blocked or corrupt
 * storage gives the standard profile.
 * @param {StorageLike | null} [storage]
 * @returns {StoredChoice}
 */
export function loadChoice(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (isPlainObject(parsed) && typeof parsed.profileId === "string") {
      return { profileId: parsed.profileId in PROFILES ? parsed.profileId : "standard", overrides: parsed.overrides ?? {} };
    }
  } catch { /* fall through to default */ }
  return { profileId: "standard", overrides: {} };
}

/**
 * Save the profile choice. Returns false if storage is unavailable.
 * @param {StoredChoice} choice
 * @param {StorageLike | null} [storage]
 */
export function saveChoice(choice, storage = defaultStorage()) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(choice)); return !!storage; } catch { return false; }
}

/**
 * Settings for this page load, from storage.
 * @param {StorageLike | null} [storage]
 */
export function loadSettings(storage = defaultStorage()) {
  const { profileId, overrides } = loadChoice(storage);
  return resolveSettings(profileId, overrides);
}
