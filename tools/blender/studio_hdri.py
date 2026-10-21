"""
Studio HDRIs for the Branding Studio 3D mockups.

Renders an emissive studio (softboxes, strip lights, a seamless floor) from an equirectangular
panoramic camera at the origin with Cycles and writes Radiance .hdr files to public/env/, plus
public/env/manifest.json with the measured key-light direction of each preset.

    /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/blender/studio_hdri.py -- [preset ...]

Presets: studio-soft, studio-strip, daylight (default: all three).

Orientation (three.js, Y up, product facing +Z, camera at +Z): a direction d maps to
u = atan2(d.z, d.x) / 2pi + 0.5 and v_from_top = 0.5 - asin(d.y) / pi, i.e. the image centre
looks along +X and three-quarter width looks toward the camera (+Z). Blender -> three axes:
three (x, y, z) = blender (x, z, -y).
"""
import bpy
import json
import math
import os
import sys

import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'env')
W, H = 2048, 1024

# Key light direction in three.js coordinates (front-left, above, as seen from the camera).
KEY_THREE = Vector((-0.6, 0.55, 0.58)).normalized()


def three_to_blender(v):
    return Vector((v[0], -v[2], v[1]))


def blender_to_three(v):
    return Vector((v[0], v[2], -v[1]))


def expected_pixel(d):
    d = Vector(d).normalized()
    u = math.atan2(d.z, d.x) / (2 * math.pi) + 0.5
    v = 0.5 - math.asin(max(-1, min(1, d.y))) / math.pi
    return u * W, v * H


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 48
    sc.cycles.max_bounces = 0
    sc.cycles.diffuse_bounces = 0
    sc.cycles.glossy_bounces = 0
    sc.cycles.transmission_bounces = 0
    sc.cycles.use_denoising = False
    sc.cycles.pixel_filter_type = 'BLACKMAN_HARRIS'
    sc.render.resolution_x = W
    sc.render.resolution_y = H
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0
    sc.view_settings.gamma = 1
    sc.render.image_settings.file_format = 'HDR'
    sc.render.image_settings.color_depth = '32'
    cam_data = bpy.data.cameras.new('pano')
    cam_data.type = 'PANO'
    cam_data.cycles.panorama_type = 'EQUIRECTANGULAR'
    cam = bpy.data.objects.new('pano', cam_data)
    sc.collection.objects.link(cam)
    # Look along blender +X with +Z up: the image centre is three +X, turning right goes to
    # blender -Y = three +Z (toward the product's camera).
    cam.rotation_euler = (math.radians(90), 0, math.radians(-90))
    cam.location = (0, 0, 0)
    sc.camera = cam
    world = bpy.data.worlds.new('room')
    sc.world = world
    world.use_nodes = True
    return sc


def set_world(color, strength=1.0):
    nt = bpy.context.scene.world.node_tree
    bg = nt.nodes['Background']
    bg.inputs['Color'].default_value = (*color, 1)
    bg.inputs['Strength'].default_value = strength


def emissive_material(name, strength, color=(1, 1, 1), edge=0.12, hot=0.3, round_edges=True):
    """Diffuser look: flat panel with a brighter centre and soft falloff toward the frame."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['UV'], sep.inputs['Vector'])

    def edge_factor(src):
        # |c - 0.5| -> 1 inside, 0 at the frame (smoothstep over `edge`).
        sub = nt.nodes.new('ShaderNodeMath'); sub.operation = 'SUBTRACT'; sub.inputs[1].default_value = 0.5
        nt.links.new(src, sub.inputs[0])
        ab = nt.nodes.new('ShaderNodeMath'); ab.operation = 'ABSOLUTE'
        nt.links.new(sub.outputs[0], ab.inputs[0])
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.interpolation_type = 'SMOOTHSTEP'
        mr.inputs['From Min'].default_value = 0.5 - edge
        mr.inputs['From Max'].default_value = 0.5
        mr.inputs['To Min'].default_value = 1.0
        mr.inputs['To Max'].default_value = 0.0
        nt.links.new(ab.outputs[0], mr.inputs['Value'])
        return mr.outputs['Result'], ab.outputs[0]

    ex, ax = edge_factor(sep.outputs['X'])
    ey, ay = edge_factor(sep.outputs['Y'])
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
    nt.links.new(ex, mul.inputs[0]); nt.links.new(ey, mul.inputs[1])
    # Hot centre: 1 + hot * (1 - r^2), r = max(|x|, |y|) * 2.
    mx = nt.nodes.new('ShaderNodeMath'); mx.operation = 'MAXIMUM'
    nt.links.new(ax, mx.inputs[0]); nt.links.new(ay, mx.inputs[1])
    r2 = nt.nodes.new('ShaderNodeMath'); r2.operation = 'MULTIPLY'; r2.inputs[1].default_value = 2.0
    nt.links.new(mx.outputs[0], r2.inputs[0])
    sq = nt.nodes.new('ShaderNodeMath'); sq.operation = 'POWER'; sq.inputs[1].default_value = 2.0
    nt.links.new(r2.outputs[0], sq.inputs[0])
    inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
    nt.links.new(sq.outputs[0], inv.inputs[1])
    boost = nt.nodes.new('ShaderNodeMath'); boost.operation = 'MULTIPLY_ADD'
    boost.inputs[1].default_value = hot; boost.inputs[2].default_value = 1.0
    nt.links.new(inv.outputs[0], boost.inputs[0])
    tot = nt.nodes.new('ShaderNodeMath'); tot.operation = 'MULTIPLY'
    nt.links.new(mul.outputs[0], tot.inputs[0]); nt.links.new(boost.outputs[0], tot.inputs[1])
    st = nt.nodes.new('ShaderNodeMath'); st.operation = 'MULTIPLY'; st.inputs[1].default_value = strength
    nt.links.new(tot.outputs[0], st.inputs[0])
    nt.links.new(st.outputs[0], em.inputs['Strength'])
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m


def flat_emissive(name, strength, color):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    em.inputs['Strength'].default_value = strength
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m


def panel(name, direction_three, distance, width, height, material, roll=0.0):
    """A rectangular emitter centred on a three.js direction, facing the origin."""
    d = three_to_blender(Vector(direction_three).normalized())
    bpy.ops.mesh.primitive_plane_add(size=1, location=d * distance)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (width, height, 1)
    # Plane normal (+Z) toward the origin, plane "up" (+Y) as close to world up as possible.
    to_origin = -d
    quat = to_origin.to_track_quat('Z', 'Y')
    ob.rotation_euler = quat.to_euler()
    if roll:
        ob.rotation_euler.rotate_axis('Z', roll)
    ob.data.materials.append(material)
    return ob


def floor(radiance, color, height=-1.0, radius=40.0, name='floor'):
    """Seamless floor: a large disc below the camera, its radiance fading toward the horizon."""
    bpy.ops.mesh.primitive_circle_add(vertices=128, radius=radius, fill_type='NGON', location=(0, 0, height))
    ob = bpy.context.active_object
    ob.name = name
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    ln = nt.nodes.new('ShaderNodeVectorMath'); ln.operation = 'LENGTH'
    nt.links.new(tc.outputs['Object'], ln.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.interpolation_type = 'SMOOTHSTEP'
    mr.inputs['From Min'].default_value = radius * 0.08
    mr.inputs['From Max'].default_value = radius * 0.7
    mr.inputs['To Min'].default_value = radiance
    mr.inputs['To Max'].default_value = radiance * 0.35
    nt.links.new(ln.outputs['Value'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], em.inputs['Strength'])
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    ob.data.materials.append(m)
    return ob


def wall(name, center_three, normal_three, width, height, material):
    c = three_to_blender(Vector(center_three))
    n = three_to_blender(Vector(normal_three)).normalized()
    bpy.ops.mesh.primitive_plane_add(size=1, location=c)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (width, height, 1)
    ob.rotation_euler = n.to_track_quat('Z', 'Y').to_euler()
    ob.data.materials.append(material)
    return ob


def build_soft():
    set_world((0.03, 0.03, 0.032))
    floor(0.3, (0.92, 0.91, 0.9), height=-1.0)
    # Sweep: the floor curving up into a back wall behind the product (-Z in three).
    sweep = flat_emissive('sweep', 0.12, (0.9, 0.9, 0.9))
    wall('sweep_wall', (0, 0.6, -9), (0, 0, 1), 26, 5, sweep)
    key = emissive_material('key', 12.0, (1.0, 0.985, 0.96), edge=0.14, hot=0.35)
    panel('key', KEY_THREE, 2.5, 1.2, 1.6, key)
    fill = emissive_material('fill', 2.5, (0.97, 0.98, 1.0), edge=0.16, hot=0.25)
    panel('fill', (0.75, 0.25, 0.62), 2.8, 1.4, 1.4, fill)
    top = emissive_material('top', 4.0, (1, 1, 1), edge=0.12, hot=0.25)
    panel('top', (0.05, 1.0, 0.1), 2.4, 1.8, 1.8, top)
    strip = emissive_material('strip', 7.0, (1, 1, 1), edge=0.2, hot=0.2)
    panel('strip_l', (-0.82, 0.18, -0.55), 2.6, 0.22, 2.2, strip)
    panel('strip_r', (0.82, 0.18, -0.55), 2.6, 0.22, 2.2, strip)


def build_strip():
    set_world((0.005, 0.005, 0.0055))
    floor(0.03, (0.9, 0.9, 0.9), height=-1.0)
    strip = emissive_material('strip', 18.0, (1, 1, 1), edge=0.18, hot=0.2)
    panel('strip_l', (-0.88, 0.22, -0.4), 2.4, 0.2, 2.4, strip)
    panel('strip_r', (0.88, 0.22, -0.4), 2.4, 0.2, 2.4, strip)
    over = emissive_material('over', 6.0, (1, 1, 1), edge=0.2, hot=0.2)
    panel('over', (0.0, 1.0, 0.25), 2.4, 2.0, 0.16, over)


def build_daylight():
    set_world((0.55, 0.5, 0.45), 0.25)
    floor(0.6, (1.0, 0.93, 0.84), height=-1.0)
    walls = flat_emissive('walls', 0.8, (1.0, 0.95, 0.88))
    wall('back_wall', (0, 1.0, -6), (0, 0, 1), 16, 7, walls)
    wall('right_wall', (6, 1.0, 0), (-1, 0, 0), 16, 7, walls)
    wall('front_wall', (0, 1.0, 6), (0, 0, -1), 16, 7, flat_emissive('front', 0.6, (1.0, 0.95, 0.88)))
    wall('left_wall', (-6, 1.0, 0), (1, 0, 0), 16, 7, flat_emissive('left', 0.55, (0.98, 0.95, 0.9)))
    ceiling = flat_emissive('ceiling', 1.2, (1.0, 0.97, 0.92))
    wall('ceiling', (0, 3.6, 0), (0, -1, 0), 16, 16, ceiling)
    # Window toward the front-left, facing the product, with mullions (dark bars in front of it).
    glass = emissive_material('window', 14.0, (0.93, 0.97, 1.0), edge=0.03, hot=0.15)
    WW, WH = 2.5, 2.7
    win = panel('window', KEY_THREE, 2.9, WW, WH, glass)
    # Sunlit patch on the floor under the window and a soft spill on the ceiling near it.
    spill = emissive_material('spill', 2.2, (1.0, 0.95, 0.86), edge=0.35, hot=0.4)
    sp = wall('floor_patch', (-1.6, -0.99, 1.4), (0, 1, 0), 2.2, 2.6, spill)
    glow = emissive_material('ceiling_glow', 2.0, (1.0, 0.98, 0.95), edge=0.45, hot=0.5)
    wall('ceiling_glow', (-1.8, 3.55, 1.0), (0, -1, 0), 4.0, 4.0, glow)
    mull = flat_emissive('mullion', 0.25, (0.85, 0.82, 0.78))
    d = three_to_blender(KEY_THREE)
    quat = (-d).to_track_quat('Z', 'Y')
    right = quat @ Vector((1, 0, 0))
    up = quat @ Vector((0, 1, 0))
    centre = d * 2.86
    for i in (-1, 1):  # two verticals
        bpy.ops.mesh.primitive_plane_add(size=1, location=centre + right * (i * WW / 6))
        ob = bpy.context.active_object
        ob.scale = (0.05, WH, 1)
        ob.rotation_euler = quat.to_euler()
        ob.data.materials.append(mull)
    for j in (-1, 1):  # two horizontals
        bpy.ops.mesh.primitive_plane_add(size=1, location=centre + up * (j * WH / 6))
        ob = bpy.context.active_object
        ob.scale = (WW, 0.05, 1)
        ob.rotation_euler = quat.to_euler()
        ob.data.materials.append(mull)
    return win


PRESETS = {
    'studio-soft': (build_soft, 1.0, 'Soft studio: big front-left key softbox, fill, overhead box, rim strips, light grey sweep.'),
    'studio-strip': (build_strip, 1.15, 'Dramatic: two tall strip lights behind-left and behind-right, thin overhead strip, near-black room.'),
    'daylight': (build_daylight, 0.85, 'Daylight: large front-left window with mullions, warm off-white room.'),
}


def measure(path):
    img = bpy.data.images.load(path)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)[::-1]  # top row first
    lum = 0.2126 * px[..., 0] + 0.7152 * px[..., 1] + 0.0722 * px[..., 2]
    mx = float(lum.max())
    mask = lum >= 0.6 * mx
    # Keep only the blob around the brightest pixel (two equal strips would average otherwise).
    sy, sx = np.unravel_index(int(np.argmax(lum)), lum.shape)
    keep = np.zeros_like(mask)
    stack = [(sy, sx)]
    hh, ww = mask.shape
    while stack:
        y, x = stack.pop()
        if y < 0 or y >= hh or not mask[y, x % ww] or keep[y, x % ww]:
            continue
        keep[y, x % ww] = True
        stack.extend(((y + 1, x), (y - 1, x), (y, (x + 1) % ww), (y, (x - 1) % ww)))
    mask = keep
    ys, xs = np.nonzero(mask)
    wts = lum[mask]
    cx = float((xs * wts).sum() / wts.sum())
    cy = float((ys * wts).sum() / wts.sum())
    u = (cx + 0.5) / img.size[0]
    v = (cy + 0.5) / img.size[1]
    phi = (u - 0.5) * 2 * math.pi
    lat = (0.5 - v) * math.pi
    d = (math.cos(lat) * math.cos(phi), math.sin(lat), math.cos(lat) * math.sin(phi))
    stats = {'max': mx, 'mean': float(lum.mean()), 'centroid_px': [round(cx, 1), round(cy, 1)], 'direction': [round(c, 4) for c in d]}
    bpy.data.images.remove(img)
    return stats


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    names = argv or list(PRESETS)
    os.makedirs(OUT, exist_ok=True)
    manifest_path = os.path.join(OUT, 'manifest.json')
    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            manifest = json.load(f)
    for name in names:
        build, exposure, desc = PRESETS[name]
        sc = reset()
        build()
        path = os.path.join(OUT, f'{name}.hdr')
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        st = measure(path)
        ex, ey = expected_pixel(KEY_THREE)
        print(f'[{name}] wrote {path} {os.path.getsize(path)} bytes; brightest blob at {st["centroid_px"]} (key contract {round(ex)}, {round(ey)}); max {st["max"]:.2f} mean {st["mean"]:.3f}')
        manifest[name] = {'file': f'env/{name}.hdr', 'keyDirection': st['direction'], 'brightestPx': st['centroid_px'], 'maxRadiance': round(st['max'], 2), 'meanRadiance': round(st['mean'], 4), 'exposure': exposure, 'description': desc}
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=1)


main()
