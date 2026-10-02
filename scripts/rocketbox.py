# Turns one of Microsoft's Rocketbox avatars (an FBX with its textures) into
# glTF for the game, run by scripts/fetch-assets.mjs in Blender, headless:
#
#   blender -b --factory-startup -P scripts/rocketbox.py -- <fbx> <textures> <out dir> [shrink | <side>]
#
# With `shrink`, it only writes each texture the avatar's FBX uses, found in
# <textures>, at no more than 1024 px as a JPEG into <out dir> (the originals kept in
# scripts/originals), and stops. Otherwise it writes <name>.glb, the avatar
# without its textures, and the textures it uses packed into one image each
# for colour and normals (at half the size), <name>_color.png and <name>_normal.png, which
# fetch-assets.mjs compresses and puts back on the materials. Given a side
# (operator, guard or commander), the clothes take its colours (see PALETTES).
#
# On the way: the face's bones go, their skin moving with the head; so do the
# guns and knives some avatars carry, and the see-through goggle lens; avatars
# of more than MAX_TRIANGLES are thinned out to it; the
# thighs hang off the pelvis rather than the spine, and the collarbones off
# the chest rather than the neck, so bending the spine leaves the legs alone
# and turning the head leaves the arms; bones are added at the top of the head and at the
# tips of the boots, for the game to measure by; and it's all scaled to
# metres, standing at the origin facing +z in glTF.

import bpy, bmesh, json, os, sys
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
fbx, textures, out = args[:3]
shrink = len(args) > 3 and args[3] == 'shrink'
team = args[3] if len(args) > 3 and not shrink else None
name = os.path.splitext(os.path.basename(fbx))[0]

# Materials of the things carried, not worn: guns, knives, and the clear lens.
DROPPED = ('pistol', 'shotgun', 'machinegun', 'rifle', 'knife', 'opacity')
# Each texture's size in the packed colour image, in the normals' (which show
# only up close), and at most in the originals kept.
TILE = {'color': 512, 'normal': 256}
# The most triangles an avatar keeps: the soldiers in helmets have half as many again as the others.
MAX_TRIANGLES = 10000
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
rows = int(np.ceil(len(kept) / cols))
uv = mesh.data.uv_layers.active.data
loops = mesh.data.loops
for poly in mesh.data.polygons:
    i = kept.index(mesh.material_slots[poly.material_index].material)
    col, row = i % cols, i // cols
    for li in poly.loop_indices:
        u, v = uv[li].uv
        if not (-0.01 <= u <= 1.01 and -0.01 <= v <= 1.01):
            raise SystemExit(f'{kept[i].name} has UVs outside its texture, which a packed image can\'t repeat')
        uv[li].uv = ((min(max(u, 0), 1) + col) / cols, (min(max(v, 0), 1) + row) / rows)
for i in reversed(range(len(mesh.material_slots))):
    if mesh.material_slots[i].material not in kept:
        mesh.active_material_index = i
        bpy.ops.object.material_slot_remove()
bpy.ops.object.mode_set(mode='OBJECT')
# Thinned out evenly, the skin weights and UVs carried along, before it's skinned.
tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
if tris > MAX_TRIANGLES:
    thin = mesh.modifiers.new('thin', 'DECIMATE')
    thin.ratio = MAX_TRIANGLES / tris
    bpy.ops.object.modifier_move_to_index(modifier=thin.name, index=0)
    bpy.ops.object.modifier_apply(modifier=thin.name)

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
chest = edit['Bip01 Spine2']
for side in 'LR':
    edit[f'Bip01 {side} Thigh'].parent = pelvis
    edit[f'Bip01 {side} Clavicle'].parent = chest


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

# Each side's clothes, to suit a green and brown island: their colours by
# brightness, dark to light, as sRGB, and how far toward them they go. Each
# pixel's brightness picks its colour, so the camouflage's pattern and the
# folds' shading stay. The guards in green, the commanders in brown so they
# stand apart, and the operators keep their black, turned a little olive.
PALETTES = {
    'guard': ([(0.08, 0.085, 0.055), (0.23, 0.25, 0.15), (0.47, 0.46, 0.33)], 1.0),
    'commander': ([(0.11, 0.08, 0.05), (0.34, 0.26, 0.16), (0.62, 0.54, 0.38)], 1.0),
    'operator': ([(0.05, 0.055, 0.035), (0.40, 0.42, 0.30), (0.80, 0.80, 0.68)], 0.7),
}


def recolor(px, palette):
    """
    Clothes in `px` (RGBA, sRGB) in `palette`'s colours, caps and helmets
    included, leaving skin, which is far more saturated, as it is.
    """
    stops, strength = palette
    rgb = px[..., :3]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    # Most of the cloth is darker than mid-grey: stretched so its range spans the stops.
    t = np.clip(lum * 1.6, 0, 1)
    stops = np.array(stops, dtype=np.float32)
    low = np.clip(t * 2, 0, 1)[..., None]
    high = np.clip(t * 2 - 1, 0, 1)[..., None]
    mapped = np.where(t[..., None] < 0.5, stops[0] + (stops[1] - stops[0]) * low, stops[1] + (stops[2] - stops[1]) * high)
    sat = (rgb.max(axis=-1) - rgb.min(axis=-1)) / np.maximum(rgb.max(axis=-1), 1e-4)
    cloth = 1 - np.clip((sat - 0.12) / 0.08, 0, 1)
    k = (cloth * strength)[..., None]
    px[..., :3] = rgb + (mapped - rgb) * k
    return px


def pack(kind):
    tile = TILE[kind]
    sheet = np.zeros((rows * tile, cols * tile, 4), dtype=np.float32)
    sheet[..., 3] = 1
    for i, m in enumerate(kept):
        img = bpy.data.images.load(image_of(m, kind))
        img.colorspace_settings.name = 'Non-Color'
        img.scale(tile, tile)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(tile, tile, 4)
        if kind == 'color' and team:
            px = recolor(px, PALETTES[team])
        col, row = i % cols, i // cols
        sheet[row * tile:(row + 1) * tile, col * tile:(col + 1) * tile] = px
    if kind == 'normal':
        # Empty tiles point straight out.
        empty = sheet[..., :3].sum(axis=2) == 0
        sheet[empty] = (0.5, 0.5, 1, 1)
    img = bpy.data.images.new(f'{name}_{kind}', cols * tile, rows * tile, alpha=False, float_buffer=False)
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
    export_vertex_color='NONE',
)
tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
print('AVATAR', json.dumps({'name': name, 'materials': [m.name for m in kept], 'tiles': [cols, rows], 'triangles': tris}))
