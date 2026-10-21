"""
Preview a cloth garment GLB: front, three-quarter and side views (Cycles, soft studio HDRI),
front layer textured with Blender's colour grid through its UVs so the mapping can be checked.

    Blender -b --python tools/blender/preview_cloth.py -- public/models/tee.glb out_dir
"""
import bpy
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:]
glb, out_dir = os.path.abspath(argv[0]), os.path.abspath(argv[1])
name = os.path.splitext(os.path.basename(glb))[0]

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 32
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 560, 640
sc.view_settings.view_transform = 'Filmic'
world = bpy.data.worlds.new('w')
sc.world = world
world.use_nodes = True
env = world.node_tree.nodes.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(os.path.join(ROOT, 'public', 'env', 'studio-soft.hdr'))
world.node_tree.links.new(env.outputs['Color'], world.node_tree.nodes['Background'].inputs['Color'])

bpy.ops.import_scene.gltf(filepath=glb)
ob = [o for o in sc.objects if o.type == 'MESH'][0]
grid = bpy.data.images.new('grid', 1024, 1024)
grid.generated_type = 'COLOR_GRID'
for slot in ob.material_slots:
    m = bpy.data.materials.new(slot.name + '_prev')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.85
    b.inputs['Sheen'].default_value = 0.5
    if slot.material and slot.material.name.startswith('front'):
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = grid
        mix = nt.nodes.new('ShaderNodeMixRGB')
        mix.inputs['Fac'].default_value = 0.55
        mix.inputs['Color1'].default_value = (0.85, 0.85, 0.85, 1)
        nt.links.new(tex.outputs['Color'], mix.inputs['Color2'])
        nt.links.new(mix.outputs['Color'], b.inputs['Base Color'])
    else:
        b.inputs['Base Color'].default_value = (0.55, 0.6, 0.7, 1)
    slot.material = m

bb = [ob.matrix_world @ v.co for v in ob.data.vertices]
cz = (max(v.z for v in bb) + min(v.z for v in bb)) / 2
size = max(max(v.x for v in bb) - min(v.x for v in bb), max(v.z for v in bb) - min(v.z for v in bb))

cam_data = bpy.data.cameras.new('c')
cam_data.lens = 70
cam_data.clip_start = 1
cam_data.clip_end = 100000
cam = bpy.data.objects.new('c', cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
tiles = []
VIEWS = [tuple(float(x) for x in v.split(',')) for v in os.environ['VIEWS'].split(';')] if os.environ.get('VIEWS') else [(0, 6), (-35, 12), (-90, 4)]
for i, (az, el) in enumerate(VIEWS):
    a, e = math.radians(az), math.radians(el)
    dist = size * 2.6
    # three +Z (viewer) = blender -Y; azimuth turns toward three +X.
    d = (math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))
    cam.location = (d[0] * dist, d[1] * dist, cz + d[2] * dist)
    look = (0 - cam.location[0], 0 - cam.location[1], cz - cam.location[2])
    from mathutils import Vector
    cam.rotation_euler = Vector(look).to_track_quat('-Z', 'Y').to_euler()
    path = os.path.join(out_dir, f'_{name}_{i}.png')
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    tiles.append(np.array(img.pixels[:]).reshape(img.size[1], img.size[0], 4))
    os.remove(path)
strip = np.concatenate(tiles, axis=1)
out = bpy.data.images.new('strip', strip.shape[1], strip.shape[0])
out.pixels = strip.ravel()
out.filepath_raw = os.path.join(out_dir, f'{name}_preview.png')
out.file_format = 'PNG'
out.save()
print('preview', out.filepath_raw)
