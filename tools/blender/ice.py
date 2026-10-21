"""
Ice for the "Refreshing" set: four irregular rounded ice cubes, a cloudy inner core for each
(fracture planes and a tight cluster of tiny bubbles in the centre), a bed of clear faceted
crushed-ice shards around an empty centre, and the white fracture planes inside the shards.

    Blender -b --python tools/blender/ice.py

Writes public/models/ice.glb. Units: 1 glTF unit = 1 mm. Y up (glTF exporter conversion).
Objects / meshes: ice_cube_0..3, ice_core_0..3 (each centred on its own origin, cores centred
like their cubes), crushed_ice (annulus r 45..160 mm around the origin, resting on y = 0) and
crushed_ice_fractures (internal cleavage planes of ~40 % of the shards, same placement).
No materials are exported; the app assigns transmission and core materials itself.
"""
import bpy
import bmesh
import math
import os
import random

from mathutils import Matrix, Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'models', 'ice.glb')


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 0.001  # display only; 1 BU = 1 mm in the file


def link(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def box_uvs(bm, scale):
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != ax]
        for l in f.loops:
            co = l.vert.co
            l[uv].uv = (co[a] / scale + 0.5, co[b] / scale + 0.5)


def ice_cube(seed):
    rnd = random.Random(seed)
    size = rnd.uniform(26, 30)
    S = Vector((size * rnd.uniform(0.95, 1.05), size * rnd.uniform(0.9, 1.0), size * rnd.uniform(0.95, 1.05))) / 2
    r = rnd.uniform(3.2, 4.2)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=13, use_grid_fill=True)
    off = Vector((rnd.uniform(0, 100), rnd.uniform(0, 100), rnd.uniform(0, 100)))
    dimples = []
    for _ in range(rnd.randint(2, 4)):
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
        ax = max(range(3), key=lambda i: abs(d[i]))
        d[ax] = math.copysign(1.0, d[ax])
        dimples.append((Vector((d.x * S.x, d.y * S.y, d.z * S.z)), rnd.uniform(4.0, 7.0), rnd.uniform(0.25, 0.55)))
    for v in bm.verts:
        p = Vector((v.co.x * S.x, v.co.y * S.y, v.co.z * S.z))
        inner = Vector((S.x - r, S.y - r, S.z - r))
        c = Vector((max(-inner.x, min(inner.x, p.x)), max(-inner.y, min(inner.y, p.y)), max(-inner.z, min(inner.z, p.z))))
        n = p - c
        if n.length > 1e-6:
            p = c + n.normalized() * r
            nrm = n.normalized()
        else:
            nrm = Vector((0, 0, 1))
        # Melting: the top (Blender +Z) slightly smaller and softer than the bottom.
        t = (p.z / S.z + 1) / 2
        p.x *= 1 - 0.035 * t
        p.y *= 1 - 0.035 * t
        # Gentle irregularity along the surface normal.
        q = p * 0.11 + off
        p += nrm * (noise.noise(q) * 0.3 + noise.noise(q * 4.3) * 0.06)
        for (dc, rad, depth) in dimples:
            dd = (p - dc).length
            if dd < rad:
                p -= nrm * depth * (1 - (dd / rad) ** 2) ** 2
        v.co = p
    bm.normal_update()
    box_uvs(bm, size)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    return bm, size


def ice_core(seed, size):
    """Frozen-in air, strictly in the centre (within ~35 % of the cube): a few irregular fracture
    planes and a tight cluster of tiny bubbles."""
    rnd = random.Random(seed * 7 + 3)
    bm = bmesh.new()
    R = size * 0.15  # radius of the core region
    for _ in range(rnd.randint(34, 52)):
        rad = rnd.uniform(0.12, 0.45)
        d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized() * (R * 0.85 * rnd.random() ** 0.7)
        rot = Matrix.Rotation(rnd.uniform(0, math.pi), 4, Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized())
        sc = Matrix.Diagonal(Vector((rad, rad * rnd.uniform(0.6, 1.0), rad, 1)))
        bmesh.ops.create_icosphere(bm, subdivisions=1, diameter=1.0, matrix=Matrix.Translation(d) @ rot @ sc, calc_uvs=False)
    # Fracture planes: thin irregular sheets through the centre.
    for _ in range(rnd.randint(2, 4)):
        n = 11
        rad = rnd.uniform(R * 0.6, R * 1.0)
        rot = Matrix.Rotation(rnd.uniform(0, math.pi), 3, Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized())
        centre = Vector((rnd.gauss(0, R * 0.2), rnd.gauss(0, R * 0.2), rnd.gauss(0, R * 0.2)))
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n
            rr = rad * rnd.uniform(0.45, 1.0)
            ring.append(bm.verts.new(centre + rot @ Vector((math.cos(a) * rr, math.sin(a) * rr, rnd.uniform(-0.15, 0.15)))))
        mid = bm.verts.new(centre)
        for i in range(n):
            bm.faces.new((mid, ring[i], ring[(i + 1) % n]))
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for l in f.loops:
            l[uv].uv = (l.vert.co.x / size + 0.5, l.vert.co.z / size + 0.5)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    return bm


def shard(rnd, size):
    """A convex, faceted shard: the hull of a few random points in a (sometimes elongated) blob."""
    tmp = bmesh.new()
    k = rnd.randint(9, 13)
    stretch = Vector((1.0, 1.0, 1.0))
    if rnd.random() < 0.35:
        stretch[rnd.randrange(3)] = rnd.uniform(1.5, 2.2)
    pts = []
    for _ in range(k):
        d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized() * rnd.uniform(0.78, 1.0)
        pts.append(tmp.verts.new(Vector((d.x * stretch.x, d.y * stretch.y, d.z * stretch.z)) * (size / 2) / max(stretch)))
    res = bmesh.ops.convex_hull(tmp, input=pts)
    junk = list({g for g in res['geom_interior'] + res['geom_unused'] if isinstance(g, bmesh.types.BMVert)})
    if junk:
        bmesh.ops.delete(tmp, geom=junk, context='VERTS')
    # Hull triangles that lie in one plane become one facet.
    bmesh.ops.dissolve_limit(tmp, angle_limit=math.radians(2), verts=tmp.verts[:], edges=tmp.edges[:])
    return tmp


def crushed_bed(seed=11):
    rnd = random.Random(seed)
    bm = bmesh.new()
    frac = bmesh.new()
    r_in, r_out = 45.0, 160.0
    cell = 2.0
    G = int(2 * r_out / cell) + 2
    hmap = [[0.0] * G for _ in range(G)]

    def target(r):
        t = (r - r_in) / (r_out - r_in)
        return 4.0 + 24.0 * (1 - t) ** 1.6

    def cells(x, y, rad):
        i0, i1 = int((x - rad + r_out) / cell), int((x + rad + r_out) / cell)
        j0, j1 = int((y - rad + r_out) / cell), int((y + rad + r_out) / cell)
        for i in range(max(0, i0), min(G, i1 + 1)):
            for j in range(max(0, j0), min(G, j1 + 1)):
                cx, cy = i * cell - r_out, j * cell - r_out
                if (cx - x) ** 2 + (cy - y) ** 2 <= rad * rad:
                    yield i, j

    placed = 0
    tries = 0
    nfrac = 0
    while placed < 600 and tries < 90000:
        tries += 1
        r = r_in + 1 + (r_out - r_in - 3) * (rnd.random() ** 1.6)
        a = rnd.uniform(0, 2 * math.pi)
        x, y = r * math.cos(a), r * math.sin(a)
        t = (r - r_in) / (r_out - r_in)
        size = rnd.uniform(8, 17) * (1 - 0.35 * t) if rnd.random() < 0.65 else rnd.uniform(4, 8)
        rad = size * 0.5
        foot = list(cells(x, y, rad * 0.75))
        if not foot:
            continue
        base = max(hmap[i][j] for i, j in foot)
        if base + size * 0.45 > target(r):
            continue
        z = base + size * 0.35
        rot = Matrix.Rotation(rnd.uniform(0, math.pi), 4, Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized())
        M = Matrix.Translation(Vector((x, y, z))) @ rot
        tmp = shard(rnd, size)
        vmap = {}
        for v in tmp.verts:
            co = M @ v.co
            if co.z < 0:
                co.z *= 0.15  # rest on the floor
            vmap[v] = bm.verts.new(co)
        for f in tmp.faces:
            try:
                bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                pass
        # Cleavage planes inside ~40 % of the shards, kept well inside the hull.
        if rnd.random() < 0.4:
            cen = sum((v.co for v in tmp.verts), Vector()) / max(1, len(tmp.verts))
            inr = min((v.co - cen).length for v in tmp.verts)
            for _ in range(rnd.randint(1, 3)):
                n = 7
                prot = Matrix.Rotation(rnd.uniform(0, math.pi), 3, Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized())
                c0 = cen + Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))) * inr * 0.12
                ring = []
                for i in range(n):
                    aa = 2 * math.pi * i / n
                    rr = inr * rnd.uniform(0.45, 0.8)
                    ring.append(frac.verts.new(M @ (c0 + prot @ Vector((math.cos(aa) * rr, math.sin(aa) * rr, 0)))))
                mid = frac.verts.new(M @ c0)
                for i in range(n):
                    frac.faces.new((mid, ring[i], ring[(i + 1) % n]))
            nfrac += 1
        tmp.free()
        top = base + size * 0.7
        for i, j in foot:
            hmap[i][j] = max(hmap[i][j], top)
        placed += 1
    for b in (bm, frac):
        uv = b.loops.layers.uv.new('UVMap')
        for f in b.faces:
            for l in f.loops:
                l[uv].uv = (l.vert.co.x / 40.0, l.vert.co.y / 40.0)
        bmesh.ops.triangulate(b, faces=b.faces[:])
    print('crushed shards', placed, 'with fractures', nfrac)
    return bm, frac


def main():
    clear()
    objs = []
    for i in range(4):
        bm, size = ice_cube(100 + i)
        objs.append(link(f'ice_cube_{i}', bm))
        objs.append(link(f'ice_core_{i}', ice_core(100 + i, size)))
    bed_bm, frac_bm = crushed_bed()
    bed = link('crushed_ice', bed_bm)
    # Faceted: sharp facets, only near-flat neighbours shade smoothly.
    bed.data.use_auto_smooth = True
    bed.data.auto_smooth_angle = math.radians(20)
    objs.append(bed)
    objs.append(link('crushed_ice_fractures', frac_bm))
    for ob in objs:
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        print(ob.name, 'tris', tris)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_normals=True,
                              export_texcoords=True, export_materials='NONE', export_yup=True, export_cameras=False, export_lights=False)
    print('wrote', OUT, os.path.getsize(OUT))


main()
