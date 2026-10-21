/**
 * Real-time 3D product mockup (three.js), adapted from Book Design Studio's book scene: PBR
 * products in a lit studio (key/fill/rim rig, room environment, VSM key shadow, soft contact
 * shadow, studio sweep or table backdrops), auto-framing for any aspect ratio, a timeline of
 * product animations, and frame-exact rendering for stills and video.
 *
 * Scene graph:  root (pt → scene units) → slot.motion (lift, spin, tilt) → slot.layer (lying
 * on the side, travel) → slot.center → model.group (own roll / fold / open).
 */
import {
  ACESFilmicToneMapping, AgXToneMapping, BackSide, Box3, Color, Euler, Group, Mesh, NeutralToneMapping, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, ShadowMaterial,
  SRGBColorSpace, Vector2, Vector3, VSMShadowMap, WebGLRenderer, type Texture, type ToneMapping, type WebGLProgramParametersWithUniforms, type WebGLRenderTarget,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Backdrop, DEFAULT_BACKDROP, isSurface, resolveBackdrop, type ResolvedBackdrop } from './backdrop';
import { ContactShadow } from './contactShadow';
import { LightRig, resolveLighting, type ResolvedLighting } from './lighting';
import { createCanvas } from './texutil';
import { mm } from '../model/units';
import { sampleTimeline, restSample, type CameraKey, type Sample, type ProductTraits } from './animation';
import type { AnimationMode, AnimationOptions, BackdropOptions, CameraOptions, LightingOptions, ToneMappingId } from './types';
import { ENV_INFO, disposeEnvironments, environmentEquirect, loadEnvironment, type EnvPreset } from './env';
import { InstancedMesh, Matrix4, MeshStandardMaterial, type Material, type MeshPhysicalMaterial, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { denoisePhoto } from './photoDenoise';

export interface PhotoOptions {
  width: number;
  height: number;
  /** Path-tracing samples per pixel. */
  samples: number;
  /** Diffuse / specular bounces per path (default 8); transmission gets its own budget. */
  bounces?: number;
  /**
   * Guided denoising of the final image (default on; `false` = raw samples). `strength` 1 = the
   * full filter reach; lower keeps more of the raw grain.
   */
  denoise?: false | { strength?: number };
  onProgress?: (fraction: number, samples: number) => void;
  signal?: AbortSignal;
}

/**
 * Chrome on macOS runs WebGL through ANGLE on Metal, which compiles with fast math: the path
 * tracer's `isnan()` / `isinf()` guard is optimised away, and the occasional NaN sample (grazing
 * clearcoat lobes, refraction at total internal reflection) poisons its pixel's running average for
 * good, so every clearcoated or refracting surface came out black. Test the float bits instead,
 * which no optimiser can assume away, and drop such samples (alpha 0: the running average blends
 * them in with zero weight).
 */
function nanSafePathTracer(pt: unknown): void {
  const m = (pt as { _pathTracer?: { material?: { fragmentShader: string; needsUpdate: boolean } } })._pathTracer?.material;
  if (!m) return;
  const bad = (v: string, n: 3 | 4) => `any( greaterThanEqual( floatBitsToUint( ${v} ) & 0x7fffffffu, uvec${n}( 0x7f800000u ) ) )`;
  m.fragmentShader = m.fragmentShader
    // A path whose throughput went bad poisons the whole sample: flag it for the check below.
    .replace('if ( any( isnan( state.throughputColor ) ) || any( isinf( state.throughputColor ) ) ) {', `if ( ${bad('state.throughputColor', 3)} ) {\n\t\t\t\t\t\t\tgl_FragColor.rgb = vec3( uintBitsToFloat( 0x7fc00000u ) );`)
    .replace('gl_FragColor.a *= opacity;', `gl_FragColor.a *= opacity;\n\t\t\t\t\tif ( ${bad('gl_FragColor', 4)} ) gl_FragColor = vec4( 0.0 );`);
  m.needsUpdate = true;
}

/** Resolves once the GPU has finished the commands queued so far (polled, never blocking). */
async function gpuFinish(gl: WebGL2RenderingContext): Promise<void> {
  const sync = typeof gl.fenceSync === 'function' ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
  if (!sync) { await new Promise((r) => setTimeout(r, 0)); return; }
  gl.flush();
  try {
    for (;;) {
      const s = gl.clientWaitSync(sync, 0, 0);
      if (s === gl.ALREADY_SIGNALED || s === gl.CONDITION_SATISFIED || s === gl.WAIT_FAILED || gl.isContextLost()) return;
      await new Promise((r) => setTimeout(r, 1));
    }
  } finally {
    gl.deleteSync(sync);
  }
}

/** Instanced meshes (bubbles, splash) as plain merged meshes for the path tracer; returns an undo. */
function bakeInstances(root: Object3D): () => void {
  const undo: (() => void)[] = [];
  const list: InstancedMesh[] = [];
  root.traverseVisible((o) => { if ((o as InstancedMesh).isInstancedMesh) list.push(o as InstancedMesh); });
  const m = new Matrix4();
  for (const im of list) {
    const parts = [];
    for (let i = 0; i < Math.min(im.count, 4000); i++) {
      im.getMatrixAt(i, m);
      if (Math.abs(m.determinant()) < 1e-12) continue;
      parts.push(im.geometry.clone().applyMatrix4(m));
    }
    if (!parts.length) continue;
    const geo = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (!geo) continue;
    const mesh = new Mesh(geo, im.material as Material);
    mesh.position.copy(im.position); mesh.quaternion.copy(im.quaternion); mesh.scale.copy(im.scale);
    im.parent?.add(mesh);
    im.visible = false;
    undo.push(() => { mesh.removeFromParent(); geo.dispose(); im.visible = true; });
  }
  return () => { for (const u of undo) u(); };
}
import { applyDew, DEW_OFF, type DewHandle, type DewOptions } from './dew';
import { buildIce, type IceSet } from './ice';
import { PourRig, type LiquidKind } from './pour';

/** "Refreshing" set dressing for drinks: dew on the product, ice on set, a glass to pour into. */
export interface RefreshOptions {
  dew: DewOptions;
  /** Ice cubes scattered on the floor around the product. */
  ice: number;
  /** The product stands in a bed of crushed ice. */
  iceBed: boolean;
  /** A glass beside the product (always there for the pour and fizz animations). */
  glass: boolean;
  liquid: LiquidKind;
  liquidColor: string | null;
  /** Ice cubes in the glass. */
  glassIce: number;
}

export const REFRESH_OFF: RefreshOptions = { dew: DEW_OFF, ice: 0, iceBed: false, glass: false, liquid: 'cola', liquidColor: null, glassIce: 0 };
import type { ProductModel } from './models';

export const SCENE_UNITS_PER_PT = 1 / mm(10);
const MARGIN = 1.12;

interface Slot {
  model: ProductModel;
  traits: ProductTraits;
  motion: Group;
  layer: Group;
  center: Group;
  /** Rest size (pt) and height. */
  size: Vector3;
  x: number;
}

export class ProductScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.5, 3000);
  private readonly controls: OrbitControls;
  private readonly pmrem: PMREMGenerator;
  private readonly envTarget: WebGLRenderTarget;
  private readonly lights = new LightRig();
  private readonly ground: Mesh<PlaneGeometry, ShadowMaterial>;
  private readonly groundFade = { value: 30 };
  private readonly contact = new ContactShadow(512);
  private readonly backdrop = new Backdrop();
  private readonly root = new Group();
  private slots: Slot[] = [];
  /** Props on set besides the products (glass, ice) that the framing and the camera guard include. */
  private extras: Group[] = [];

  private envPreset: EnvPreset = 'room';
  private envRequest = 0;
  /** World box of what is on set right now (no squaring), for the camera guard and clip planes. */
  private tight = new Box3();
  private lightingOpts: LightingOptions = { preset: 'studio' };
  private lighting: ResolvedLighting = resolveLighting({ preset: 'studio' });
  private backdropState: ResolvedBackdrop = DEFAULT_BACKDROP;
  private span = 20;

  private mode: AnimationMode = 'none';
  private animOpts: AnimationOptions = {};
  private playing = false;
  private playStart = 0;
  private playFrom = 0;
  private time = 0;
  private userCamera = false;
  private manual = { fold: 1, open: 0, pour: 1 };
  private refresh: RefreshOptions = REFRESH_OFF;
  private refreshKey = '';
  private dew: DewHandle | null = null;
  private iceSet: IceSet | null = null;
  private pourRig: PourRig | null = null;
  /** Everything the pour sweeps through (set coordinates), so its framing holds still. */
  private pourFrame: Box3 | null = null;
  /** Time (s) of the sample being applied, for the pour's stream and bubbles. */
  private sampleTime = 0;
  private restCam: CameraKey = { az: -0.5, el: 0.2, zoom: 1 };

  private sample: Sample = restSample({});
  private corners: Vector3[] = [];
  private center = new Vector3();
  private dirty = true;
  private shadowDirty = true;
  private raf = 0;
  private offline = false;
  private disposed = false;
  private live = { w: 300, h: 150, pr: 1 };
  private lastPose = '';
  private readonly tmpV = new Vector3();

  constructor(canvas: HTMLCanvasElement, opts?: { preserveDrawingBuffer?: boolean }) {
    this.canvas = canvas;
    const r = new WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: !!opts?.preserveDrawingBuffer, powerPreference: 'high-performance' });
    this.renderer = r;
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = VSMShadowMap;
    r.shadowMap.autoUpdate = false;
    this.pmrem = new PMREMGenerator(r);
    const room = new RoomEnvironment();
    this.envTarget = this.pmrem.fromScene(room, 0.04);
    room.dispose();
    this.scene.environment = this.envTarget.texture;
    this.scene.add(...this.lights.objects);

    this.ground = new Mesh(new PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new ShadowMaterial({ opacity: 0.22 }));
    const fade = this.groundFade;
    this.ground.material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.fadeRadius = fade;
      shader.vertexShader = `varying vec2 vGroundXZ;\n${shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n\tvGroundXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;')}`;
      shader.fragmentShader = `uniform float fadeRadius;\nvarying vec2 vGroundXZ;\n${shader.fragmentShader.replace(
        'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
        'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) * ( 1.0 - smoothstep( 0.5, 0.92, length( vGroundXZ ) / fadeRadius ) ) );',
      )}`;
    };
    // Pulled toward the camera in depth so it never fights the backdrop floor under it.
    this.ground.material.polygonOffset = true;
    this.ground.material.polygonOffsetFactor = -1;
    this.ground.material.polygonOffsetUnits = -4;
    // A shadow overlay: it needn't occlude anything, and the contact shadow above it must not
    // fight its depth.
    this.ground.material.depthWrite = false;
    this.ground.position.y = -0.002;
    this.ground.receiveShadow = true;
    this.ground.castShadow = true;
    this.scene.add(this.ground, this.contact.group, this.backdrop.group);
    this.root.scale.setScalar(SCENE_UNITS_PER_PT);
    this.scene.add(this.root);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.addEventListener('start', () => { this.userCamera = true; this.dirty = true; });
    this.controls.addEventListener('change', () => { this.dirty = true; this.onCameraChange?.(); });

    this.applyLighting();
    this.applyBackdrop();
    this.resize(canvas.clientWidth || 300, canvas.clientHeight || 150, typeof window !== 'undefined' ? window.devicePixelRatio : 1);
    this.raf = requestAnimationFrame(this.frame);
  }

  /* ----------------------------------------------------------------------- */
  /* Content                                                                  */
  /* ----------------------------------------------------------------------- */

  /** Replace the products on set (one hero, or a line-up left to right). */
  setModels(models: ProductModel[]): void {
    for (const s of this.slots) { this.root.remove(s.motion); s.model.dispose(); }
    this.slots = [];
    let x = 0;
    const sizes: Vector3[] = [];
    for (const m of models) {
      m.pose({ fold: 1, open: 0, roll: 0 });
      m.group.updateMatrixWorld(true);
      const b = new Box3().setFromObject(m.group);
      const size = b.getSize(new Vector3());
      sizes.push(size);
    }
    const gap = models.length > 1 ? Math.max(...sizes.map((s) => Math.max(s.x, s.z))) * 0.25 : 0;
    models.forEach((m, i) => {
      const motion = new Group(), layer = new Group(), center = new Group();
      motion.rotation.order = 'YXZ';
      center.add(m.group);
      layer.add(center);
      motion.add(layer);
      this.root.add(motion);
      const size = sizes[i];
      const slot: Slot = { model: m, traits: m.info, motion, layer, center, size, x: x + size.x / 2 };
      x += size.x + gap;
      this.slots.push(slot);
    });
    const shift = x - gap;
    for (const s of this.slots) s.x -= shift / 2;
    const maxDim = Math.max(1, ...sizes.map((s) => Math.max(s.x, s.y, s.z)));
    this.span = Math.max(shift, maxDim) * SCENE_UNITS_PER_PT;
    const t = this.slots[0]?.traits ?? {};
    this.restCam = { az: -0.5, el: t.lying ? 0.62 : 0.22, zoom: 1 };
    this.placeShadowFrustum();
    this.applyLighting();
    this.applyBackdrop();
    this.lastPose = '';
    this.shadowDirty = true;
    this.refreshKey = '';
    this.buildRefresh();
    this.applyCurrent();
  }

  /** Dew, ice and the glass for drinks. */
  setRefresh(o: RefreshOptions): void {
    this.refresh = o;
    this.buildRefresh();
    this.applyCurrent();
  }

  private buildRefresh(): void {
    const o = this.refresh;
    const hero = this.slots.length === 1 ? this.slots[0] : null;
    const wantsGlass = !!hero?.model.info.pour && (o.glass || this.mode === 'pour' || this.mode === 'fizz');
    const key = JSON.stringify([o, wantsGlass, hero ? this.slots.indexOf(hero) : -1, hero?.model.group.uuid]);
    if (key === this.refreshKey) return;
    this.refreshKey = key;
    this.dew?.undo(); this.dew = null;
    if (this.iceSet) { this.root.remove(this.iceSet.group); this.iceSet.dispose(); this.iceSet = null; }
    if (this.pourRig) { this.root.remove(this.pourRig.group); this.pourRig.dispose(); this.pourRig = null; }
    this.extras = [];
    if (!hero) return;
    const info = hero.model.info;
    if (info.dew && (o.dew.amount > 0 || o.dew.frost > 0)) { this.dew = applyDew(hero.model.group, info.dew, o.dew); this.aimDewGlints(); }
    const radius = Math.max(hero.size.x, hero.size.z) / 2;
    if (o.ice > 0 || o.iceBed) {
      this.iceSet = buildIce({ cubes: Math.round(o.ice), bed: o.iceBed, productRadius: radius, mm: mm(1) });
      if (this.iceSet) { this.root.add(this.iceSet.group); this.extras.push(this.iceSet.group); }
    }
    this.pourFrame = null;
    if (wantsGlass && info.pour) {
      this.pourRig = new PourRig(info.pour, { liquid: o.liquid, color: o.liquidColor, ice: o.glassIce });
      this.pourRig.place(radius);
      this.root.add(this.pourRig.group);
      this.extras.push(this.pourRig.group);
      // The whole pour's extent, sampled once.
      const frame = new Box3();
      const m = hero.motion;
      const pos = m.position.clone(), rot = m.rotation.clone();
      for (let i = 0; i <= 24; i++) {
        const pose = this.pourRig.productPose(i / 24);
        m.position.copy(pose.position); m.rotation.set(0, 0, -pose.tilt);
        this.root.updateMatrixWorld(true);
        frame.expandByObject(m);
      }
      m.position.copy(pos); m.rotation.copy(rot);
      this.root.updateMatrixWorld(true);
      frame.expandByObject(this.pourRig.group);
      this.pourFrame = frame;
    }
    this.shadowDirty = true;
  }

  /** Call after the models' textures changed. */
  invalidate(): void {
    this.shadowDirty = true;
    this.dirty = true;
  }

  get traits(): ProductTraits { return this.slots[0]?.traits ?? {}; }

  /** Static fold / open amounts (when no animation is playing). */
  setManual(p: { fold?: number; open?: number; pour?: number }): void {
    this.manual = { ...this.manual, ...p };
    if (this.mode === 'none' || !this.playing) this.applyCurrent();
  }

  private placeShadowFrustum(): void {
    const span = this.span;
    const reach = span * 1.4;
    const dist = span * 3;
    const cam = this.lights.key.shadow.camera;
    cam.left = -reach; cam.right = reach; cam.top = reach; cam.bottom = -reach;
    cam.near = dist * 0.3; cam.far = dist * 2;
    cam.updateProjectionMatrix();
    this.lights.key.shadow.normalBias = 0.0006 * span;
    this.groundFade.value = reach;
    const h = Math.max(...this.slots.map((s) => s.size.y), 1) * SCENE_UNITS_PER_PT;
    this.contact.setArea(0, 0, span * 2.6, span * 2.6, Math.max(h, span * 0.3) * 0.9);
    // Flat things lying on the floor (cards, letterheads) only darken a hairline at their edges;
    // the standard blur, scaled to their large footprint, would spread a dark halo around them.
    const flat = h < span * 0.06;
    this.contact.blur = flat ? 0.3 : 2.2;
    this.contact.opacity = flat ? 0.5 : 0.85;
    this.controls.minDistance = span * 0.25;
    this.controls.maxDistance = span * 14;
    this.renderer.shadowMap.needsUpdate = true;
  }

  /* ----------------------------------------------------------------------- */
  /* Lighting, backdrop, camera                                               */
  /* ----------------------------------------------------------------------- */

  setLighting(o: LightingOptions): void {
    this.lightingOpts = o.preset ? { ...o } : { ...this.lightingOpts, ...o };
    this.applyLighting();
  }

  setBackdrop(o: BackdropOptions): void {
    this.backdropState = resolveBackdrop(o, this.backdropState);
    this.applyBackdrop();
  }

  hasTransparentBackground(): boolean { return this.backdropState.preset === 'transparent'; }

  /** Studio HDRI (or the procedural room) for reflections and bounce light. */
  setEnvironment(preset: EnvPreset): Promise<void> {
    const req = ++this.envRequest;
    this.envPreset = preset;
    if (preset === 'room') {
      this.scene.environment = this.envTarget.texture;
      this.applyLighting();
      return Promise.resolve();
    }
    return loadEnvironment(this.renderer, preset).then((rt) => {
      if (this.disposed || req !== this.envRequest) return;
      if (!rt) { this.envPreset = 'room'; this.scene.environment = this.envTarget.texture; }
      else this.scene.environment = rt.texture;
      this.applyLighting();
      this.shadowDirty = true;
    });
  }

  setToneMapping(id: ToneMappingId): void {
    const tm: ToneMapping = id === 'agx' ? AgXToneMapping : id === 'aces' ? ACESFilmicToneMapping : NeutralToneMapping;
    if (this.renderer.toneMapping === tm) return;
    this.renderer.toneMapping = tm;
    // Materials compile the tone mapping in; recompile.
    this.scene.traverse((o) => { const m = (o as Mesh).material; if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true; });
    this.dirty = true;
  }

  private applyLighting(): void {
    const l = resolveLighting(this.lightingOpts);
    this.lighting = l;
    this.lights.apply(l, new Vector3(0, this.span * 0.2, 0), this.span, false, true);
    this.aimDewGlints();
    this.renderer.toneMappingExposure = l.exposure;
    // The environment's own key (softbox / window) turns with the key light, so reflections and
    // the cast shadow agree.
    const env = ENV_INFO[this.envPreset];
    this.scene.environmentIntensity = env.intensity * l.ambient;
    const turn = ((l.azimuth - env.keyAz) * Math.PI) / 180;
    this.scene.environmentRotation = new Euler(0, turn, 0);
    this.applyShadowStrength();
    this.applyBackground();
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }

  /** Point the dew's glints at the key and rim lights. */
  private aimDewGlints(): void {
    if (!this.dew) return;
    const dir = (l: { position: Vector3; target: { position: Vector3 } }) => l.position.clone().sub(l.target.position).normalize();
    this.dew.setLights(dir(this.lights.key), dir(this.lights.rim));
  }

  private applyBackdrop(): void {
    const st = this.backdropState;
    this.backdrop.build(st, this.span, 8);
    this.ground.material.colorWrite = st.showGround;
    this.ground.material.depthWrite = st.showGround;
    this.contact.group.visible = st.showGround;
    this.controls.maxPolarAngle = st.showGround ? Math.PI / 2 - 0.03 : Math.PI;
    this.applyShadowStrength();
    this.applyBackground();
    this.renderer.shadowMap.needsUpdate = true;
    this.shadowDirty = true;
    this.dirty = true;
  }

  private applyShadowStrength(): void {
    const p = this.backdropState.preset;
    const textured = isSurface(p) || p === 'studio-sweep';
    this.ground.material.opacity = (0.3 - 0.12 * this.lighting.shadowSoftness) * (textured ? 1.6 : 1);
  }

  private applyBackground(): void {
    const bg: Color | Texture | null = this.backdrop.background(this.lighting.backdrop);
    this.scene.background = bg;
    if (bg === null) this.renderer.setClearColor(0x000000, 0);
    else if (bg instanceof Color) this.renderer.setClearColor(bg, 1);
    else this.renderer.setClearColor(0x000000, 1);
    this.dirty = true;
  }

  setCamera(o: CameraOptions): void {
    if (o.fov != null && Number.isFinite(o.fov)) {
      const prev = this.camera.fov;
      const fov = Math.max(15, Math.min(75, o.fov));
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      if (this.userCamera) {
        const k = Math.tan((prev * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360);
        const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(k);
        this.camera.position.copy(this.controls.target).add(offset);
        this.controls.update();
      } else this.applyCurrent();
      this.dirty = true;
    }
  }

  resetCamera(): void {
    this.userCamera = false;
    this.applyCurrent();
    this.controls.update();
  }

  /* ----------------------------------------------------------------------- */
  /* Animation                                                                */
  /* ----------------------------------------------------------------------- */

  setAnimation(mode: AnimationMode, opts: AnimationOptions = {}): void {
    this.mode = mode;
    this.animOpts = { ...opts };
    this.buildRefresh();
    this.time = 0;
    this.playStart = performance.now();
    this.playFrom = 0;
    if (mode === 'none') this.playing = false;
    else this.userCamera = false;
    this.applyCurrent();
  }

  play(): void {
    if (this.mode === 'none') return;
    const d = this.getAnimationDuration();
    if (this.animOpts.loop === false && this.time >= d) this.time = 0;
    this.playing = true;
    this.playFrom = this.time;
    this.playStart = performance.now();
    this.dirty = true;
  }

  pause(): void { this.playing = false; }
  isPlaying(): boolean { return this.playing; }
  getAnimationDuration(): number { return this.animOpts.duration ?? 6; }
  /** Playhead position in seconds. */
  getTime(): number { return this.time; }

  seek(t: number): void {
    this.time = Number.isFinite(t) ? t : 0;
    if (this.playing) { this.playFrom = this.time; this.playStart = performance.now(); }
    this.applyAt(this.time, true);
  }

  private timelineSample(t: number): Sample {
    if (this.mode === 'none') { const r = restSample(this.traits, this.manual.fold, this.manual.open); r.pour = this.pourRig ? this.manual.pour : -1; return r; }
    return sampleTimeline(this.mode, t, this.getAnimationDuration(), this.traits, this.animOpts.loop !== false);
  }

  private applyAt(t: number, camera: boolean): void {
    this.sampleTime = t;
    const s = this.timelineSample(t);
    if (this.mode !== 'none' && !this.playing && this.time === 0 && (this.mode === 'fold')) s.fold = Math.max(s.fold, 0);
    this.applySample(s);
    if (camera && (!this.userCamera)) this.frameCamera(s.cam ?? this.restCam);
  }

  private applyCurrent(): void { this.applyAt(this.time, !this.userCamera); }

  private applySample(s: Sample): void {
    const multi = this.slots.length > 1;
    for (const slot of this.slots) {
      const sz = Math.max(slot.size.x, slot.size.y, slot.size.z);
      const r = slot.traits.rollRadius ?? 0;
      const lying = !multi && r ? s.lying : 0;
      slot.motion.position.set(slot.x, s.lift * sz, 0);
      slot.motion.rotation.set(s.tilt, s.spin, 0);
      slot.center.position.set(0, -lying * slot.size.y / 2, 0);
      slot.layer.rotation.set(0, 0, lying * Math.PI / 2);
      const travel = lying ? s.travel * sz : 0;
      slot.layer.position.set(lying * 0, lying * r, travel);
      slot.model.group.rotation.y = lying && r ? -travel / r : 0;
      slot.model.pose({ fold: multi ? 1 : s.fold, open: multi ? 0 : s.open, roll: 0, pour: 0 });
    }
    // The pour: the hero tilts over the glass, which fills.
    const rig = this.pourRig, hero = this.slots[0];
    if (rig && hero && !multi) {
      const p = s.pour >= 0 ? s.pour : this.manual.pour;
      const animated = this.mode === 'pour' || (this.mode === 'none' && p < 1);
      const pose = rig.productPose(animated ? p : 1);
      let mouth: Vector3 | null = null;
      if (animated && pose.tilt > 1e-3) {
        hero.motion.position.copy(pose.position);
        hero.motion.rotation.set(0, 0, -pose.tilt);
        hero.model.pose({ fold: 1, open: 0, roll: 0, pour: p });
        hero.motion.updateMatrixWorld(true);
        mouth = hero.model.info.pour!.mouth.clone().applyMatrix4(hero.motion.matrix);
      }
      rig.update(this.mode === 'fizz' ? 1 : p, this.sampleTime, mouth, pose.tilt);
    }
    this.root.updateMatrixWorld(true);
    this.measure(s.cam?.stable ?? false);
    const key = [s.spin, s.tilt, s.lift, s.lying, s.travel, s.fold, s.open, s.pour, this.manual.pour].map((v) => v.toFixed(4)).join('|');
    if (key !== this.lastPose) { this.lastPose = key; this.shadowDirty = true; }
    this.sample = s;
    this.dirty = true;
  }

  /** World corners of the content (squared in plan for stable, rotation-proof framing). */
  private measure(stable: boolean): void {
    const box = new Box3();
    for (const s of this.slots) box.expandByObject(s.motion);
    for (const o of this.extras) if (o.visible) box.expandByObject(o);
    if (box.isEmpty()) box.set(new Vector3(-5, 0, -5), new Vector3(5, 10, 5));
    this.tight.copy(box);
    // A pour frames its whole sweep, so the camera does not pump as the product lifts and turns.
    if (this.pourFrame && (this.mode === 'pour' || this.mode === 'fizz' || (this.mode === 'none' && this.manual.pour < 1))) box.union(this.pourFrame);
    const c = box.getCenter(new Vector3());
    const min = box.min.clone(), max = box.max.clone();
    if (stable && this.slots.length === 1) {
      const s = this.slots[0];
      const half = (Math.hypot(s.size.x, s.size.z) / 2) * SCENE_UNITS_PER_PT;
      min.x = Math.min(min.x, c.x - half); max.x = Math.max(max.x, c.x + half);
      min.z = Math.min(min.z, c.z - half); max.z = Math.max(max.z, c.z + half);
      if (this.mode === 'roll') { min.z -= half * 1.5; }
    }
    this.center.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    this.corners = [];
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) this.corners.push(new Vector3(x, y, z));
  }

  private static viewDir(az: number, el: number): Vector3 {
    return new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  }

  private fitDistance(f: Vector3, aspect: number, center: Vector3): number {
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360);
    const tanH = tanV * aspect;
    const up = Math.abs(f.y) > 0.999 ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
    const r = up.cross(f).normalize();
    const u = new Vector3().crossVectors(f, r);
    const d = new Vector3();
    let dist = 0.5;
    for (const p of this.corners) {
      d.subVectors(p, center);
      const depth = d.dot(f);
      dist = Math.max(dist, depth + Math.abs(d.dot(r)) / tanH, depth + Math.abs(d.dot(u)) / tanV);
    }
    return dist * MARGIN;
  }

  private frameCamera(cam: CameraKey): void {
    const el = Math.max(0.02, Math.min(1.45, cam.el));
    const f = ProductScene.viewDir(cam.az, el);
    const target = this.center.clone();
    if (cam.aimY) {
      const h = Math.max(...this.corners.map((p) => p.y)) - Math.min(...this.corners.map((p) => p.y));
      target.y += h * cam.aimY;
    }
    const dist = this.fitDistance(f, this.camera.aspect, target) * cam.zoom;
    this.camera.position.copy(target).addScaledVector(f, dist);
    this.camera.lookAt(target);
    this.controls.target.copy(target);
    this.dirty = true;
    this.onCameraChange?.();
  }

  private refitUserCamera(fromAspect: number, toAspect: number): void {
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    const dist = offset.length();
    if (dist < 1e-6) return;
    const f = offset.clone().normalize();
    const ratio = dist / this.fitDistance(f, fromAspect, target);
    this.camera.position.copy(target).addScaledVector(f, ratio * this.fitDistance(f, toAspect, target));
    this.camera.lookAt(target);
  }

  /* ----------------------------------------------------------------------- */
  /* Rendering                                                                */
  /* ----------------------------------------------------------------------- */

  resize(width: number, height: number, pixelRatio?: number): void {
    this.offline = false;
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
    const pr = Math.min(2, Math.max(0.5, pixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1)));
    const fromAspect = this.camera.aspect;
    this.live = { w, h, pr };
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userCamera) this.applyCurrent();
    else if (Math.abs(fromAspect - this.camera.aspect) > 1e-3) this.refitUserCamera(fromAspect, this.camera.aspect);
    this.dirty = true;
  }

  render(): void { this.renderNow(); }

  private prepareOffline(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h || this.renderer.getPixelRatio() !== 1) {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(w, h, false);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Video export: pose at t, render exactly w × h into the scene canvas and return it. */
  renderFrame(t: number, width: number, height: number): HTMLCanvasElement {
    this.offline = true;
    const w = Math.max(2, Math.round(width)), h = Math.max(2, Math.round(height));
    const liveAspect = this.live.w / this.live.h;
    const pos = this.camera.position.clone(), tgt = this.controls.target.clone();
    this.prepareOffline(w, h);
    if (this.mode !== 'none' || !this.userCamera) this.applyAt(t, true);
    else {
      this.applyAt(t, false);
      this.camera.position.copy(pos); this.controls.target.copy(tgt);
      this.refitUserCamera(liveAspect, w / h);
    }
    this.renderNow();
    return this.canvas;
  }

  /** A still of the current pose and camera at exactly w × h, returned as a separate 2D canvas. */
  renderStill(width: number, height: number): HTMLCanvasElement {
    const w = Math.max(2, Math.round(width)), h = Math.max(2, Math.round(height));
    const wasOffline = this.offline;
    this.offline = true;
    const position = this.camera.position.clone(), target = this.controls.target.clone();
    const liveAspect = this.live.w / this.live.h;
    this.prepareOffline(w, h);
    if (this.userCamera) this.refitUserCamera(liveAspect, w / h);
    else this.frameCamera(this.sample.cam ?? this.restCam);
    this.shadowDirty = true;
    this.renderNow();
    const out = createCanvas(w, h);
    out.getContext('2d')?.drawImage(this.canvas, 0, 0, w, h);
    this.renderer.setPixelRatio(this.live.pr);
    this.renderer.setSize(this.live.w, this.live.h, false);
    this.camera.aspect = this.live.w / this.live.h;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.camera.lookAt(target);
    this.offline = wasOffline;
    this.dirty = true;
    if (!wasOffline) this.renderNow();
    return out;
  }

  /**
   * A path-traced photograph of the current shot (three-gpu-pathtracer): the same studio HDRI,
   * real refraction through glass, liquids, ice and water drops, soft shadows on the set. Renders
   * progressively to `samples` and returns a w × h canvas; the live view stays rasterised.
   */
  async renderPhoto(o: PhotoOptions): Promise<HTMLCanvasElement> {
    const { WebGLPathTracer } = await import('three-gpu-pathtracer');
    const w = Math.max(2, Math.round(o.width)), h = Math.max(2, Math.round(o.height));
    const wasOffline = this.offline;
    this.offline = true;
    const position = this.camera.position.clone(), target = this.controls.target.clone();
    const liveAspect = this.live.w / this.live.h;
    this.prepareOffline(w, h);
    if (this.userCamera) this.refitUserCamera(liveAspect, w / h);
    else this.frameCamera(this.sample.cam ?? this.restCam);
    this.fitClipPlanes();
    // Raster-only parts out, path-tracer stand-ins in.
    const restore: (() => void)[] = [];
    const env = this.scene.environment;
    const eq = await environmentEquirect(this.renderer, this.envPreset);
    this.scene.environment = eq;
    restore.push(() => { this.scene.environment = env; });
    const hidden: Object3D[] = [this.ground, this.contact.group];
    // Raster stand-ins that only cast shadows (garment hem caps) would be solid to the tracer.
    this.scene.traverse((x) => { if (x.userData.shadowOnly) hidden.push(x); });
    for (const obj of hidden) { const v = obj.visible; obj.visible = false; restore.push(() => { obj.visible = v; }); }
    // The HDRI's softboxes light the photo; the raster rig's point-like key would cast hard
    // shadows, so it is only a gentle accent here.
    for (const l of [this.lights.key, this.lights.fill, this.lights.rim, this.lights.spot]) { const i = l.intensity; l.intensity = i * 0.25; restore.push(() => { l.intensity = i; }); }
    // On plain backdrops the floor is a shadow catcher.
    if (this.backdropState.showGround && !this.backdrop.group.children.length) {
      const bg = this.scene.background instanceof Color ? this.scene.background : new Color('#dddddd');
      const mat = new MeshStandardMaterial({ color: bg, roughness: 1 });
      (mat as unknown as { matte: boolean }).matte = true;
      const floor = new Mesh(new PlaneGeometry(600, 600).rotateX(-Math.PI / 2), mat);
      floor.position.y = -0.003;
      this.scene.add(floor);
      restore.push(() => { floor.removeFromParent(); floor.geometry.dispose(); mat.dispose(); });
    }
    // Hashed alpha (ice fractures, perfume decorations) is stochastic transparency to the path
    // tracer only when the material says transparent. Finely tiled micro-relief normal maps (knit,
    // weave, paper tooth, brushing) go: the tracer samples textures without mipmaps, so a map
    // repeated a hundred times across a garment aliases into dark blotches, and the relief is
    // below the photo's resolution anyway.
    const seen = new Set<Material>();
    this.scene.traverse((x) => {
      const mats = (x as Mesh).material as Material | Material[] | undefined;
      if (!mats) return;
      for (const q of Array.isArray(mats) ? mats : [mats]) {
        if (seen.has(q)) continue;
        seen.add(q);
        if (q.alphaHash && !q.transparent) {
          q.transparent = true;
          restore.push(() => { q.transparent = false; });
        }
        const pm = q as MeshStandardMaterial;
        const nm = pm.normalMap;
        if (nm && nm.repeat.x * nm.repeat.y > 24) {
          pm.normalMap = null;
          restore.push(() => { pm.normalMap = nm; });
        }
      }
    });
    // Multi-material meshes are split into one mesh per group: this path tracer (0.0.24) gives
    // each mesh one material slot while listing every material of an array, so the materials of
    // all later meshes would shift (a card's print came out on the wrong face). It also ignores
    // material.visible: hidden groups (a card's extrusion caps, coplanar with its printed faces)
    // are left out, and meshes with nothing visible go.
    const hiddenNow: Mesh[] = [];
    const split: Mesh[] = [];
    this.scene.traverseVisible((x) => { if ((x as Mesh).isMesh && !(x as InstancedMesh).isInstancedMesh) split.push(x as Mesh); });
    for (const m of split) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (!Array.isArray(m.material)) { if (!m.material.visible) hiddenNow.push(m); continue; }
      hiddenNow.push(m);
      const g = m.geometry, src = g.index;
      const groups = g.groups.length ? g.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
      const total = src ? src.count : g.getAttribute('position').count;
      for (const gr of groups) {
        const mat = mats[gr.materialIndex ?? 0];
        if (!mat?.visible) continue;
        const idx: number[] = [];
        for (let i = gr.start, end = Math.min(total, gr.start + gr.count); i < end; i++) idx.push(src ? src.getX(i) : i);
        if (!idx.length) continue;
        const sg = g.clone();
        sg.clearGroups();
        sg.setIndex(idx);
        const part = new Mesh(sg, mat);
        part.matrixAutoUpdate = false;
        part.matrix.copy(m.matrix);
        part.castShadow = m.castShadow;
        part.receiveShadow = m.receiveShadow;
        m.parent!.add(part);
        restore.push(() => { part.removeFromParent(); sg.dispose(); });
      }
    }
    for (const m of hiddenNow) { m.visible = false; restore.push(() => { m.visible = true; }); }
    // Inside surfaces drawn as a BackSide twin of the outside's geometry (garment insides, label
    // backings) are coplanar with it: the tracer may hit the twin first, skip it as the wrong side
    // and then miss the outside too, seeing into the garment (dark blotches). Nudge the twins
    // a fraction of a millimetre inward for the photo.
    const byGeo = new Map<unknown, Mesh[]>();
    this.scene.traverseVisible((x) => { const m = x as Mesh; if (m.isMesh) byGeo.set(m.geometry, [...(byGeo.get(m.geometry) ?? []), m]); });
    for (const list of byGeo.values()) {
      if (list.length < 2) continue;
      for (const m of list) {
        const mat = m.material as Material;
        if (Array.isArray(m.material) || mat.side !== BackSide || !m.geometry.getAttribute('normal')) continue;
        const g = m.geometry.clone();
        const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
        const eps = 0.02 / Math.max(1e-6, m.getWorldScale(this.tmpV).x); // 0.2 mm in scene units (cm)
        for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) - nor.getX(i) * eps, pos.getY(i) - nor.getY(i) * eps, pos.getZ(i) - nor.getZ(i) * eps);
        const orig = m.geometry;
        m.geometry = g;
        restore.push(() => { m.geometry = orig; g.dispose(); });
      }
    }
    const drops = this.dew?.photoDrops();
    if (drops) { drops.visible = true; restore.push(() => { drops.visible = false; }); }
    restore.push(bakeInstances(this.scene));
    this.scene.updateMatrixWorld(true);
    const pt = new WebGLPathTracer(this.renderer);
    nanSafePathTracer(pt);
    let aborted = false;
    try {
      // Samples accumulate off screen; the canvas is only refreshed for previews and at the end.
      pt.renderToCanvas = false;
      pt.rasterizeScene = false;
      pt.minSamples = 0;
      pt.renderDelay = 0;
      pt.fadeDuration = 0;
      pt.dynamicLowRes = false;
      pt.bounces = o.bounces ?? 8;
      pt.transmissiveBounces = 10;
      pt.filterGlossyFactor = 0.3;
      // Modest tiles (~60k px) to start: one long GPU submission is what the OS kills, while tiny
      // tiles waste the GPU. The grid is refined below from measured GPU time.
      let tiles = Math.max(1, Math.min(16, Math.ceil(Math.sqrt((w * h) / 60_000))));
      pt.tiles.set(tiles, tiles);
      // Material textures share one array: size it to how many there are.
      const textures = new Set<unknown>();
      this.scene.traverseVisible((x) => { const mm = (x as Mesh).material as Material | Material[] | undefined; if (!mm) return; for (const q of Array.isArray(mm) ? mm : [mm]) for (const v of Object.values(q)) if (v && (v as { isTexture?: boolean }).isTexture) textures.add(v); });
      const ts = textures.size <= 6 ? 4096 : textures.size <= 14 ? 3072 : 2048;
      pt.textureSize.set(ts, ts);
      // BVH built on the main thread (no worker to set up); a beat for the UI first.
      await new Promise((r) => setTimeout(r, 0));
      pt.setScene(this.scene, this.camera);
      // Paced against the GPU: queueing samples faster than the GPU finishes them lets one
      // submission grow past the driver's watchdog and the context is lost (a black photo). Each
      // batch of tiles waits for its fence; the batch grows while tiles are cheap and the tile
      // grid gets finer when a single tile takes too long.
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      let lost = false;
      const onLost = () => { lost = true; };
      this.canvas.addEventListener('webglcontextlost', onLost);
      restore.push(() => this.canvas.removeEventListener('webglcontextlost', onLost));
      const present = () => {
        // Draw the accumulated image to the canvas without tracing another tile.
        pt.renderToCanvas = true;
        pt.pausePathTracing = true;
        pt.renderSample();
        pt.pausePathTracing = false;
        pt.renderToCanvas = false;
      };
      let batch = 1, tunedPass = -1, shown = performance.now();
      while (pt.samples < o.samples) {
        if (o.signal?.aborted) { aborted = true; break; }
        if (lost) throw new Error('The GPU reset during the photo render; try fewer samples or a smaller size.');
        const t0 = performance.now(), before = pt.samples;
        let n = 0;
        for (; n < batch && pt.samples < o.samples; n++) pt.renderSample();
        await gpuFinish(gl);
        const ms = performance.now() - t0, perTile = ms / Math.max(1, n);
        // Submissions of ~60–160 ms keep the GPU busy and the page responsive. Nothing renders
        // while the shaders compile, so batches grow only on measured work.
        if (pt.samples === before) batch = 1;
        else if (ms < 60 && batch < 256) batch *= 2;
        else if (ms > 160 && batch > 1) batch = Math.max(1, batch >> 1);
        // The tile grid is read at the start of each pass, so it can be retuned any time (once a pass).
        const pass = Math.floor(pt.samples);
        if (pass > tunedPass && pt.samples > before) {
          const next = perTile > 140 ? Math.ceil(tiles * 1.4) : perTile < 12 && tiles > 1 ? Math.floor(tiles / 1.4) : tiles;
          if (next !== tiles && next >= 1 && next <= 40) { tiles = next; pt.tiles.set(tiles, tiles); tunedPass = pass; }
        }
        if (performance.now() - shown > 500) { present(); shown = performance.now(); }
        o.onProgress?.(Math.min(1, pt.samples / o.samples), pt.samples);
      }
      if (aborted) throw new DOMException('Photo render cancelled', 'AbortError');
      if (lost) throw new Error('The GPU reset during the photo render; try fewer samples or a smaller size.');
      if (o.denoise !== false) {
        // Guided by albedo, normals and depth of this very view: grain goes, print stays sharp.
        const dn = denoisePhoto(this.renderer, this.scene, this.camera, pt.target.texture, w, h, o.denoise?.strength ?? 1);
        const plain = pt.renderToCanvasCallback;
        pt.renderToCanvasCallback = (target, renderer, quad) => {
          (quad.material as unknown as { map: unknown }).map = dn.texture;
          plain(target, renderer, quad);
        };
        try { present(); } finally { pt.renderToCanvasCallback = plain; dn.dispose(); }
      } else present();
      o.onProgress?.(1, pt.samples);
      const out = createCanvas(w, h);
      out.getContext('2d')?.drawImage(this.canvas, 0, 0, w, h);
      return out;
    } finally {
      pt.dispose();
      for (const r of restore.reverse()) r();
      this.renderer.setPixelRatio(this.live.pr);
      this.renderer.setSize(this.live.w, this.live.h, false);
      this.camera.aspect = this.live.w / this.live.h;
      this.camera.updateProjectionMatrix();
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.camera.lookAt(target);
      this.offline = wasOffline;
      this.shadowDirty = true;
      this.dirty = true;
    }
  }

  snapshot(): string {
    this.renderNow();
    return this.canvas.toDataURL('image/png');
  }

  private renderNow(): void {
    if (this.disposed) return;
    const c = this.center;
    this.backdrop.follow(c.x, c.z, Math.atan2(this.camera.position.x - c.x, this.camera.position.z - c.z));
    if (this.shadowDirty) {
      if (this.backdropState.showGround && this.slots.length) this.contact.render(this.renderer, this.scene, [this.ground, this.backdrop.group]);
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }
    this.fitClipPlanes();
    this.renderer.info.render.frame++;
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.offline) return;
    if (this.playing && this.mode !== 'none') {
      let t = this.playFrom + (now - this.playStart) / 1000;
      const d = this.getAnimationDuration();
      if (this.animOpts.loop === false && t >= d) { t = d; this.playing = false; }
      this.time = t;
      this.applyAt(t, !this.userCamera);
    }
    this.guardCamera();
    if (this.controls.update()) this.dirty = true;
    if (this.dirty) this.renderNow();
  };

  /**
   * Keep the orbiting camera out of the products: the closest the controls may dolly in is where
   * the view ray from the target leaves the content's box (plus a few millimetres), so zooming in
   * never ends inside a can, a box or a garment.
   */
  private guardCamera(): void {
    const b = this.tight;
    const floor = this.span * 0.04;
    if (b.isEmpty()) { this.controls.minDistance = floor; return; }
    const t = this.controls.target;
    const dir = this.tmpV.subVectors(this.camera.position, t);
    const len = dir.length();
    if (len < 1e-6) return;
    dir.divideScalar(len);
    const margin = Math.max(0.12, this.span * 0.012);
    let exit = Infinity;
    for (const ax of ['x', 'y', 'z'] as const) {
      const lo = b.min[ax] - margin, hi = b.max[ax] + margin, o = t[ax], d = dir[ax];
      if (o < lo || o > hi) { exit = 0; break; }
      if (Math.abs(d) > 1e-9) exit = Math.min(exit, ((d > 0 ? hi : lo) - o) / d);
    }
    this.controls.minDistance = Math.max(floor, Number.isFinite(exit) ? exit : 0);
  }

  /**
   * Near / far planes hugging the shot (after Book Design Studio): the near plane as far out as
   * the products and the floor in front of the lens allow, the far plane just past the set. Depth
   * precision then stays fine enough that the shadow catcher, contact shadow and backdrop floor
   * (fractions of a millimetre apart) and labels on glass never fight, at any distance.
   */
  private fitClipPlanes(): void {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const toBox = this.tight.isEmpty() ? 0.5 : this.tight.distanceToPoint(cam.position);
    const floorGap = Math.max(Math.abs(cam.position.y), 0.02 * this.span) * 0.6;
    const near = Math.max(0.01, 0.5 * Math.min(toBox > 0 ? toBox : 0.02, floorGap));
    const far = cam.position.distanceTo(this.center) + this.span * 12;
    if (Math.abs(near - cam.near) > 1e-6 || Math.abs(far - cam.far) > 1e-6) {
      cam.near = near;
      cam.far = far;
      cam.updateProjectionMatrix();
    }
  }

  /**
   * Texture density the hero product needs in the current view (px per pt of artwork), for
   * re-rasterising its art when the camera comes close; rendered at width × height (drawing buffer
   * by default).
   */
  getTextureDemand(width?: number, height?: number): number {
    const size = width && height ? new Vector2(width, height) : this.renderer.getDrawingBufferSize(new Vector2());
    const s = this.slots[0];
    if (!s) return 0;
    const box = new Box3().setFromObject(s.motion);
    if (box.isEmpty()) return 0;
    const d = Math.max(box.distanceToPoint(this.camera.position), this.span * 0.05);
    const pxPerUnit = size.y / (2 * d * Math.tan((this.camera.fov * Math.PI) / 360));
    return pxPerUnit * SCENE_UNITS_PER_PT * 1.2;
  }

  /** Called after the camera moved (orbit, zoom, framing); the viewer re-checks texture sharpness. */
  onCameraChange: (() => void) | null = null;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    for (const s of this.slots) s.model.dispose();
    this.slots = [];
    this.dew?.undo();
    this.iceSet?.dispose();
    this.pourRig?.dispose();
    this.contact.dispose();
    this.backdrop.dispose();
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.envTarget.dispose();
    this.pmrem.dispose();
    void disposeEnvironments(this.renderer);
    this.scene.clear();
    this.renderer.dispose();
  }
}
