"""
Preview an environment .hdr: a tone-mapped panorama strip and a lit test scene (chrome sphere,
white diffuse sphere, glossy red can-like cylinder on a floor) rendered with Eevee.

    Blender -b --python tools/blender/preview_env.py -- public/env/studio-soft.hdr out_dir
"""
import bpy
import math
import os
import sys

argv = sys.argv[sys.argv.index('--') + 1:]
hdr, out_dir = os.path.abspath(argv[0]), os.path.abspath(argv[1])
name = os.path.splitext(os.path.basename(hdr))[0]
os.makedirs(out_dir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 64
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 900, 600
sc.view_settings.view_transform = 'Filmic'
sc.view_settings.look = 'Medium Contrast'

world = bpy.data.worlds.new('w')
sc.world = world
world.use_nodes = True
nt = world.node_tree
env = nt.nodes.new('ShaderNodeTexEnvironment')
env.image = bpy.data.images.load(hdr)
nt.links.new(env.outputs['Color'], nt.nodes['Background'].inputs['Color'])


def mat(name, color, metallic=0.0, rough=0.5, spec=0.5, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    b.inputs['Specular'].default_value = spec
    b.inputs['Clearcoat'].default_value = coat
    return m


bpy.ops.mesh.primitive_uv_sphere_add(radius=0.35, location=(-0.9, 0, 0.35), segments=64, ring_count=32)
bpy.ops.object.shade_smooth()
bpy.context.active_object.data.materials.append(mat('chrome', (0.95, 0.95, 0.95), 1.0, 0.05))
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.35, location=(0.9, 0, 0.35), segments=64, ring_count=32)
bpy.ops.object.shade_smooth()
bpy.context.active_object.data.materials.append(mat('white', (0.8, 0.8, 0.8), 0.0, 0.6))
bpy.ops.mesh.primitive_cylinder_add(radius=0.22, depth=0.75, location=(0, 0, 0.375), vertices=96)
bpy.ops.object.shade_smooth()
bpy.context.active_object.data.materials.append(mat('can', (0.75, 0.12, 0.08), 0.0, 0.25, coat=1.0))
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
bpy.context.active_object.data.materials.append(mat('floor', (0.6, 0.6, 0.6), 0.0, 0.8))

cam_data = bpy.data.cameras.new('c')
cam_data.lens = 50
cam = bpy.data.objects.new('c', cam_data)
sc.collection.objects.link(cam)
# Camera in front of the set (three +Z = blender -Y), slightly above.
cam.location = (0, -4.2, 1.1)
cam.rotation_euler = (math.radians(80), 0, 0)
sc.camera = cam
sc.render.image_settings.file_format = 'PNG'
sc.render.filepath = os.path.join(out_dir, f'{name}_preview.png')
bpy.ops.render.render(write_still=True)

# Panorama strip, tone-mapped.
sc2 = bpy.data.scenes.new('pano')
img = env.image
pano = bpy.data.images.new('pano_ldr', img.size[0] // 2, img.size[1] // 2)
img.scale(img.size[0] // 2, img.size[1] // 2)
px = list(img.pixels)
out = []
for i in range(0, len(px), 4):
    for c in range(3):
        v = px[i + c]
        v = v / (1 + v)  # Reinhard
        out.append(v ** (1 / 2.2))
    out.append(1.0)
pano.pixels = out
pano.filepath_raw = os.path.join(out_dir, f'{name}_pano.png')
pano.file_format = 'PNG'
pano.save()
print('preview written', sc.render.filepath)
