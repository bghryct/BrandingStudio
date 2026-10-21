"""
Preview public/models/ice.glb: the four cubes (with their cores) in a row and the crushed-ice
bed (with its white fracture planes) around a can-sized cylinder, lit by the soft studio HDRI,
on a mid-grey and on a dark floor.

    Blender -b --python tools/blender/preview_ice.py -- out_dir
"""
import bpy
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
out_dir = os.path.abspath(sys.argv[sys.argv.index('--') + 1])

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 96
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 16
sc.cycles.transmission_bounces = 16
sc.cycles.transparent_max_bounces = 16
sc.render.resolution_x, sc.render.resolution_y = 1200, 700
sc.view_settings.view_transform = 'Filmic'
sc.view_settings.look = 'Medium High Contrast'
world = bpy.data.worlds.new('w')
sc.world = world
world.use_nodes = True
env = world.node_tree.nodes.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(os.path.join(ROOT, 'public', 'env', 'studio-soft.hdr'))
world.node_tree.links.new(env.outputs['Color'], world.node_tree.nodes['Background'].inputs['Color'])

bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'public', 'models', 'ice.glb'))

ice = bpy.data.materials.new('ice')
ice.use_nodes = True
b = ice.node_tree.nodes['Principled BSDF']
b.inputs['Base Color'].default_value = (0.9, 0.97, 1.0, 1)
b.inputs['Transmission'].default_value = 1.0
b.inputs['Roughness'].default_value = 0.02
b.inputs['IOR'].default_value = 1.31
b.inputs['Clearcoat'].default_value = 1.0
b.inputs['Clearcoat Roughness'].default_value = 0.02
nt = ice.node_tree
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = bpy.data.images.load(os.path.join(ROOT, 'public', 'textures', 'ice-normal.png'))
tex.image.colorspace_settings.name = 'Non-Color'
nm = nt.nodes.new('ShaderNodeNormalMap')
nm.inputs['Strength'].default_value = 0.15
nt.links.new(tex.outputs['Color'], nm.inputs['Color'])
nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])

core = bpy.data.materials.new('core')
core.use_nodes = True
c = core.node_tree.nodes['Principled BSDF']
c.inputs['Base Color'].default_value = (1, 1, 1, 1)
c.inputs['Transmission'].default_value = 0.3
c.inputs['Roughness'].default_value = 0.6

for ob in list(sc.objects):
    if ob.type != 'MESH':
        continue
    ob.data.materials.clear()
    ob.data.materials.append(core if (ob.name.startswith('ice_core') or ob.name == 'crushed_ice_fractures') else ice)
    if ob.name.startswith('ice_cube') or ob.name.startswith('ice_core'):
        i = int(ob.name[-1])
        ob.location = (-120 + i * 40, -70, 14.5)
        ob.rotation_euler = (0, 0, math.radians(i * 23))
    if ob.name.startswith('crushed_ice'):
        ob.location = (60, 60, 0)

bpy.ops.mesh.primitive_cylinder_add(radius=33, depth=122, location=(60, 60, 61), vertices=96)
can = bpy.context.active_object
bpy.ops.object.shade_smooth()
cm = bpy.data.materials.new('can')
cm.use_nodes = True
cb = cm.node_tree.nodes['Principled BSDF']
cb.inputs['Base Color'].default_value = (0.8, 0.15, 0.06, 1)
cb.inputs['Roughness'].default_value = 0.25
cb.inputs['Clearcoat'].default_value = 1
can.data.materials.append(cm)

bpy.ops.mesh.primitive_plane_add(size=2000, location=(0, 0, 0))
fm = bpy.data.materials.new('floor')
fm.use_nodes = True
floor_bsdf = fm.node_tree.nodes['Principled BSDF']
bpy.context.active_object.data.materials.append(fm)

cam_data = bpy.data.cameras.new('c')
cam_data.lens = 50
cam_data.clip_start = 1
cam_data.clip_end = 5000
cam = bpy.data.objects.new('c', cam_data)
sc.collection.objects.link(cam)
cam.location = (0, -420, 190)
cam.rotation_euler = (math.radians(66), 0, 0)
sc.camera = cam
for tag, col, strength in (('grey', (0.22, 0.23, 0.24, 1), 1.0), ('dark', (0.02, 0.02, 0.025, 1), 0.35)):
    floor_bsdf.inputs['Base Color'].default_value = col
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = strength
    sc.render.filepath = os.path.join(out_dir, f'ice_preview_{tag}.png')
    bpy.ops.render.render(write_still=True)
