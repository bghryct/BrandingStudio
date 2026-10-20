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
  ACESFilmicToneMapping, Box3, Color, Group, Mesh, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, ShadowMaterial,
  SRGBColorSpace, Vector3, VSMShadowMap, WebGLRenderer, type Texture, type WebGLProgramParametersWithUniforms, type WebGLRenderTarget,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Backdrop, DEFAULT_BACKDROP, isSurface, resolveBackdrop, type ResolvedBackdrop } from './backdrop';
import { ContactShadow } from './contactShadow';
import { LightRig, resolveLighting, type ResolvedLighting } from './lighting';
import { createCanvas } from './texutil';
import { mm } from '../model/units';
import { sampleTimeline, restSample, type CameraKey, type Sample, type ProductTraits } from './animation';
import type { AnimationMode, AnimationOptions, BackdropOptions, CameraOptions, LightingOptions } from './types';
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
  private manual = { fold: 1, open: 0 };
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
    this.controls.addEventListener('change', () => { this.dirty = true; });

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
    this.applyCurrent();
  }

  /** Call after the models' textures changed. */
  invalidate(): void {
    this.shadowDirty = true;
    this.dirty = true;
  }

  get traits(): ProductTraits { return this.slots[0]?.traits ?? {}; }

  /** Static fold / open amounts (when no animation is playing). */
  setManual(p: { fold?: number; open?: number }): void {
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

  private applyLighting(): void {
    const l = resolveLighting(this.lightingOpts);
    this.lighting = l;
    this.lights.apply(l, new Vector3(0, this.span * 0.2, 0), this.span, false, true);
    this.renderer.toneMappingExposure = l.exposure;
    this.scene.environmentIntensity = 0.6 * l.ambient;
    this.applyShadowStrength();
    this.applyBackground();
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
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
    if (this.mode === 'none') return restSample(this.traits, this.manual.fold, this.manual.open);
    return sampleTimeline(this.mode, t, this.getAnimationDuration(), this.traits, this.animOpts.loop !== false);
  }

  private applyAt(t: number, camera: boolean): void {
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
      slot.model.pose({ fold: multi ? 1 : s.fold, open: multi ? 0 : s.open, roll: 0 });
    }
    this.root.updateMatrixWorld(true);
    this.measure(s.cam?.stable ?? false);
    const key = [s.spin, s.tilt, s.lift, s.lying, s.travel, s.fold, s.open].map((v) => v.toFixed(4)).join('|');
    if (key !== this.lastPose) { this.lastPose = key; this.shadowDirty = true; }
    this.sample = s;
    this.dirty = true;
  }

  /** World corners of the content (squared in plan for stable, rotation-proof framing). */
  private measure(stable: boolean): void {
    const box = new Box3();
    for (const s of this.slots) box.expandByObject(s.motion);
    if (box.isEmpty()) box.set(new Vector3(-5, 0, -5), new Vector3(5, 10, 5));
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
    if (this.controls.update()) this.dirty = true;
    if (this.dirty) this.renderNow();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    for (const s of this.slots) s.model.dispose();
    this.slots = [];
    this.contact.dispose();
    this.backdrop.dispose();
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.envTarget.dispose();
    this.pmrem.dispose();
    this.scene.clear();
    this.renderer.dispose();
  }
}
