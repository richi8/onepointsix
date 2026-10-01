# Turns one of Microsoft's Rocketbox avatars (an FBX with its textures) into
# glTF for the game, run by scripts/fetch-assets.mjs in Blender, headless:
#
#   blender -b --factory-startup -P scripts/rocketbox.py -- <fbx> <textures> <out dir> [shrink]
#
# With `shrink`, it only writes each texture the avatar's FBX uses, found in
# <textures>, at no more than 1024 px as a JPEG into <out dir> (the originals kept in
# scripts/originals), and stops. Otherwise it writes <name>.glb, the avatar
# without its textures, and the textures it uses packed into one image each
# for colour and normals, <name>_color.png and <name>_normal.png, which
# fetch-assets.mjs compresses and puts back on the materials.
#
# On the way: the face's bones go, their skin moving with the head; so do the
# guns and knives some avatars carry, and the see-through goggle lens; the
# thighs hang off the pelvis rather than the spine, so bending the spine
# leaves the legs alone; bones are added at the top of the head and at the
# tips of the boots, for the game to measure by; and it's all scaled to
# metres, standing at the origin facing +z in glTF.

import bpy, bmesh, json, os, sys
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
fbx, textures, out = args[:3]
shrink = len(args) > 3 and args[3] == 'shrink'
name = os.path.splitext(os.path.basename(fbx))[0]

# Materials of the things carried, not worn: guns, knives, and the clear lens.
DROPPED = ('pistol', 'shotgun', 'machinegun', 'rifle', 'knife', 'opacity')
# Each texture's size in the packed image, and at most in the originals kept.
TILE = 512
ORIGINAL = 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=fbx, automatic_bone_orientation=False)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')


def image_of(material, kind):
    """The file a material's colour or normal texture comes from: <prefix>_<part>_<kind>, as Rocketbox names them."""
    base = material.name
    for ext in ('.jpg', '.tga', '.png'):
        path = os.path.join(textures, f'{base}_{kind}{ext}')
        if os.path.exists(path):
            return path
    # Some avatars' colour maps carry a suffix, such as the camouflage's.
    for f in sorted(os.listdir(textures)):
        if f.startswith(f'{base}_{kind}'):
            return os.path.join(textures, f)
    raise SystemExit(f'No {kind} texture for {base} in {textures}')


kept = [s.material for s in mesh.material_slots if s.material and not any(d in s.material.name for d in DROPPED)]

if shrink:
    os.makedirs(out, exist_ok=True)
    for m in kept:
        for kind in ('color', 'normal'):
            src = image_of(m, kind)
            img = bpy.data.images.load(src)
            w, h = img.size
            img.scale(min(w, ORIGINAL), min(h, ORIGINAL))
            settings = bpy.context.scene.render.image_settings
            settings.file_format = 'JPEG'
            settings.color_mode = 'RGB'
            settings.quality = 85
            path = os.path.join(out, f'{m.name}_{kind}.jpg')
            img.save_render(path, scene=bpy.context.scene)
            print('shrunk', path)
    sys.exit(0)

for o in list(bpy.data.objects):
    if o not in (arm, mesh):
        bpy.data.objects.remove(o)
# The FBX's take keys the armature's own transform, which would undo it being applied below.
for o in (arm, mesh):
    o.animation_data_clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

# ------------------------------------------------------------ the mesh

bpy.context.view_layer.objects.active = mesh
bm = bmesh.new()
bm.from_mesh(mesh.data)
drop = [f for f in bm.faces if mesh.material_slots[f.material_index].material not in kept]
bmesh.ops.delete(bm, geom=drop, context='FACES')
bm.to_mesh(mesh.data)
bm.free()
# Each kept material's UVs moved into its tile of the packed images, filled from the bottom left.
cols = int(np.ceil(np.sqrt(len(kept))))
uv = mesh.data.uv_layers.active.data
loops = mesh.data.loops
for poly in mesh.data.polygons:
    i = kept.index(mesh.material_slots[poly.material_index].material)
    col, row = i % cols, i // cols
    for li in poly.loop_indices:
        u, v = uv[li].uv
        if not (-0.01 <= u <= 1.01 and -0.01 <= v <= 1.01):
            raise SystemExit(f'{kept[i].name} has UVs outside its texture, which a packed image can\'t repeat')
        uv[li].uv = ((min(max(u, 0), 1) + col) / cols, (min(max(v, 0), 1) + row) / cols)
for i in reversed(range(len(mesh.material_slots))):
    if mesh.material_slots[i].material not in kept:
        mesh.active_material_index = i
        bpy.ops.object.material_slot_remove()
bpy.ops.object.mode_set(mode='OBJECT')

# ------------------------------------------------------------ the bones

bones = arm.data.bones
head = bones['Bip01 Head']
face = [b.name for b in head.children_recursive]
groups = mesh.vertex_groups
into = groups['Bip01 Head']
for v in mesh.data.vertices:
    extra = sum(g.weight for g in v.groups if groups[g.group].name in face)
    if extra > 0:
        into.add([v.index], extra, 'ADD')
for n in face:
    if n in groups:
        groups.remove(groups[n])

# Where the head's top and each boot's tip are, at rest, from the skin they move.
weights = {g.index: g.name for g in groups}
top = None
tips = {'L': None, 'R': None}
world = mesh.matrix_world
for v in mesh.data.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    if best is None:
        continue
    bone = weights[best.group]
    p = world @ v.co
    if bone == 'Bip01 Head' and (top is None or p.z > top.z):
        top = p
    for side in 'LR':
        # The model faces -y in Blender: the furthest forward vertex of the toes.
        if bone == f'Bip01 {side} Toe0' and (tips[side] is None or p.y < tips[side].y):
            tips[side] = p

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
edit = arm.data.edit_bones
inv = arm.matrix_world.inverted()
for n in face:
    edit.remove(edit[n])
pelvis = edit['Bip01 Pelvis']
for side in 'LR':
    edit[f'Bip01 {side} Thigh'].parent = pelvis


def nub(name, parent, at):
    b = edit.new(name)
    b.head = inv @ at
    b.tail = b.head + Vector((0, 0, 0.05)) / arm.matrix_world.to_scale().z
    b.parent = edit[parent]


h = edit['Bip01 Head'].head
nub('Bip01 HeadNub', 'Bip01 Head', Vector(((arm.matrix_world @ h).x, (arm.matrix_world @ h).y, top.z)))
for side in 'LR':
    toe = arm.matrix_world @ edit[f'Bip01 {side} Toe0'].head
    nub(f'Bip01 {side} Toe0Nub', f'Bip01 {side} Toe0', Vector((toe.x, tips[side].y, toe.z)))
bpy.ops.object.mode_set(mode='OBJECT')

# In metres, with nothing turned or scaled above the bones.
for o in (arm, mesh):
    o.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.context.view_layer.update()

# ------------------------------------------------------------ the images

def pack(kind):
    size = cols * TILE
    sheet = np.zeros((size, size, 4), dtype=np.float32)
    sheet[..., 3] = 1
    for i, m in enumerate(kept):
        img = bpy.data.images.load(image_of(m, kind))
        img.colorspace_settings.name = 'Non-Color'
        img.scale(TILE, TILE)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(TILE, TILE, 4)
        col, row = i % cols, i // cols
        sheet[row * TILE:(row + 1) * TILE, col * TILE:(col + 1) * TILE] = px
    if kind == 'normal':
        # Empty tiles point straight out.
        empty = sheet[..., :3].sum(axis=2) == 0
        sheet[empty] = (0.5, 0.5, 1, 1)
    img = bpy.data.images.new(f'{name}_{kind}', size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels[:] = sheet.ravel()
    img.filepath_raw = os.path.join(out, f'{name}_{kind}.png')
    img.file_format = 'PNG'
    img.save()


os.makedirs(out, exist_ok=True)
pack('color')
pack('normal')

bpy.ops.export_scene.gltf(
    filepath=os.path.join(out, f'{name}.glb'), export_format='GLB', export_image_format='NONE',
    export_animations=False, export_morph=False, export_skins=True, export_yup=True, export_tangents=False,
)
tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
print('AVATAR', json.dumps({'name': name, 'materials': [m.name for m in kept], 'tiles': cols, 'triangles': tris}))
