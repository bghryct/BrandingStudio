"""
Preview the tileable normal maps: one tile per map (2 x 2 repeat, so seams would show), lit by a
grazing key light plus the soft studio HDRI.

    Blender -b --python tools/blender/preview_textures.py -- out_dir
"""
import bpy
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
out_dir = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
names = ['jersey', 'canvas', 'fleece', 'paper', 'kraft', 'brushed', 'ice']
colors = {'jersey': (0.8, 0.8, 0.82), 'canvas': (0.78, 0.72, 0.6), 'fleece': (0.45, 0.47, 0.5), 'paper': (0.9, 0.9, 0.88),
          'kraft': (0.55, 0.38, 0.22), 'brushed': (0.8, 0.8, 0.82), 'ice': (0.85, 0.92, 0.95)}

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 48
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 1600, 800
sc.view_settings.view_transform = 'Filmic'
world = bpy.data.worlds.new('w')
sc.world = world
world.use_nodes = True
env = world.node_tree.nodes.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(os.path.join(ROOT, 'public', 'env', 'studio-soft.hdr'))
world.node_tree.links.new(env.outputs['Color'], world.node_tree.nodes['Background'].inputs['Color'])
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6

for i, name in enumerate(names):
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=((i % 4) * 1.04 - 1.56, 0.52 - (i // 4) * 1.04, 0))
    ob = bpy.context.active_object
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*colors[name], 1)
    b.inputs['Roughness'].default_value = 0.3 if name in ('brushed', 'ice') else 0.75
    b.inputs['Metallic'].default_value = 1.0 if name == 'brushed' else 0.0
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(os.path.join(ROOT, 'public', 'textures', f'{name}-normal.png'))
    tex.image.colorspace_settings.name = 'Non-Color'
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (2, 2, 1)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(tc.outputs['UV'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], tex.inputs['Vector'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tex.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    ob.data.materials.append(m)

sun = bpy.data.lights.new('sun', 'SUN')
sun.energy = 4.0
sun.angle = math.radians(2)
so = bpy.data.objects.new('sun', sun)
sc.collection.objects.link(so)
so.rotation_euler = (math.radians(72), 0, math.radians(-60))

cam_data = bpy.data.cameras.new('c')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 4.2
cam = bpy.data.objects.new('c', cam_data)
sc.collection.objects.link(cam)
cam.location = (0, 0, 5)
sc.camera = cam
sc.render.filepath = os.path.join(out_dir, 'normalmaps_preview.png')
bpy.ops.render.render(write_still=True)
