"""
Cloth-simulated garments for the Branding Studio mockups: a T-shirt, a hoodie and a tote bag.

Each is sewn from two layers cut from the app's own flat pattern (tools/blender/data/
garments_M.json, size M), inflated with Blender's cloth solver (pressure + mild gravity, the
shoulders or the bag's top hem pinned) and exported as one mesh "garment" with two material
slots, "front" and "back".

    Blender -b --python tools/blender/cloth.py -- tee|hoodie|tote [--frames N] [--preview out_dir]

Output contract (three.js after the glTF exporter's Y-up conversion; 1 unit = 1 mm):
  x = pattern x (viewer's right in the front view, x = 0 the centre line)
  y = up, the rest pattern's shoulder/neck high point at y = 0 (y = -gy); tote: bottom at 0, top hem 420
  z = toward the viewer for the front layer
  TEXCOORD_0 = rest pattern position in front-view coordinates for BOTH layers:
      u = (gx - X0) / W, v = 1 - (gy - Y0) / H   (garments; box in data/<name>.uvbox.json)
      u = (x + 190) / 380, v = 1 - gy / 420     (tote; gy measured down from the top hem)
"""
import bpy
import bmesh
import json
import math
import os
import random
import sys

from mathutils import Vector, geometry

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
DATA = os.path.join(HERE, 'data')
OUT = os.path.join(ROOT, 'public', 'models')
MM = 0.001  # simulate in metres (gravity and pressure behave physically), export in mm


# --------------------------------------------------------------------------- geometry helpers

def resample(chain, step):
    """Points along an open polyline every ~step (mm), both ends included."""
    out = [chain[0]]
    for a, b in zip(chain, chain[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, round(L / step))
        for k in range(1, n + 1):
            t = k / n
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def inside(poly, x, y):
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def seg_dist(px, py, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(px - a[0] - t * dx, py - a[1] - t * dy)


def edge_dist(poly, x, y):
    return min(seg_dist(x, y, poly[i - 1], poly[i]) for i in range(len(poly)))


def interior_points(poly, step, seed=0):
    """Jittered hexagonal grid inside a polygon, away from its edges."""
    rnd = random.Random(seed)
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    pts = []
    dy = step * math.sqrt(3) / 2
    row = 0
    y = min(ys) + dy * 0.5
    while y < max(ys):
        x = min(xs) + (step / 2 if row % 2 else 0)
        while x < max(xs):
            jx, jy = x + rnd.uniform(-0.12, 0.12) * step, y + rnd.uniform(-0.12, 0.12) * step
            if inside(poly, jx, jy) and edge_dist(poly, jx, jy) > step * 0.62:
                pts.append((jx, jy))
            x += step
        y += dy
        row += 1
    return pts


def triangulate(boundary, interior):
    """Constrained Delaunay inside `boundary` (a closed loop of 2D points)."""
    verts = [Vector((p[0], p[1])) for p in boundary + interior]
    n = len(boundary)
    edges = [(i, (i + 1) % n) for i in range(n)]
    res = geometry.delaunay_2d_cdt(verts, edges, [list(range(n))], 1, 1e-4)
    out_verts, _, faces, orig_verts = res[0], res[1], res[2], res[3]
    remap = []
    for i, ov in enumerate(orig_verts):
        remap.append(ov[0] if ov else None)
    tris = []
    for f in faces:
        ids = [remap[i] for i in f]
        if None in ids:
            raise RuntimeError('triangulation created a new vertex; boundary self-intersects?')
        tris.append(ids)
    return tris


# --------------------------------------------------------------------------- colliders

def ring_mesh(name, rings, cap=True):
    """A tube from rings of 3D points (metres); optional end caps. Returns the object."""
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for a, b in zip(vs, vs[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    if cap:
        bm.faces.new(vs[0][::-1])
        bm.faces.new(vs[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def collider(ob, grow_frames, friction=None):
    """Collision object that grows from a sliver to full depth (blender Y) over grow_frames."""
    mod = ob.modifiers.new('Collision', 'COLLISION')
    ob.collision.thickness_outer = 0.0012
    ob.collision.thickness_inner = 0.05
    ob.collision.cloth_friction = friction if friction is not None else float(os.environ.get('FRICTION', 0.1))
    ob.collision.damping = 0.4
    ob.scale = (1, 0.004, 1)
    ob.keyframe_insert('scale', frame=1)
    ob.scale = (1, 1, 1)
    ob.keyframe_insert('scale', frame=grow_frames)
    ob.hide_render = True
    return mod


def torso_collider(cw, length, depth, neck, shoulder):
    """Ghost-mannequin torso sized to the flat pattern: the top follows the shoulder line from the
    neck to the shoulder point, then the chest at ~95 % of the pattern's half width with a flat-ish
    elliptic section (the cloth's circumference wraps it with a little ease, so the garment keeps
    its flat width), running a little past the hem so the hem hangs instead of riding up."""
    sx, sy = shoulder
    sm = lambda t: (lambda u: u * u * (3 - 2 * u))(max(0.0, min(1.0, t)))
    rings = []
    n = 44
    stations = [2, 6, 12, 18, sy, sy + 14, sy + 32, 70, 100, 140, 200, 300, 420, 540, length - 90, length - 45]
    for gy in sorted(set(stations)):
        if gy <= sy:
            a = neck * 0.95 + (sx * SHOULDER_FIT - neck * 0.95) * sm(gy / sy)
        else:
            a = sx * SHOULDER_FIT + (cw * CHEST_FIT - sx * SHOULDER_FIT) * sm((gy - sy) / 46.0)
        b = 9.0 + (depth / 2 - 9.0) * sm(gy / 80.0)
        rings.append([(a * math.cos(2 * math.pi * i / n) * MM, b * math.sin(2 * math.pi * i / n) * MM, -gy * MM) for i in range(n)])
    return ring_mesh('torso', rings)


def arm_collider(name, sleeve_poly, back=60.0, beyond=120.0, fill=0.25, mirror=False, drop=0.0, frames=(20, 34)):
    """An arm inside the sleeve: at each station along the sleeve axis the ring is centred
    between the sleeve's top and under seams and sized to the flat sleeve width (a tube of
    flat width w has radius w / pi; fill 0.3 leaves a little ease). It then swings down by
    `drop` degrees about the armhole, taking the sleeve with it (a relaxed ghost-mannequin arm)."""
    sh, outer, inner, under = [(p[0] * (-1 if mirror else 1), p[1]) for p in sleeve_poly]

    def lerp(a, b, t):
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

    pivot = lerp(sh, under, 0.5)
    rings = []
    n = 28
    stations = [-back / 300.0, 0.0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.0 + beyond / 500.0]
    for t in stations:
        tc = max(0.0, min(1.0, t))
        top, bot = lerp(sh, outer, tc), lerp(under, inner, tc)
        c = lerp(top, bot, 0.5)
        ax = (lerp(outer, inner, 0.5)[0] - lerp(sh, under, 0.5)[0], lerp(outer, inner, 0.5)[1] - lerp(sh, under, 0.5)[1])
        L = math.hypot(*ax)
        ux, uy = ax[0] / L, ax[1] / L
        # The sleeve's width across its axis (the seam-to-seam diagonal overstates it at the armhole).
        w = abs((top[0] - bot[0]) * uy - (top[1] - bot[1]) * ux)
        if t < 0:
            c = (c[0] + ux * t * 300.0, c[1] + uy * t * 300.0)
        elif t > 1:
            c = (c[0] + ux * (t - 1) * 500.0, c[1] + uy * (t - 1) * 500.0)
        r = fill * w
        px, py = uy, -ux  # across the sleeve, in plane
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n
            gx, gy = c[0] + px * r * math.cos(a), c[1] + py * r * math.cos(a)
            ring.append(((gx - pivot[0]) * MM, r * math.sin(a) * MM, -(gy - pivot[1]) * MM))
        rings.append(ring)
    ob = ring_mesh(name, rings)
    ob.location = (pivot[0] * MM, 0, -pivot[1] * MM)
    if drop:
        ob.rotation_euler = (0, 0, 0)
        ob.keyframe_insert('rotation_euler', frame=frames[0])
        ob.rotation_euler = (0, math.radians(-drop if mirror else drop), 0)
        ob.keyframe_insert('rotation_euler', frame=frames[1])
    return ob


def head_collider(neck):
    """A head-sized ellipsoid behind and above the neck that fills the hood."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, diameter=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.082, v.co.y * 0.09 + 0.012, v.co.z * 0.11 + 0.105))
    me = bpy.data.meshes.new('head')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('head', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# --------------------------------------------------------------------------- garment build

class Sewn:
    """Two (or more) layers sharing seam vertices; rest pattern coordinates kept for the UVs."""

    def __init__(self):
        self.bm = bmesh.new()
        self.rest = {}  # BMVert -> (gx, gy)
        self.shared = {}  # rounded (gx, gy) -> BMVert (seam vertices)
        self.pins = set()

    def vert(self, gx, gy, depth=0.0, key=None):
        if key is not None and key in self.shared:
            return self.shared[key]
        v = self.bm.verts.new((gx * MM, depth * MM, -gy * MM))
        self.rest[v] = (gx, gy)
        if key is not None:
            self.shared[key] = v
        return v

    def layer(self, chains, step, side, material, seed, bulge=8.0, poly_override=None):
        """chains: list of (points, shared) forming the closed outline in order. side -1 = front (toward -Y = viewer)."""
        boundary, kinds = [], []
        for pts, shared in chains:
            pts = resample(pts, step)
            for i, p in enumerate(pts[:-1]):
                boundary.append(p)
                # Chain ends are always shared (they are seam corners).
                kinds.append(shared or i == 0)
        poly = poly_override or boundary
        interior = interior_points(poly, step, seed)
        tris = triangulate(boundary, interior)
        verts = []
        for i, p in enumerate(boundary):
            key = (round(p[0], 3), round(p[1], 3))
            # Open edges (hem, cuffs, neckline) start off the mid-plane with their layer, so the
            # growing forms push them out with the rest instead of pinching them.
            verts.append(self.vert(p[0], p[1], 0.0 if kinds[i] else side * bulge, key if kinds[i] else None))
        for p in interior:
            d = edge_dist(poly, p[0], p[1])
            # Start the layers apart (the colliders grow out of the gap between them).
            verts.append(self.vert(p[0], p[1], side * bulge * min(1.0, d / 25.0)))
        self.last = verts
        for t in tris:
            a, b, c = verts[t[0]], verts[t[1]], verts[t[2]]
            if len({a, b, c}) < 3:
                continue
            try:
                f = self.bm.faces.new((a, b, c))
            except ValueError:
                continue
            f.material_index = material
            # Orient: front faces look toward -Y (the viewer), back faces toward +Y.
            n = (b.co - a.co).cross(c.co - a.co)
            if n.y * side < 0:
                f.normal_flip()
        return boundary


def chains_for(poly, nw_idx_neck_start=13):
    """Split the app's 29-point garment outline into its seams and openings."""
    P = [(p['x'], p['y']) for p in poly]
    return {
        'seam_r': [P[0], P[1], P[2]],       # neck point -> shoulder -> outer cuff
        'cuff_r': [P[2], P[3]],
        'side_r': [P[3], P[4], P[5]],       # inner cuff -> underarm -> hem
        'hem': [P[5], P[6], P[7], P[8]],
        'side_l': [P[8], P[9], P[10]],
        'cuff_l': [P[10], P[11]],
        'seam_l': [P[11], P[12], P[13]],
        'neck': [P[13]] + P[14:] + [P[0]],
    }


def build_garment(kind, step):
    g = json.load(open(os.path.join(DATA, 'garments_M.json')))[kind]
    F = chains_for(g['front'])
    B = chains_for(g['back'])
    s = Sewn()
    front_chain = [(F['seam_r'], True), (F['cuff_r'], False), (F['side_r'], True), (F['hem'], False), (F['side_l'], True), (F['cuff_l'], False), (F['seam_l'], True), (F['neck'], False)]
    s.layer(front_chain, step, -1, 0, 1)
    if kind == 'hoodie':
        hood = [(p['x'], p['y']) for p in g['hood']]
        arc = hood[1:-1]  # (-133,-20) over the head to (133,-20)
        nl = B['seam_l'][-1]  # (-nw, 0)
        nr = B['seam_r'][0]   # (nw, 0)
        back_neck = [nl] + arc + [nr]
        back_chain = [(B['seam_r'], True), (B['cuff_r'], False), (B['side_r'], True), (B['hem'], False), (B['side_l'], True), (B['cuff_l'], False), (B['seam_l'], True), (list(reversed(back_neck)) if False else back_neck, True)]
        # Back + hood (one layer); the hood arc is a seam shared with the hood lining.
        s.layer(back_chain, step, +1, 1, 2)
        # Hood lining: the inside of the hood, sewn to the back along the arc, open along the face.
        lining_chain = [(arc, True), ([arc[-1], arc[0]], False)]
        s.layer(lining_chain, step, -1, 1, 3, bulge=10.0)
        # Hood DOWN: fold everything above the neck line back over the shoulders, so it drapes
        # down the back with its opening showing instead of standing up like a head.
        phi = math.radians(float(os.environ.get('HOOD_FOLD', 100)))
        for v, (gx, gy) in s.rest.items():
            if gy < 0:
                y, z = v.co.y, v.co.z
                v.co.y = y * math.cos(phi) + z * math.sin(phi)
                v.co.z = -y * math.sin(phi) + z * math.cos(phi)
    else:
        back_chain = [(B['seam_r'], True), (B['cuff_r'], False), (B['side_r'], True), (B['hem'], False), (B['side_l'], True), (B['cuff_l'], False), (B['seam_l'], True), (B['neck'], False)]
        s.layer(back_chain, step, +1, 1, 2)
    # Pin the shoulder seams between the neck and the shoulder points (an invisible form).
    shoulder = resample([F['seam_r'][0], F['seam_r'][1]], step) + resample([F['seam_l'][1], F['seam_l'][2]], step)
    for p in shoulder:
        key = (round(p[0], 3), round(p[1], 3))
        if key in s.shared:
            s.pins.add(s.shared[key])
    allpts = [(p['x'], p['y']) for p in g['front']] + ([(p['x'], p['y']) for p in g['hood']] if kind == 'hoodie' else [])
    X0, X1 = min(p[0] for p in allpts) - 6, max(p[0] for p in allpts) + 6
    Y0, Y1 = min(p[1] for p in allpts) - 6, max(p[1] for p in allpts) + 6
    box = {'X0': X0, 'Y0': Y0, 'W': X1 - X0, 'H': Y1 - Y0}
    uvf = lambda gx, gy: ((gx - box['X0']) / box['W'], 1 - (gy - box['Y0']) / box['H'])

    def colliders():
        sp = [(p['x'], p['y']) for p in g['sleevePoly']]  # shoulder, outer cuff, inner cuff, underarm
        depth = float(os.environ.get('DEPTH', 92.0 if kind == 'tee' else 96.0))
        obs = [torso_collider(g['chest'], g['length'], depth, g['neckW'], sp[0])]
        if ARMS.get(kind, True):
            drop = DROP[kind]
            obs.append(arm_collider('arm_r', sp, fill=0.3, drop=drop))
            obs.append(arm_collider('arm_l', sp, fill=0.3, mirror=True, drop=drop))
        return obs

    return s, box, uvf, colliders


def build_tote(step):
    W, H = 380.0, 420.0
    s = Sewn()
    L, R = -W / 2, W / 2
    # gy measured downward from the top hem (0 .. 420).
    chain = [([(R, 0), (R, H)], True), ([(R, H), (L, H)], True), ([(L, H), (L, 0)], True), ([(L, 0), (R, 0)], False)]
    shared = set()
    for side, mat, seed in ((-1, 0, 1), (+1, 1, 2)):
        s.layer(chain, step, side, mat, seed, bulge=6.0)
        # Open the mouth a little: this layer's own top-hem vertices start apart.
        for v in s.last:
            gx, gy = s.rest[v]
            if gy < 1e-6 and v not in s.shared.values():
                v.co.y = side * 7 * MM
    # Held by the handles: pin the top hem only around the four strap ends (x = ±95 mm).
    for v, (gx, gy) in s.rest.items():
        if gy < 1e-6 and min(abs(gx - 95), abs(gx + 95)) < 22:
            s.pins.add(v)
    box = {'X0': L, 'Y0': 0.0, 'W': W, 'H': H}
    uvf = lambda gx, gy: ((gx + 190) / 380, 1 - gy / 420)
    return s, box, uvf, lambda: []


# --------------------------------------------------------------------------- simulation

def make_object(s, uvf, name='garment'):
    bm = s.bm
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for l in f.loops:
            gx, gy = s.rest[l.vert]
            l[uv].uv = uvf(gx, gy)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-7)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    pins = [v.index for v in bm.verts if v in s.pins]
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    for nm in ('front', 'back'):
        m = bpy.data.materials.new(nm)
        me.materials.append(m)
    vg = ob.vertex_groups.new(name='pin')
    vg.add(pins, 1.0, 'REPLACE')
    # Hems, cuffs and the neckband are double-stitched: stiffer to bend near the free edges.
    bm2 = bmesh.new()
    bm2.from_mesh(me)
    edge = set(v for v in bm2.verts if v.is_boundary)
    ring = set(edge)
    for _ in range(2):
        ring |= set(e.other_vert(v) for v in list(ring) for e in v.link_edges)
    hem = ob.vertex_groups.new(name='hem')
    hem.add([v.index for v in ring], 1.0, 'REPLACE')
    bm2.free()
    return ob


def simulate(ob, frames, pressure, gravity, bending, mass=0.25, gravity_delay=True):
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, frames
    mod = ob.modifiers.new('Cloth', 'CLOTH')
    cs = mod.settings
    cs.quality = 10
    cs.mass = mass
    cs.air_damping = 2.0
    cs.tension_stiffness = 20
    cs.compression_stiffness = 20
    cs.shear_stiffness = 8
    cs.bending_stiffness = bending
    cs.vertex_group_bending = 'hem'
    cs.bending_stiffness_max = 12.0
    cs.tension_damping = 5
    cs.compression_damping = 5
    cs.shear_damping = 5
    cs.bending_damping = 0.5
    cs.use_pressure = True
    cs.uniform_pressure_force = pressure
    cs.pressure_factor = 1.0
    # No gravity while the form grows inside the garment (the sleeves would swing off the arms),
    # then let it settle.
    if gravity_delay:
        cs.effector_weights.gravity = 0.0
        cs.effector_weights.keyframe_insert('gravity', frame=1)
        cs.effector_weights.keyframe_insert('gravity', frame=26)
        cs.effector_weights.gravity = gravity
        cs.effector_weights.keyframe_insert('gravity', frame=36)
    else:
        cs.effector_weights.gravity = gravity
    cs.vertex_group_mass = 'pin'
    cs.pin_stiffness = 1.0
    co = mod.collision_settings
    co.use_collision = True
    co.distance_min = 0.0015
    co.use_self_collision = True
    co.self_distance_min = 0.0018
    co.self_friction = 5
    co.collision_quality = 4
    mod.point_cache.frame_start = 1
    mod.point_cache.frame_end = frames
    for f in range(1, frames + 1):
        sc.frame_set(f)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def smooth_open_edges(ob, rings=4, iterations=14):
    """Relax the ragged free edges (hem, cuffs, neck, face opening) the solver leaves crumpled."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    band = set(v for v in bm.verts if v.is_boundary)
    frontier = set(band)
    for _ in range(rings):
        nxt = set()
        for v in frontier:
            for e in v.link_edges:
                o = e.other_vert(v)
                if o not in band:
                    nxt.add(o)
        band |= nxt
        frontier = nxt
    for _ in range(iterations):
        new = {}
        for v in band:
            ns = [e.other_vert(v) for e in v.link_edges]
            if v.is_boundary:
                ns = [o for o in ns if o.is_boundary]  # slide along the edge, keep the outline
            if not ns:
                continue
            avg = sum((o.co for o in ns), Vector()) / len(ns)
            new[v] = v.co.lerp(avg, 0.5)
        for v, c in new.items():
            v.co = c
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def measure(ob, band, rest=None):
    """Front-to-back depth in mm within a band of rest heights (three y = -gy)."""
    me = ob.data
    if rest is not None:
        uv = me.uv_layers.active.data
        hem = []
        for poly in me.polygons:
            for li in poly.loop_indices:
                if uv[li].uv[1] < 0.03:
                    hem.append(me.vertices[me.loops[li].vertex_index].co.z / MM)
        print('hem avg z', sum(hem) / max(1, len(hem)), 'n', len(hem))
    ys = [v.co.y / MM for v in me.vertices if band[0] <= -v.co.z / MM <= band[1]]
    xs = [v.co.x / MM for v in me.vertices]
    zs = [v.co.z / MM for v in me.vertices]
    return {'depth': (max(ys) - min(ys)) if ys else 0, 'width': max(xs) - min(xs), 'top': max(zs), 'bottom': min(zs)}


def measure_pattern(ob, box, cw, length):
    """Chest width (body only, rest gy 180–320) and the hem's height, read through the UVs."""
    me = ob.data
    uv = me.uv_layers.active.data
    rest = {}
    for poly in me.polygons:
        for li in poly.loop_indices:
            u, v = uv[li].uv
            rest[me.loops[li].vertex_index] = (box['X0'] + u * box['W'], box['Y0'] + (1 - v) * box['H'])
    chest = [me.vertices[i].co.x / MM for i, (gx, gy) in rest.items() if abs(gx) < cw * 0.98 and 180 <= gy <= 320]
    hem = [me.vertices[i].co.z / MM for i, (gx, gy) in rest.items() if gy > length - 6 and abs(gx) < cw]
    deep = [me.vertices[i].co.y / MM for i, (gx, gy) in rest.items() if abs(gx) < cw * 0.5 and 180 <= gy <= 320]
    out = {
        'chest_width': round(max(chest) - min(chest), 1) if chest else None, 'pattern_chest': 2 * cw,
        'hem_y': round(sum(hem) / len(hem), 1) if hem else None, 'pattern_hem': -length,
        'chest_depth': round(max(deep) - min(deep), 1) if deep else None,
        'overall_width': round((max(v.co.x for v in me.vertices) - min(v.co.x for v in me.vertices)) / MM, 1),
        'top_y': round(max(v.co.z for v in me.vertices) / MM, 1),
    }
    return out


def finish_and_export(ob, name, box, max_tris):
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris > max_tris:
        dec = ob.modifiers.new('Decimate', 'DECIMATE')
        dec.ratio = max_tris / tris * 0.98
        dec.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=dec.name)
    # Back to millimetres.
    ob.scale = (1 / MM, 1 / MM, 1 / MM)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob['uvbox'] = json.dumps(box)
    bpy.context.scene['uvbox'] = json.dumps(box)
    with open(os.path.join(DATA, f'{name}.uvbox.json'), 'w') as f:
        json.dump(box, f, indent=1)
    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_normals=True,
                              export_texcoords=True, export_materials='EXPORT', export_yup=True, export_extras=True,
                              export_cameras=False, export_lights=False)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print(f'[{name}] wrote {path} {os.path.getsize(path)} bytes, {tris} tris, box {box}')
    return path


# The torso's half width as a share of the pattern's: with a body-deep section the cloth's fixed
# circumference wraps a narrower front, as on a real ghost mannequin (0.95 + a flat section keeps
# the flat-lay width instead).
CHEST_FIT = float(os.environ.get('CHEST_FIT', 0.95))
# The form's shoulder point as a share of the pattern's: a little inside rounds the shoulder.
SHOULDER_FIT = float(os.environ.get('SHOULDER_FIT', 0.97))
# Long, steep hoodie sleeves are filled by pressure (arm forms poke through them); tee sleeves
# hang on short arm forms.
ARMS = {'tee': True, 'hoodie': os.environ.get('ARMS', '1') == '1'}
PRESSURE = {'tee': float(os.environ.get('PRESSURE', 0.0)), 'hoodie': float(os.environ.get('PRESSURE', 0.0))}
# Sleeves swing down from the flat pattern's angle to a relaxed ghost-mannequin pose:
# tee 32° → ~46° below horizontal (~44° from vertical); hoodie 66° → ~72° (18° from vertical).
DROP = {'tee': float(os.environ.get('DROP', 14)), 'hoodie': float(os.environ.get('DROP', 6))}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    name = argv[0] if argv else 'tee'
    frames = int(argv[argv.index('--frames') + 1]) if '--frames' in argv else (50 if name == 'tote' else 70)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.gravity = (0, 0, -9.81)
    if name == 'tote':
        s, box, uvf, make_colliders = build_tote(step=7.0)
        ob = make_object(s, uvf)
        simulate(ob, frames, pressure=float(os.environ.get('PRESSURE', 5.0)), gravity=float(os.environ.get('GRAVITY', 1.0)), bending=0.6, mass=0.2)
        smooth_open_edges(ob, rings=2, iterations=6)
        m = measure(ob, (200, 300))
        # Contract: bottom of the rest pattern at y = 0, top hem at y = 420.
        for v in ob.data.vertices:
            v.co.z += 420 * MM
    else:
        s, box, uvf, make_colliders = build_garment(name, step=8.0)
        ob = make_object(s, uvf)
        cols = [] if os.environ.get('NOCOL') else make_colliders()
        for c in cols:
            # Sleeves hang on the arms: grip there, slide freely on the torso.
            collider(c, 18 if name == 'tee' else 24, friction=2.5 if c.name.startswith("arm") else None)
        simulate(ob, frames, pressure=PRESSURE.get(name, 1.5), gravity=float(os.environ.get('GRAVITY', 1.6)), bending=0.3 if name == 'tee' else 0.8, gravity_delay=True)
        for c in cols:
            if os.environ.get('DEBUG'):
                bb = [c.matrix_world @ Vector(b) for b in c.bound_box]
                print('collider', c.name, 'x', round(min(v.x for v in bb) / MM), round(max(v.x for v in bb) / MM), 'y', round(min(v.y for v in bb) / MM), round(max(v.y for v in bb) / MM), 'z', round(min(v.z for v in bb) / MM), round(max(v.z for v in bb) / MM))
        if os.environ.get('DEBUG'):
            uv = ob.data.uv_layers.active.data
            cuff = [ob.data.vertices[ob.data.loops[li].vertex_index].co for poly in ob.data.polygons for li in poly.loop_indices if uv[li].uv[0] > 0.93]
            print('cuff-ish verts', len(cuff), 'x', round(min(v.x for v in cuff) / MM), round(max(v.x for v in cuff) / MM), 'z', round(min(v.z for v in cuff) / MM), round(max(v.z for v in cuff) / MM))
            bpy.ops.wm.save_as_mainfile(filepath='/tmp/cloth_debug.blend'.replace('/tmp', os.environ['DEBUG']))
        for c in cols:
            bpy.data.objects.remove(c, do_unlink=True)
        smooth_open_edges(ob, rings=6, iterations=28)
        g = json.load(open(os.path.join(DATA, 'garments_M.json')))[name]
        m = measure_pattern(ob, box, g['chest'], g['length'])
    print(f'[{name}] measure {m}')
    os.makedirs(OUT, exist_ok=True)
    finish_and_export(ob, name, box, 25000)


main()
