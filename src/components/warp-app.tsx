import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, Volume2, VolumeX, Zap } from "lucide-react";
import { createWarpAudio } from "@/game/audio";
import type { InspectBody } from "@/game/bodies";
import type { WarpSim } from "@/game/warp-field";

const STORAGE_KEY = "warp-v1";

const DEFAULTS: WarpSim = {
  cruise: 0.46,
  density: 0.62,
  sensitivity: 0.52,
  streak: 0.7,
  sound: true,
  boostLatched: false,
  engaged: false,
  reduced: false,
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function readStored(): Partial<WarpSim> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<WarpSim>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function WarpApp() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reticleRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const velocityRef = useRef<HTMLParagraphElement>(null);
  const cruiseRef = useRef<HTMLInputElement>(null);
  const densityRef = useRef<HTMLInputElement>(null);
  const sensitivityRef = useRef<HTMLInputElement>(null);
  const streakRef = useRef<HTMLInputElement>(null);
  const simRef = useRef<WarpSim>({ ...DEFAULTS });
  const audioRef = useRef(createWarpAudio());
  const deselectRef = useRef<() => void>(() => {});

  const [engaged, setEngaged] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [tune, setTune] = useState(false);
  const [sound, setSound] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [body, setBody] = useState<InspectBody | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const reticle = reticleRef.current;
    const fpsNode = fpsRef.current;
    const velocityNode = velocityRef.current;
    if (!root || !canvas || !reticle || !fpsNode || !velocityNode) return;

    fpsNode.textContent = "— fps";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stored = readStored();
    const sim = simRef.current;
    sim.reduced = reduced;
    sim.cruise = clamp(typeof stored.cruise === "number" ? stored.cruise : DEFAULTS.cruise, 0.08, 1);
    sim.density = clamp(
      typeof stored.density === "number" ? stored.density : reduced ? 0.4 : DEFAULTS.density,
      0,
      1,
    );
    sim.sensitivity = clamp(
      typeof stored.sensitivity === "number" ? stored.sensitivity : DEFAULTS.sensitivity,
      0,
      1,
    );
    sim.streak = clamp(
      typeof stored.streak === "number" ? stored.streak : reduced ? 0.25 : DEFAULTS.streak,
      0,
      1,
    );
    sim.sound = typeof stored.sound === "boolean" ? stored.sound : true;
    setSound(sim.sound);

    if (cruiseRef.current) cruiseRef.current.value = String(sim.cruise);
    if (densityRef.current) densityRef.current.value = String(sim.density);
    if (sensitivityRef.current) sensitivityRef.current.value = String(sim.sensitivity);
    if (streakRef.current) streakRef.current.value = String(sim.streak);

    let stop = () => {};
    let dead = false;

    void import("@/game/warp-field").then(({ mountWarp }) => {
      if (dead) return;
      stop = mountWarp({
        canvas,
        root,
        reticle,
        fpsNode,
        velocityNode,
        cruiseInput: cruiseRef.current,
        getSim: () => simRef.current,
        audio: audioRef.current,
        onBoostVisual: setBoosting,
        onFail: setFailed,
        onInspect: setBody,
        registerDeselect: (fn) => {
          deselectRef.current = fn;
        },
      });
    });

    const persistTimer = window.setInterval(() => {
      const current = simRef.current;
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          cruise: current.cruise,
          density: current.density,
          sensitivity: current.sensitivity,
          streak: current.streak,
          sound: current.sound,
        }),
      );
    }, 1500);

    return () => {
      dead = true;
      stop();
      window.clearInterval(persistTimer);
    };
  }, []);

  function engage() {
    simRef.current.engaged = true;
    setEngaged(true);
    if (simRef.current.sound) audioRef.current.resume();
  }

  function toggleBoost() {
    simRef.current.boostLatched = !simRef.current.boostLatched;
    setBoosting(simRef.current.boostLatched);
  }

  function toggleSound() {
    const next = !simRef.current.sound;
    simRef.current.sound = next;
    setSound(next);
    if (next && simRef.current.engaged) audioRef.current.resume();
    else audioRef.current.update(0, 0, false);
  }

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 overflow-hidden bg-canvas text-ink"
      role="application"
      aria-label="Warp starfield. Pointer steers. Click a planet or asteroid field."
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />
      <div className="vignette pointer-events-none absolute inset-0" />

      <div
        ref={reticleRef}
        className="pointer-events-none absolute top-1/2 left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2"
        aria-hidden="true"
      >
        <span className="absolute top-1/2 left-0 h-px w-1.5 -translate-y-1/2 bg-ink/40" />
        <span className="absolute top-1/2 right-0 h-px w-1.5 -translate-y-1/2 bg-ink/40" />
        <span className="absolute top-0 left-1/2 h-1.5 w-px -translate-x-1/2 bg-ink/40" />
        <span className="absolute bottom-0 left-1/2 h-1.5 w-px -translate-x-1/2 bg-ink/40" />
      </div>

      <div className="pointer-events-none absolute top-0 right-0 left-0 flex items-start justify-between px-5 pt-4">
        <p className={`font-display text-caption tracking-[-0.08em] ${engaged ? "text-ink" : "text-transparent"}`}>
          WARP
        </p>
        <span ref={fpsRef} className="inline-block w-16 text-right text-caption text-ink-muted tabular-nums" />
      </div>

      <div
        className={`gate gate-scrim absolute inset-0 z-20 flex items-center justify-center px-6 transition-opacity duration-500 ${
          engaged ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <div className="flex w-full max-w-3xl flex-col items-start">
          <p className="font-display text-4xl leading-none tracking-tight text-ink">WARP</p>
          <h1 className="mt-5 font-display text-hero text-ink">The dark, at speed.</h1>
          <p className="mt-6 max-w-lg text-deck text-ink-muted">
            Move the pointer to steer. Click a planet or a field of rock. Boost to fly faster, and
            leave the night behind.
          </p>
          <button type="button" className="btn btn-primary mt-8" onClick={engage}>
            Engage
          </button>
          <p className="mt-5 text-caption text-ink-muted">A and D turn you. Shift boosts.</p>
        </div>
      </div>

      <div
        className={`absolute right-0 bottom-0 left-0 z-10 flex justify-center px-3 pb-4 transition-opacity duration-300 ${
          engaged ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="dock w-full max-w-3xl rounded-xl bg-surface-1 px-4 py-3">
          <div className="grid grid-cols-1 items-end gap-x-4 gap-y-3 sm:grid-cols-[7.5rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div>
              <p className="text-caption text-ink-muted">Velocity</p>
              <p
                ref={velocityRef}
                className="w-24 font-display text-readout text-ink tabular-nums"
              />
            </div>

            <label className="min-w-0">
              <span className="text-caption text-ink-muted">Speed</span>
              <input
                ref={cruiseRef}
                className="slider"
                type="range"
                min={0.08}
                max={1}
                step={0.001}
                defaultValue={DEFAULTS.cruise}
                aria-label="Speed"
                onInput={(e) => {
                  simRef.current.cruise = Number(e.currentTarget.value);
                }}
              />
            </label>

            <label className="min-w-0">
              <span className="text-caption text-ink-muted">Density</span>
              <input
                ref={densityRef}
                className="slider"
                type="range"
                min={0}
                max={1}
                step={0.001}
                defaultValue={DEFAULTS.density}
                aria-label="Density"
                onInput={(e) => {
                  simRef.current.density = Number(e.currentTarget.value);
                }}
              />
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                className={`btn btn-primary btn-boost w-32 ${boosting ? "is-on" : ""}`}
                aria-pressed={boosting}
                onClick={toggleBoost}
              >
                <Zap className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                Boost
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-icon bg-surface-2"
                aria-expanded={tune}
                aria-label="Tune"
                onClick={() => setTune((v) => !v)}
              >
                <SlidersHorizontal className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>

          <p className="mt-1 text-caption text-ink-muted">Pointer steers · click a world · Shift boosts</p>

          {tune ? (
            <div className="mt-3 grid items-end gap-3 border-t border-hairline-soft pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <label>
                <span className="text-caption text-ink-muted">Sensitivity</span>
                <input
                  ref={sensitivityRef}
                  className="slider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  defaultValue={DEFAULTS.sensitivity}
                  aria-label="Sensitivity"
                  onInput={(e) => {
                    simRef.current.sensitivity = Number(e.currentTarget.value);
                  }}
                />
              </label>
              <label>
                <span className="text-caption text-ink-muted">Streak</span>
                <input
                  ref={streakRef}
                  className="slider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  defaultValue={DEFAULTS.streak}
                  aria-label="Streak length"
                  onInput={(e) => {
                    simRef.current.streak = Number(e.currentTarget.value);
                  }}
                />
              </label>
              <button
                type="button"
                className="btn btn-secondary btn-icon bg-surface-2"
                aria-label={sound ? "Sound on" : "Sound off"}
                aria-pressed={sound}
                onClick={toggleSound}
              >
                {sound ? (
                  <Volume2 className="size-4" strokeWidth={2} aria-hidden="true" />
                ) : (
                  <VolumeX className="size-4" strokeWidth={2} aria-hidden="true" />
                )}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {engaged && body ? (
        <div className="absolute top-14 right-0 left-0 z-10 flex justify-start px-4">
          <aside className="dock w-full max-w-xs rounded-xl bg-surface-1 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-caption text-ink-muted">{body.kind}</p>
                <p className="font-display text-readout text-ink">{body.name}</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary bg-surface-2"
                onClick={() => {
                  deselectRef.current();
                  setBody(null);
                }}
              >
                Close
              </button>
            </div>
            <p className="mt-2 text-body text-ink-muted">{body.detail}</p>
          </aside>
        </div>
      ) : null}

      {failed ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-canvas px-6">
          <p className="max-w-md text-body text-ink-muted">{failed}</p>
        </div>
      ) : null}
    </div>
  );
}
