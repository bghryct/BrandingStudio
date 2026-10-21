/**
 * Product animations as pure functions of time: a turntable, a hero camera orbit, a can rolling
 * in, a float, a push-in reveal, a carton folding up from its dieline, a sleeve sliding off its
 * tray, a sway for bags and garments, a card flip and a tube opening.
 */
import type { AnimationMode } from './types';

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const easeInOutCubic = (t: number) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface CameraKey {
  /** Azimuth (rad, 0 = front, + = from the right), elevation (rad), distance multiplier. */
  az: number;
  el: number;
  zoom: number;
  /** Frame for every rotation of the product (turntables) so the camera never pumps. */
  stable?: boolean;
  /** Vertical aim: 0 = centre of the bounds, + raises it (fraction of height). */
  aimY?: number;
}

export interface Sample {
  spin: number;
  tilt: number;
  /** Lift above the ground, as a fraction of the product's largest dimension. */
  lift: number;
  /** Rolling products: lying on the side (0–1) and travel toward the camera (fraction of size). */
  lying: number;
  travel: number;
  fold: number;
  open: number;
  /** Pour progress 0 … 1 (glass beside the product), or −1 when the pour is not animated. */
  pour: number;
  cam: CameraKey | null;
}

export interface ProductTraits { lying?: boolean; rollRadius?: number; hasFold?: boolean; hasOpen?: boolean; canPour?: boolean; drink?: boolean }

export const ANIMATIONS: { id: Exclude<AnimationMode, 'none'>; label: string; duration: number; description: string }[] = [
  { id: 'turntable', label: 'Turntable', duration: 8, description: 'A full 360° turn on the spot.' },
  { id: 'hero', label: 'Hero orbit', duration: 7, description: 'The camera sweeps around the product and settles on the front.' },
  { id: 'roll', label: 'Roll in', duration: 6, description: 'The can rolls in on its side and comes to rest with the front facing you.' },
  { id: 'fold', label: 'Fold up', duration: 9, description: 'The flat dieline folds itself into the finished box, then turns.' },
  { id: 'slide', label: 'Slide open', duration: 6, description: 'The tray slides out of its sleeve and back.' },
  { id: 'open', label: 'Open lid', duration: 6, description: 'The lid lifts off the tube and drops back.' },
  { id: 'spin', label: 'Card flip', duration: 5, description: 'The card lifts and flips to show both sides.' },
  { id: 'sway', label: 'Sway', duration: 6, description: 'A gentle swing, as if hanging in a shop.' },
  { id: 'float', label: 'Float', duration: 6, description: 'Hovering and drifting, for social loops.' },
  { id: 'reveal', label: 'Push in', duration: 5, description: 'A slow push from a wide shot into a close-up of the front.' },
  { id: 'pour', label: 'Pour', duration: 8, description: 'The can or bottle tilts over a glass and fills it: stream, rising level, bubbles and foam.' },
  { id: 'fizz', label: 'Fizz', duration: 6, description: 'A slow idle beside a full glass: bubbles rising and the dew catching the light.' },
];

/** Animations offered for a product (template list first, then the generic ones). */
export function animationsFor(templateModes: string[], traits: ProductTraits): typeof ANIMATIONS {
  const generic = ['turntable', 'hero', 'float', 'reveal'];
  const allowed = new Set([...templateModes, ...generic]);
  if (traits.canPour) { allowed.add('pour'); }
  if (traits.drink) { allowed.add('fizz'); }
  if (!traits.rollRadius) allowed.delete('roll');
  if (!traits.hasFold) allowed.delete('fold');
  if (!traits.hasOpen) { allowed.delete('slide'); allowed.delete('open'); allowed.delete('spin'); }
  const order = [...templateModes, ...generic, 'pour', 'fizz'];
  return order.filter((v, i) => allowed.has(v) && order.indexOf(v) === i).map((id) => ANIMATIONS.find((a) => a.id === id)!).filter(Boolean);
}

export function restSample(traits: ProductTraits, fold = 1, open = 0): Sample {
  return { spin: 0, tilt: 0, lift: 0, lying: 0, travel: 0, fold, open, pour: -1, cam: null };
}

const baseEl = (traits: ProductTraits) => (traits.lying ? 0.62 : 0.2);

export function sampleTimeline(mode: AnimationMode, t: number, duration: number, traits: ProductTraits, loop: boolean): Sample {
  const d = Math.max(0.1, duration);
  let p = t / d;
  if (loop) p = ((p % 1) + 1) % 1; else p = clamp01(p);
  const s: Sample = { spin: 0, tilt: 0, lift: 0, lying: 0, travel: 0, fold: 1, open: 0, pour: -1, cam: { az: -0.5, el: baseEl(traits), zoom: 1 } };
  const el = baseEl(traits);
  switch (mode) {
    case 'turntable':
      s.spin = p * Math.PI * 2;
      s.cam = { az: 0, el: el * 0.9, zoom: 1, stable: true };
      break;
    case 'hero': {
      const k = easeInOutCubic(p);
      s.cam = { az: lerp(-1.25, -0.42, k), el: lerp(el * 0.45, el * 1.35, k), zoom: lerp(1.25, 0.96, k) };
      break;
    }
    case 'roll': {
      const k = easeOutCubic(p / 0.62);
      s.lying = 1;
      s.travel = -3.2 * (1 - k);
      s.cam = { az: -0.32, el: 0.28, zoom: 1.05, stable: true };
      break;
    }
    case 'fold': {
      s.fold = easeInOutCubic(p / 0.62);
      const turn = easeInOutCubic((p - 0.68) / 0.32);
      s.spin = turn * 0.95;
      s.cam = { az: 0, el: lerp(0.08, el * 1.2, turn), zoom: 1, stable: true };
      break;
    }
    case 'slide':
    case 'open': {
      const out = easeInOutCubic(p / 0.38), back = easeInOutCubic((p - 0.62) / 0.38);
      s.open = out * (1 - back);
      s.cam = { az: -0.55, el: el * 1.3, zoom: 1.05, stable: true };
      break;
    }
    case 'spin':
      s.open = easeInOutCubic((p - 0.15) / 0.7);
      s.cam = { az: -0.3, el: 0.62, zoom: 1.05, stable: true };
      break;
    case 'sway':
      s.spin = 0.5 * Math.sin(p * Math.PI * 2);
      s.tilt = 0.035 * Math.sin(p * Math.PI * 4);
      s.cam = { az: 0, el: el * 0.8, zoom: 1, stable: true };
      break;
    case 'float':
      s.lift = 0.07 + 0.045 * Math.sin(p * Math.PI * 2);
      s.spin = 0.38 * Math.sin(p * Math.PI * 2);
      s.tilt = 0.06 * Math.sin(p * Math.PI * 4 + 1);
      s.cam = { az: -0.35, el: el, zoom: 1.05, stable: true };
      break;
    case 'reveal': {
      const k = easeInOutCubic(p / 0.85);
      s.cam = { az: lerp(-0.75, -0.08, k), el: lerp(el * 1.6, el * 0.55, k), zoom: lerp(1.55, 0.6, k), aimY: lerp(0, 0.08, k) };
      break;
    }
    case 'pour':
      // Hold the glass full for the last stretch; the loop starts again from an empty glass.
      s.pour = Math.min(1, p / 0.94);
      s.cam = { az: -0.28, el: 0.16, zoom: 0.9, stable: true };
      break;
    case 'fizz':
      s.pour = 1;
      s.cam = { az: -0.3 + 0.08 * Math.sin(p * Math.PI * 2), el: 0.14, zoom: 0.96, stable: true };
      break;
    default:
      s.cam = null;
  }
  return s;
}
