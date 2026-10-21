/**
 * Guided denoising for path-traced photos. Grain in a path-traced image lives in the lighting, not
 * in the print: the image is divided by a rasterised albedo pass (the artwork at full sharpness),
 * the remaining irradiance is smoothed with an edge-avoiding à-trous wavelet filter steered by
 * normals, depth, albedo and the luminance itself, and the albedo is multiplied back in. Text,
 * barcodes and fine print therefore stay crisp while the soft studio light converges in a fraction
 * of the samples. Transmissive and mirror-like surfaces (glass, ice, droplets, chrome) carry real
 * detail in their "lighting", so they are only touched by the first, finest passes. Isolated
 * speckles (single dark or blown-out samples) are replaced by their neighbourhood first.
 */
import {
  Color, HalfFloatType, MeshBasicMaterial, MeshNormalMaterial, NearestFilter, RGBAFormat, ShaderMaterial, WebGLRenderTarget,
  type Camera, type Material, type Mesh, type MeshPhysicalMaterial, type Scene, type Texture, type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/** Surfaces whose look is mostly what they reflect or let through. */
function isSpecular(m: Material): boolean {
  const p = m as MeshPhysicalMaterial;
  return (p.transmission ?? 0) > 0.05 || ((p.metalness ?? 0) > 0.5 && (p.roughness ?? 1) < 0.45);
}

const ND_VERT = /* glsl */ `
varying vec3 vN;
varying float vZ;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vN = normalize( normalMatrix * normal );
  vZ = - mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const ND_FRAG = /* glsl */ `
uniform float spec;
varying vec3 vN;
varying float vZ;
void main() {
  vec3 n = normalize( vN ) * ( gl_FrontFacing ? 1.0 : - 1.0 );
  // Depth in alpha; its sign flags specular surfaces; 0 = nothing (backdrop colour).
  gl_FragColor = vec4( n, spec > 0.5 ? - vZ : vZ );
}`;

const PASS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

/** mode 0: demodulate (colour / albedo); mode 1: remodulate (filtered × albedo). */
const MOD_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tAlb;
uniform sampler2D tND;
uniform float mode;
varying vec2 vUv;
void main() {
  vec4 c = texture2D( tColor, vUv );
  vec4 nd = texture2D( tND, vUv );
  if ( nd.a <= 0.0 ) { gl_FragColor = c; return; }
  vec3 a = max( texture2D( tAlb, vUv ).rgb, vec3( 0.03 ) );
  gl_FragColor = vec4( mode < 0.5 ? c.rgb / a : c.rgb * a, c.a );
}`;

/**
 * Speckle removal: a pixel far outside the spread of its eight neighbours (an isolated dark or
 * blown-out sample, typical through glass and ice) takes their mean. Edges and one-pixel lines
 * keep their neighbours on both sides, so their spread protects them.
 */
const SPECKLE_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tND;
uniform vec2 texel;
varying vec2 vUv;
float lum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
void main() {
  vec4 cp = texture2D( tColor, vUv );
  vec4 ndp = texture2D( tND, vUv );
  if ( ndp.a == 0.0 ) { gl_FragColor = cp; return; }
  float s = 0.0, s2 = 0.0, n = 0.0;
  vec3 mean = vec3( 0.0 );
  for ( int dy = - 1; dy <= 1; dy ++ ) {
    for ( int dx = - 1; dx <= 1; dx ++ ) {
      if ( dx == 0 && dy == 0 ) continue;
      vec2 uv = vUv + vec2( float( dx ), float( dy ) ) * texel;
      if ( texture2D( tND, uv ).a == 0.0 ) continue;
      vec3 c = texture2D( tColor, uv ).rgb;
      float l = lum( c );
      s += l; s2 += l * l; mean += c; n += 1.0;
    }
  }
  if ( n < 5.0 ) { gl_FragColor = cp; return; }
  float m = s / n;
  float sd = sqrt( max( s2 / n - m * m, 0.0 ) );
  float lp = lum( cp.rgb );
  gl_FragColor = abs( lp - m ) > 3.0 * sd + 0.15 * m + 0.002 ? vec4( mean / n, cp.a ) : cp;
}`;

const ATROUS_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tAlb;
uniform sampler2D tND;
uniform sampler2D tNrm;
uniform vec2 texel;
uniform float stepPx;
uniform float sigmaC;
uniform float specToo;
varying vec2 vUv;
float lum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
void main() {
  vec4 cp = texture2D( tColor, vUv );
  vec4 ndp = texture2D( tND, vUv );
  if ( ndp.a == 0.0 ) { gl_FragColor = cp; return; }
  bool specP = ndp.a < 0.0;
  if ( specP && specToo < 0.5 ) { gl_FragColor = cp; return; }
  float zp = abs( ndp.a );
  // Local depth slope, so tilted planes (the floor) are not mistaken for edges.
  float zx = abs( abs( texture2D( tND, vUv + vec2( texel.x, 0.0 ) ).a ) - zp );
  float zy = abs( abs( texture2D( tND, vUv + vec2( 0.0, texel.y ) ).a ) - zp );
  vec3 ap = texture2D( tAlb, vUv ).rgb;
  vec3 np = texture2D( tNrm, vUv ).xyz * 2.0 - 1.0;
  float lp = lum( cp.rgb );
  float sc = specP ? sigmaC * 0.35 : sigmaC;
  float k[ 3 ];
  k[ 0 ] = 0.375; k[ 1 ] = 0.25; k[ 2 ] = 0.0625;
  vec3 sum = vec3( 0.0 );
  float wsum = 0.0;
  for ( int dy = - 2; dy <= 2; dy ++ ) {
    for ( int dx = - 2; dx <= 2; dx ++ ) {
      vec2 off = vec2( float( dx ), float( dy ) ) * stepPx;
      vec2 uv = vUv + off * texel;
      vec4 nd = texture2D( tND, uv );
      if ( nd.a == 0.0 || ( nd.a < 0.0 ) != specP ) continue;
      vec4 c = texture2D( tColor, uv );
      float w = k[ dx < 0 ? - dx : dx ] * k[ dy < 0 ? - dy : dy ];
      // Shading normals (with the materials' normal maps: crimps, seams, embossing) keep relief.
      w *= pow( max( dot( np, texture2D( tNrm, uv ).xyz * 2.0 - 1.0 ), 0.0 ), 48.0 );
      float tol = 2.5 * ( zx * abs( off.x ) + zy * abs( off.y ) ) + 0.002 * zp;
      w *= exp( - abs( zp - abs( nd.a ) ) / tol );
      vec3 da = ap - texture2D( tAlb, uv ).rgb;
      w *= exp( - dot( da, da ) * 40.0 );
      float l = lum( c.rgb );
      w *= exp( - abs( lp - l ) / ( sc * 0.5 * ( lp + l ) + 0.003 ) );
      sum += c.rgb * w;
      wsum += w;
    }
  }
  gl_FragColor = vec4( wsum > 1e-6 ? sum / wsum : cp.rgb, cp.a );
}`;

function target(w: number, h: number, depth = false): WebGLRenderTarget {
  return new WebGLRenderTarget(w, h, { type: HalfFloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: depth, generateMipmaps: false });
}

/**
 * Albedo, depth (with the specular flag) and shading normals of the scene as the path tracer sees
 * it (same camera, same visible objects), rasterised at the photo's size.
 */
function renderGuides(renderer: WebGLRenderer, scene: Scene, camera: Camera, w: number, h: number): { albedo: WebGLRenderTarget; nd: WebGLRenderTarget; nrm: WebGLRenderTarget } {
  const albedo = target(w, h, true), nd = target(w, h, true), nrm = target(w, h, true);
  const meshes: [Mesh, Material | Material[]][] = [];
  scene.traverseVisible((o) => { if ((o as Mesh).isMesh) meshes.push([o as Mesh, (o as Mesh).material]); });
  const made: Material[] = [];
  // Parts the tracer passes through (hidden caps, fully transparent) draw nothing here either.
  const none = new MeshBasicMaterial({ visible: false });
  made.push(none);
  const gone = (m: Material) => !m.visible || (m.transparent && m.opacity <= 0);
  const toAlbedo = (m: Material): Material => {
    if (gone(m)) return none;
    const p = m as MeshPhysicalMaterial;
    const spec = isSpecular(m);
    const b = new MeshBasicMaterial({
      color: spec || !p.color ? new Color(1, 1, 1) : p.color.clone(),
      map: spec ? null : p.map ?? null,
      alphaMap: p.alphaMap ?? null,
      alphaTest: Math.max(p.alphaTest ?? 0, p.alphaMap || p.alphaHash ? 0.5 : 0),
      side: m.side,
      vertexColors: !!p.vertexColors,
      toneMapped: false,
    });
    made.push(b);
    return b;
  };
  const ndCache = new Map<string, ShaderMaterial>();
  const toNd = (m: Material): Material => {
    if (gone(m)) return none;
    const spec = isSpecular(m) ? 1 : 0;
    const key = `${spec}|${m.side}`;
    let s = ndCache.get(key);
    if (!s) {
      s = new ShaderMaterial({ uniforms: { spec: { value: spec } }, vertexShader: ND_VERT, fragmentShader: ND_FRAG, side: m.side });
      ndCache.set(key, s);
      made.push(s);
    }
    return s;
  };
  const toNrm = (m: Material): Material => {
    if (gone(m)) return none;
    const p = m as MeshPhysicalMaterial;
    const n = new MeshNormalMaterial({ normalMap: p.normalMap ?? null, side: m.side, flatShading: !!p.flatShading });
    if (p.normalMap && p.normalScale) n.normalScale.copy(p.normalScale);
    made.push(n);
    return n;
  };
  const prev = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new Color()), alpha: renderer.getClearAlpha(), bg: scene.background, shadows: renderer.shadowMap.autoUpdate };
  scene.background = null;
  renderer.shadowMap.autoUpdate = false;
  renderer.setClearColor(0x000000, 0);
  try {
    for (const [mesh, m] of meshes) mesh.material = Array.isArray(m) ? m.map(toAlbedo) : toAlbedo(m);
    renderer.setRenderTarget(albedo);
    renderer.clear();
    renderer.render(scene, camera);
    for (const [mesh, m] of meshes) mesh.material = Array.isArray(m) ? m.map(toNd) : toNd(m);
    renderer.setRenderTarget(nd);
    renderer.clear();
    renderer.render(scene, camera);
    for (const [mesh, m] of meshes) mesh.material = Array.isArray(m) ? m.map(toNrm) : toNrm(m);
    renderer.setRenderTarget(nrm);
    renderer.clear();
    renderer.render(scene, camera);
  } finally {
    for (const [mesh, m] of meshes) mesh.material = m;
    scene.background = prev.bg;
    renderer.shadowMap.autoUpdate = prev.shadows;
    renderer.setRenderTarget(prev.target);
    renderer.setClearColor(prev.color, prev.alpha);
    for (const m of made) m.dispose();
  }
  return { albedo, nd, nrm };
}

export interface DenoisedPhoto {
  texture: Texture;
  dispose(): void;
}

/**
 * Denoise the path tracer's linear accumulation `color` (w × h) for the current scene and camera.
 * `strength` scales how far the filter reaches (1 = five à-trous levels, up to ~60 px).
 */
export function denoisePhoto(renderer: WebGLRenderer, scene: Scene, camera: Camera, color: Texture, w: number, h: number, strength = 1): DenoisedPhoto {
  const { albedo, nd, nrm } = renderGuides(renderer, scene, camera, w, h);
  const a = target(w, h), b = target(w, h);
  const mod = new ShaderMaterial({
    uniforms: { tColor: { value: color }, tAlb: { value: albedo.texture }, tND: { value: nd.texture }, mode: { value: 0 } },
    vertexShader: PASS_VERT, fragmentShader: MOD_FRAG, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const atrous = new ShaderMaterial({
    uniforms: {
      tColor: { value: null }, tAlb: { value: albedo.texture }, tND: { value: nd.texture }, tNrm: { value: nrm.texture },
      texel: { value: [1 / w, 1 / h] }, stepPx: { value: 1 }, sigmaC: { value: 1 }, specToo: { value: 1 },
    },
    vertexShader: PASS_VERT, fragmentShader: ATROUS_FRAG, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const speckle = new ShaderMaterial({
    uniforms: { tColor: { value: null }, tND: { value: nd.texture }, texel: { value: [1 / w, 1 / h] } },
    vertexShader: PASS_VERT, fragmentShader: SPECKLE_FRAG, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new FullScreenQuad(mod);
  const prevTarget = renderer.getRenderTarget();
  const prevAuto = renderer.autoClear;
  renderer.autoClear = false;
  try {
    // colour / albedo → a, speckles out → b
    renderer.setRenderTarget(a);
    quad.render(renderer);
    speckle.uniforms.tColor.value = a.texture;
    quad.material = speckle;
    renderer.setRenderTarget(b);
    quad.render(renderer);
    let src = b, dst = a;
    quad.material = atrous;
    const levels = Math.max(1, Math.min(6, Math.round(5 * strength)));
    for (let i = 0; i < levels; i++) {
      atrous.uniforms.tColor.value = src.texture;
      atrous.uniforms.stepPx.value = 1 << i;
      atrous.uniforms.sigmaC.value = 1.1 * Math.pow(0.7, i);
      atrous.uniforms.specToo.value = i < 2 ? 1 : 0;
      renderer.setRenderTarget(dst);
      quad.render(renderer);
      [src, dst] = [dst, src];
    }
    // filtered × albedo → dst
    mod.uniforms.tColor.value = src.texture;
    mod.uniforms.mode.value = 1;
    quad.material = mod;
    renderer.setRenderTarget(dst);
    quad.render(renderer);
    const out = dst, spare = src;
    return {
      texture: out.texture,
      dispose() { out.dispose(); spare.dispose(); },
    };
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    quad.dispose();
    mod.dispose();
    speckle.dispose();
    atrous.dispose();
    albedo.dispose();
    nd.dispose();
    nrm.dispose();
  }
}
