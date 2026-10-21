"""
Blender 白模预演 builder（P0）。

用法：
  blender -b --factory-startup --python blender/previz_build.py -- \
    --project fixtures/boutique --out demo-out --mode all

产出：
  <out>/boutique.blend
  <out>/S03/<shot>/review/f_####.png
  <out>/S03/<shot>/first.png / mid.png / last.png
  <out>/plan.png
  <out>/facts.json

P0 刻意保持单文件、无外部资产、无 addon 依赖：
  - 墙用 box 段拼出真洞；
  - 人物用胶囊/圆柱/球拼的 mannequin；
  - 动作逐帧关键帧；
  - 相机用公式反算 + TRACK_TO；
  - Workbench 出图。
"""

import bpy
import json
import math
import os
import shutil
import sys
import time

from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

# ---------------------------------------------------------------- args / io


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    opts = {
        "project": "fixtures/boutique",
        "out": "demo-out",
        "mode": "all",  # build | render | plan | all
        "res": "640x360",
        "plan_res": "1280x720",
        "only": "",  # 逗号分隔的镜号；空 = 全部
    }
    i = 0
    while i < len(argv):
        key = argv[i]
        val = argv[i + 1] if i + 1 < len(argv) else None
        if key.startswith("--") and val is not None:
            opts[key[2:]] = val
            i += 2
        else:
            i += 1
    return opts


def read_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def log(msg):
    print(f"[previz] {msg}", flush=True)


# ---------------------------------------------------------------- scene / mats


ROLE_COLORS = {
    "BODY": (0.16, 0.18, 0.22),
    "PROP": (0.85, 0.28, 0.10),
    "WOOD": (0.52, 0.38, 0.22),
    "DARK": (0.24, 0.24, 0.27),
    "WALL": (0.72, 0.72, 0.74),
    "RELIEF": (0.60, 0.60, 0.62),
    "FLOOR": (0.40, 0.40, 0.42),
    "EXTRA": (0.32, 0.32, 0.34),
    "SCRN": (0.82, 0.88, 0.92),
}
FRONT_COLOR = (1.0, 0.45, 0.08)
PLAN_CAM_COLOR = (0.88, 0.12, 0.10)
PLAN_PATH_COLOR = (0.95, 0.75, 0.10)
PLAN_TEXT_COLOR = (0.05, 0.05, 0.05)


_mats = {}


def get_mat(role):
    if role in _mats:
        return _mats[role]
    color = ROLE_COLORS.get(role, (0.5, 0.5, 0.5))
    mat = bpy.data.materials.new(f"MAT_{role}")
    mat.diffuse_color = (*color, 1.0)
    _mats[role] = mat
    return mat


def get_special_mat(name, color):
    key = f"__{name}"
    if key in _mats:
        return _mats[key]
    mat = bpy.data.materials.new(f"MAT_{name}")
    mat.diffuse_color = (*color, 1.0)
    _mats[key] = mat
    return mat


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()


def ensure_collection(name):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
    return coll


def link(obj, coll):
    coll.objects.link(obj)
    return obj


# ---------------------------------------------------------------- primitives


def add_box(name, pos, size, role, coll):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    ob = bpy.context.object
    ob.name = name
    ob.scale = size
    ob.data.materials.append(get_mat(role))
    # move into target collection
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    coll.objects.link(ob)
    return ob


def add_cylinder(name, pos, radius, depth, role, coll, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=depth, location=pos, rotation=rot)
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(get_mat(role))
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    coll.objects.link(ob)
    return ob


def add_sphere(name, pos, radius, role, coll):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=radius, location=pos)
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(get_mat(role))
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    coll.objects.link(ob)
    return ob


def add_text(name, body, loc, size, coll, color=PLAN_TEXT_COLOR):
    curve = bpy.data.curves.new(name, type="FONT")
    curve.body = body
    curve.size = size
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    ob = bpy.data.objects.new(name, curve)
    ob.location = loc
    ob.data.materials.append(get_special_mat(name, color))
    coll.objects.link(ob)
    return ob


def add_path_curve(name, points, coll, color=PLAN_PATH_COLOR):
    curve = bpy.data.curves.new(name, type="CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.035
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for i, (x, y) in enumerate(points):
        spline.points[i].co = (x, y, 0.025, 1.0)
    ob = bpy.data.objects.new(name, curve)
    ob.data.materials.append(get_special_mat(name, color))
    coll.objects.link(ob)
    return ob


# ---------------------------------------------------------------- set


def wall_segments(el):
    """把墙拆成洞四周的墙段；返回 [(cx, cy, cz, sx, sy, sz)]。"""
    x0, y0 = el["from"]
    x1, y1 = el["to"]
    along_x = abs(x1 - x0) >= abs(y1 - y0)
    length = math.hypot(x1 - x0, y1 - y0)
    thickness = el["thickness"]
    height = el["height"]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    openings = sorted(el.get("openings", []), key=lambda o: o["rect"][0])
    segments = []
    cursor = -length / 2

    def seg(s0, s1, z0, z1):
        if s1 - s0 <= 1e-6 or z1 - z0 <= 1e-6:
            return
        mid = (s0 + s1) / 2
        zc = (z0 + z1) / 2
        if along_x:
            segments.append((cx + mid, cy, zc, s1 - s0, thickness, z1 - z0))
        else:
            segments.append((cx, cy + mid, zc, thickness, s1 - s0, z1 - z0))

    for op in openings:
        ox0, oz0, ox1, oz1 = op["rect"]
        if ox0 > cursor:
            seg(cursor, ox0, 0, height)
        if oz0 > 0:
            seg(ox0, ox1, 0, oz0)
        if oz1 < height:
            seg(ox0, ox1, oz1, height)
        cursor = max(cursor, ox1)
    if cursor < length / 2:
        seg(cursor, length / 2, 0, height)
    return segments


def build_set(set_data, coll):
    for el in set_data["elements"]:
        if el["type"] == "box":
            add_box(f"SET_{el['id']}", el["pos"], el["size"], el["role"], coll)
        elif el["type"] == "wall":
            for i, (x, y, z, sx, sy, sz) in enumerate(wall_segments(el)):
                add_box(f"SET_{el['id']}_{i:02d}", (x, y, z), (sx, sy, sz), el["role"], coll)
        else:
            raise ValueError(f"unsupported set element: {el['type']}")
    for pr in set_data.get("props", []):
        add_box(f"PROP_{pr['id']}", pr["pos"], pr["size"], pr["role"], coll)


# ---------------------------------------------------------------- actors


def make_actor(actor_id, height, coll):
    root = bpy.data.objects.new(f"ACT_{actor_id}", None)
    root.empty_display_size = 0.2
    coll.objects.link(root)
    s = height / 1.75
    parts = {}

    def parent(ob):
        ob.parent = root
        ob.matrix_parent_inverse = root.matrix_world.inverted()
        return ob

    def parent_to(ob, parent_ob):
        ob.parent = parent_ob
        ob.matrix_parent_inverse = parent_ob.matrix_world.inverted()
        return ob

    parts["leg_l"] = parent(add_cylinder(f"{actor_id}_leg_l", (-0.11 * s, 0, 0.425 * s), 0.075 * s, 0.85 * s, "BODY", coll))
    parts["leg_r"] = parent(add_cylinder(f"{actor_id}_leg_r", (0.11 * s, 0, 0.425 * s), 0.075 * s, 0.85 * s, "BODY", coll))
    # 脚掌是独立 box，父到小腿；动画里反向旋转保持脚底水平（脚掌不随腿翻）。
    parts["foot_l"] = parent_to(add_box(f"{actor_id}_foot_l", (-0.11 * s, 0.07 * s, 0.035 * s), (0.13 * s, 0.28 * s, 0.07 * s), "BODY", coll), parts["leg_l"])
    parts["foot_r"] = parent_to(add_box(f"{actor_id}_foot_r", (0.11 * s, 0.07 * s, 0.035 * s), (0.13 * s, 0.28 * s, 0.07 * s), "BODY", coll), parts["leg_r"])
    parts["torso"] = parent(add_cylinder(f"{actor_id}_torso", (0, 0, 1.15 * s), 0.18 * s, 0.60 * s, "BODY", coll))
    parts["head"] = parent(add_sphere(f"{actor_id}_head", (0, 0, 1.62 * s), 0.115 * s, "BODY", coll))
    parts["arm_l"] = parent(add_cylinder(f"{actor_id}_arm_l", (-0.25 * s, 0, 1.18 * s), 0.055 * s, 0.52 * s, "BODY", coll))
    parts["arm_r"] = parent(add_cylinder(f"{actor_id}_arm_r", (0.25 * s, 0, 1.18 * s), 0.055 * s, 0.52 * s, "BODY", coll))
    # 正面标记：小方块放在 +Y（角色本地正面）
    marker = add_box(f"{actor_id}_front", (0, 0.19 * s, 1.28 * s), (0.12 * s, 0.04 * s, 0.12 * s), "BODY", coll)
    marker.data.materials.clear()
    marker.data.materials.append(get_special_mat("FRONT", FRONT_COLOR))
    parts["front"] = parent(marker)
    for p in parts.values():
        p.rotation_mode = "XYZ"
    return root, parts, s


def path_position(path, u):
    """按折线长度参数化；u=0..1。"""
    pts = [Vector((p[0], p[1], 0)) for p in path]
    segs = [(pts[i], pts[i + 1], (pts[i + 1] - pts[i]).length) for i in range(len(pts) - 1)]
    total = sum(s[2] for s in segs)
    if total <= 1e-9:
        return pts[0].x, pts[0].y
    d = max(0.0, min(1.0, u)) * total
    for a, b, ln in segs:
        if d <= ln or a is segs[-1][0]:
            f = d / ln if ln > 1e-9 else 0
            p = a.lerp(b, f)
            return p.x, p.y
        d -= ln
    return pts[-1].x, pts[-1].y


def move_of(blocking, actor_id):
    for m in blocking.get("moves", []):
        if m["actor"] == actor_id:
            return m
    return None


def actor_pos_at(blocking, actor_id, t):
    keys = blocking["actors"][actor_id]["keys"]
    m = move_of(blocking, actor_id)
    if m and m["from"] <= t <= m["to"]:
        u = (t - m["from"]) / max(m["to"] - m["from"], 1e-9)
        return path_position(m["path"], u)
    if t < keys[0]["t"]:
        return tuple(keys[0]["pos"])
    if t >= keys[-1]["t"]:
        return tuple(keys[-1]["pos"])
    for i in range(len(keys) - 1):
        a, b = keys[i], keys[i + 1]
        if a["t"] <= t <= b["t"]:
            f = (t - a["t"]) / max(b["t"] - a["t"], 1e-9)
            return (a["pos"][0] + (b["pos"][0] - a["pos"][0]) * f,
                    a["pos"][1] + (b["pos"][1] - a["pos"][1]) * f)
    return tuple(keys[-1]["pos"])


def actor_facing_at(blocking, actor_id, t):
    keys = blocking["actors"][actor_id]["keys"]
    if t <= keys[0]["t"]:
        return keys[0]["facing"]
    if t >= keys[-1]["t"]:
        return keys[-1]["facing"]
    for i in range(len(keys) - 1):
        a, b = keys[i], keys[i + 1]
        if a["t"] <= t <= b["t"]:
            f = (t - a["t"]) / max(b["t"] - a["t"], 1e-9)
            return a["facing"] + (b["facing"] - a["facing"]) * f
    return keys[-1]["facing"]


def actor_pose_at(blocking, actor_id, t):
    keys = blocking["actors"][actor_id]["keys"]
    pose = keys[0].get("pose", "stand_idle")
    for k in keys:
        if k["t"] <= t:
            pose = k.get("pose", pose)
    m = move_of(blocking, actor_id)
    if m and m["from"] <= t <= m["to"]:
        return "walk" if m.get("gait", "walk") == "walk" else "run"
    return pose


def animate_actors(blocking, actors, fps, total_frames):
    scene = bpy.context.scene
    # 每只脚的落地锚点：{actor: {side: (x, y)}}；支撑相内把骨盆拉回去，避免滑步。
    plant_anchor = {aid: {} for aid in actors}
    for frame in range(1, total_frames + 1):
        t = (frame - 1) / fps
        scene.frame_set(frame)
        for actor_id, (root, parts, s) in actors.items():
            x, y = actor_pos_at(blocking, actor_id, t)
            facing = actor_facing_at(blocking, actor_id, t)
            root.rotation_euler = (0, 0, math.radians(-facing))
            pose = actor_pose_at(blocking, actor_id, t)
            swing = 0.0
            roll = 0.0
            if pose in ("walk", "run"):
                speed = 1.0
                m = move_of(blocking, actor_id)
                if m:
                    speed = m.get("speed", 1.0)
                phase = t * 2 * math.pi * (1.6 if pose == "walk" else 3.0) * max(0.6, speed)
                swing = math.sin(phase) * math.radians(30 if pose == "walk" else 45)
                # heel-to-toe：腿在前（sin>0）脚跟先着地、脚尖上翘；腿在后脚尖离地、脚尖下压。
                roll = math.sin(phase) * math.radians(12 if pose == "walk" else 18)
            # 先按地面放骨盆；摆腿后按实测最低脚把骨盆抬起，做简易 foot lock。
            root.location = (x, y, 0)
            for name, ob in parts.items():
                ob.rotation_euler = (0, 0, 0)
            if pose in ("walk", "run"):
                parts["leg_l"].rotation_euler.x = swing
                parts["leg_r"].rotation_euler.x = -swing
                # 脚掌抵消腿摆（保持脚底基准），再叠加 heel-to-toe 俯仰。
                parts["foot_l"].rotation_euler.x = -swing + roll
                parts["foot_r"].rotation_euler.x = swing - roll
                parts["arm_l"].rotation_euler.x = -swing * 0.55
                parts["arm_r"].rotation_euler.x = swing * 0.55
            elif pose == "reach_r":
                parts["arm_r"].rotation_euler.x = math.radians(-72)
                parts["arm_r"].rotation_euler.z = math.radians(-12)
                parts["torso"].rotation_euler.x = math.radians(4)
            elif pose == "place_r":
                parts["arm_r"].rotation_euler.x = math.radians(-55)
                parts["arm_r"].rotation_euler.z = math.radians(-22)
                parts["torso"].rotation_euler.x = math.radians(7)
            elif pose == "talk_idle":
                parts["head"].rotation_euler.z = math.sin(t * 2.0) * math.radians(4)
                parts["arm_l"].rotation_euler.x = math.radians(-5)
                parts["arm_r"].rotation_euler.x = math.radians(5)
            # 腿绕自身中心旋转会把脚抬离/压入地面：按实测最低脚抬骨盆，脚底回到 z=0。
            bpy.context.view_layer.update()
            deps = bpy.context.evaluated_depsgraph_get()
            zs = []
            feet_now = {}
            for side, leg, foot in (("L", "leg_l", "foot_l"), ("R", "leg_r", "foot_r")):
                ob = parts[leg].evaluated_get(deps)
                zs.extend((ob.matrix_world @ Vector(c)).z for c in ob.bound_box)
                fob = parts[foot].evaluated_get(deps)
                feet_now[side] = sum((fob.matrix_world @ Vector(c) for c in fob.bound_box), Vector((0, 0, 0))) / 8
            root.location = (x, y, -(min(zs) if zs else 0.0))
            # 支撑脚（几何最低那只）钉住世界坐标；漂移用骨盆反向补偿。
            if pose in ("walk", "run"):
                support = min(("L", "R"), key=lambda sd: feet_now[sd].z)
                anchor = plant_anchor[actor_id].get(support)
                if anchor is None:
                    plant_anchor[actor_id] = {support: (feet_now[support].x, feet_now[support].y)}
                else:
                    root.location = (
                        root.location.x - (feet_now[support].x - anchor[0]),
                        root.location.y - (feet_now[support].y - anchor[1]),
                        root.location.z,
                    )
            else:
                plant_anchor[actor_id] = {}
            # 补偿后再测一次最低点，防止把脚压进地面。
            bpy.context.view_layer.update()
            deps = bpy.context.evaluated_depsgraph_get()
            zs2 = []
            for leg in ("leg_l", "leg_r", "foot_l", "foot_r"):
                ob = parts[leg].evaluated_get(deps)
                zs2.extend((ob.matrix_world @ Vector(c)).z for c in ob.bound_box)
            if zs2 and min(zs2) < 0:
                root.location.z -= min(zs2)
            root.keyframe_insert("location", frame=frame)
            root.keyframe_insert("rotation_euler", frame=frame)
            for ob in parts.values():
                ob.keyframe_insert("rotation_euler", frame=frame)
    scene.frame_set(1)


def make_bag(prop, actors, blocking, fps, total_frames, coll):
    size = prop["size"]
    bag = add_box(f"PROP_{prop['id']}", (0, 0, 0), size, prop.get("role", "PROP"), coll)
    bag.rotation_mode = "XYZ"
    attach = prop.get("attach")
    if not attach:
        return bag
    actor_id = attach["actor"]
    hand = attach.get("hand", "R")
    offset = Vector(attach.get("offset", [0, 0, 0]))
    bag["pv_attach_actor"] = actor_id
    bag["pv_attach_hand"] = hand
    bag["pv_attach_offset"] = list(offset)
    root, parts, s = actors[actor_id]
    arm = parts["arm_r" if hand == "R" else "arm_l"]
    scene = bpy.context.scene
    last = Vector((0, 0, 0))
    for frame in range(1, total_frames + 1):
        t = (frame - 1) / fps
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        if prop.get("from", 0) <= t <= prop.get("to", 1e9):
            tip = arm.matrix_world @ Vector((0, 0, -0.26 * s))
            bag.location = tip + offset
            last = bag.location.copy()
        else:
            bag.location = last
        bag.keyframe_insert("location", frame=frame)
    scene.frame_set(1)
    return bag


# ---------------------------------------------------------------- cameras


def aspect_ratio(project):
    a = project.get("aspect", "16:9")
    w, h = [float(x) for x in a.split(":")]
    return w / h


def size_span(size, bbox):
    x0, y0, z0, x1, y1, z1 = bbox
    h = max(z1 - z0, 1e-6)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if size == "FS":
        return cx, cy, z0 + 0.50 * h, 0.95 * h
    if size == "LS":
        return cx, cy, z0 + 0.55 * h, 1.00 * h
    if size == "ELS":
        return cx, cy, z0 + 0.50 * h, 1.30 * h
    if size == "MLS":
        return cx, cy, z0 + 0.62 * h, 0.80 * h
    if size == "MS":
        return cx, cy, z0 + 0.78 * h, 0.55 * h
    if size == "MCU":
        return cx, cy, z0 + 0.85 * h, 0.45 * h
    if size == "CU":
        return cx, cy, z0 + 0.93 * h, 0.30 * h
    if size == "ECU":
        return cx, cy, z0 + 0.95 * h, 0.18 * h
    if size in ("OTS", "TWO"):
        return cx, cy, z0 + 0.72 * h, 0.80 * h
    if size == "INSERT":
        return cx, cy, (z0 + z1) / 2, max((z1 - z0) * 1.15, 0.25)
    return cx, cy, z0 + 0.5 * h, 0.95 * h


def subject_bbox(subjects, actors, bag_objs, blocking, t, fps=24):
    pts = []
    for sid in subjects:
        if sid in actors:
            root, parts, s = actors[sid]
            x, y = actor_pos_at(blocking, sid, t)
            height = blocking["actors"][sid]["height"]
            pts.append((x - 0.32, y - 0.32, 0.0))
            pts.append((x + 0.32, y + 0.32, height))
        elif sid in bag_objs:
            ob = bag_objs[sid]
            # 用 t 对应帧的真实包位置（包挂在手上，会随时间动）
            cur = bpy.context.scene.frame_current
            bpy.context.scene.frame_set(round(t * fps) + 1)
            bpy.context.view_layer.update()
            for c in ob.bound_box:
                p = ob.matrix_world @ Vector(c)
                pts.append((p.x, p.y, p.z))
            bpy.context.scene.frame_set(cur)
            bpy.context.view_layer.update()
        else:
            pts.append((0, 0, 0))
            pts.append((0.2, 0.2, 0.2))
    if not pts:
        return (0, 0, 0, 0, 0, 1)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    zs = [p[2] for p in pts]
    return (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))


def solve_camera(shot, project, blocking, actors, bag_objs, t, fps=24):
    bbox = subject_bbox(shot["subjects"], actors, bag_objs, blocking, t, fps)
    cx, cy, cz, span = size_span(shot["size"], bbox)
    lens = shot["lens_mm"]
    sensor_w = project.get("defaults", {}).get("sensor_mm", 36)
    sensor_h = sensor_w / aspect_ratio(project)
    fill = shot.get("framing", {}).get("fill", 0.8)
    d = span * lens / (sensor_h * fill)
    # 多人/横向铺开的主体：只按高度算距离会让画幅边缘的人出画，再按组宽度反算一次。
    group_w = max(bbox[3] - bbox[0], bbox[4] - bbox[1], 1e-6)
    d_w = group_w * lens / (sensor_w * fill)
    d = max(d, d_w)
    cam_cfg = shot.get("camera", {})
    az = math.radians(cam_cfg.get("azimuth_deg", 0))
    cam_h = cam_cfg.get("height", cz)
    direction = Vector((math.sin(az), -math.cos(az), 0))
    target = Vector((cx, cy, cz))
    dz = cam_h - cz
    if abs(dz) >= d:
        d = abs(dz) + 0.5
    dh = math.sqrt(max(d * d - dz * dz, 0.01))
    pos = target + direction * dh
    pos.z = cam_h
    return pos, target, d, span, fill, sensor_h


def create_camera(name, lens, sensor_w, coll):
    cam_data = bpy.data.cameras.new(f"CAMDATA_{name}")
    cam_data.lens = lens
    cam_data.sensor_width = sensor_w
    cam_data.sensor_fit = "HORIZONTAL"
    cam = bpy.data.objects.new(f"CAM_{name}", cam_data)
    coll.objects.link(cam)
    target = bpy.data.objects.new(f"TGT_{name}", None)
    target.empty_display_size = 0.15
    coll.objects.link(target)
    con = cam.constraints.new("TRACK_TO")
    con.target = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"
    return cam, target


def aim_with_roll(cam, target_vec, roll_rad):
    """
    让相机朝 target 看，并绕视线轴滚转。

    为什么不能用 rotation_euler / 父级 pivot：TRACK_TO 约束在**世界空间**完全决定朝向，
    这两者都会被覆盖（实测滚转 5° 后画面倾斜仍是 0.000°）。
    所以这里改用四元数手动朝向：指向目标 × 绕视线轴 roll。
    只有需要 roll 的镜头才这么做；其余镜头保留 TRACK_TO（更省、也便于人工在 Blender 里调）。
    """
    dirv = (Vector(target_vec) - cam.matrix_world.translation)
    if dirv.length < 1e-6:
        return
    dirv.normalize()
    q = dirv.to_track_quat("-Z", "Y")
    if abs(roll_rad) > 1e-9:
        roll_q = Matrix.Rotation(roll_rad, 4, dirv).to_quaternion()
        q = roll_q @ q
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = q


def ease_value(name, u):
    """把 0..1 的归一化时间映射成缓动后的 0..1。故意只做少量确定曲线，便于复现。"""
    t = max(0.0, min(1.0, u))
    if name in (None, "", "linear"):
        return t
    if name == "in_out":
        return t * t * (3.0 - 2.0 * t)  # smoothstep
    if name == "in":
        return t * t
    if name == "out":
        return 1.0 - (1.0 - t) * (1.0 - t)
    if name == "hold_in_out":
        # 前 20% 起势、后 20% 收势，中间匀速——甩镜/快推常用的“顿一下再走”
        a, b = 0.2, 0.8
        if t <= a:
            return (t / a) ** 2 * 0.15
        if t >= b:
            return 1.0 - ((1.0 - t) / (1.0 - b)) ** 2 * 0.15
        return 0.15 + 0.7 * ((t - a) / (b - a))
    return t


def handheld_noise(t_sec, freq_hz, seed, octaves=2):
    """
    按**秒**计的手持噪声：确定性、有种子、多倍频叠加。
    之前用归一化 u 驱动正弦，导致 3 秒镜头 2.43Hz、12 秒镜头 0.61Hz——
    同一套参数只因为镜头变长就变慢，等于“换了个摄影师”。
    """
    total = 0.0
    amp = 1.0
    norm = 0.0
    f = max(0.05, float(freq_hz))
    for i in range(max(1, octaves)):
        # 每个倍频用不同相位，避免两层完全同相叠成一条正弦
        ph = seed * (0.7 + 0.6 * i) + i * 1.9
        total += amp * math.sin(2.0 * math.pi * f * t_sec * (1.0 + 0.37 * i) + ph)
        norm += amp
        amp *= 0.55
    return total / max(norm, 1e-6)


def resolve_response(shot):
    """
    响应预设 → 具体参数。让“稳定器跟拍/行走手持”能一行启用，而不是每次手调六个数字。

    预设值是按物理量级估的（不是实拍标定）：稳定器越重、越稳，滞后与加速度限制越大；
    手持越轻，反应越快、抖动越直接。真实观感仍需实拍参照校准，这里只保证量级合理、可复现。
    """
    preset = ((shot.get("camera") or {}).get("response") or {}).get("preset")
    explicit = dict(((shot.get("camera") or {}).get("response") or {}))
    explicit.pop("preset", None)
    table = {
        # 稳定器：机身重、操作者跟得慢，但一旦动起来很顺
        "steadicam": {"pos_lag": 0.42, "aim_lag": 0.22, "pos_smooth": 0.55, "aim_smooth": 0.35,
                      "max_speed": 3.6, "max_accel": 5.5, "max_aim_speed": 4.0},
        # 安静手持：几乎不滞后，但加速度受限（人手的启停比机器干脆）
        "handheld_quiet": {"pos_lag": 0.05, "aim_lag": 0.04, "pos_smooth": 0.12, "aim_smooth": 0.10,
                           "max_speed": 6.0, "max_accel": 45.0, "max_aim_speed": 7.0},
        # 行走手持：位置跟着人走、瞄准略慢，有明显上下起伏
        "handheld_walk": {"pos_lag": 0.12, "aim_lag": 0.09, "pos_smooth": 0.25, "aim_smooth": 0.20,
                          "max_speed": 5.0, "max_accel": 28.0, "max_aim_speed": 6.0},
        # 奔跑手持：反应最快但抖动大，加速度限制放宽
        "handheld_run": {"pos_lag": 0.06, "aim_lag": 0.05, "pos_smooth": 0.10, "aim_smooth": 0.08,
                         "max_speed": 8.0, "max_accel": 70.0, "max_aim_speed": 9.0},
    }
    if not preset:
        return explicit
    base = dict(table.get(preset, {}))
    base.update(explicit)  # 显式参数覆盖预设
    return base


def make_operator_state():
    """操作响应层的状态：位置与朝向各自独立，各有上一帧值与上一帧速度。"""
    return {
        "pos": None,      # 上一帧相机位置（Vector）
        "pos_vel": None,  # 上一帧位置速度（Vector, m/s）
        "aim": None,      # 上一帧瞄准点（Vector）
        "aim_vel": None,  # 上一帧瞄准速度（Vector, m/s）
    }


def _smooth_toward(current, target, max_step):
    """把 current 朝 target 移动，单帧最多 max_step。"""
    delta = target - current
    dist = delta.length
    if dist <= max_step or dist < 1e-9:
        return target.copy(), delta / max(dist, 1e-9) * dist
    return current + delta.normalized() * max_step, delta.normalized() * max_step


def operator_response(ideal_pos, ideal_aim, state, resp, dt):
    """
    操作响应层的核心：把“理想机位/理想瞄准”变成“操作者实际能做到的机位/瞄准”。

    参数（都放在 shot.camera.response 下，全部可缺省）：
      pos_lag    位置滞后（秒）—— 带机身的重量感
      aim_lag    瞄准滞后（秒）—— 摄影师眼睛先到、机器后到
      pos_smooth 位置平滑 0..1（越大越黏）
      aim_smooth 瞄准平滑 0..1
      max_speed  位置速度上限（m/s）
      max_accel  位置加速度上限（m/s²）
      max_aim_speed 瞄准速度上限（m/s）

    位置和朝向分开处理是关键：真实跟拍里“人到了但构图还没跟上”和
    “构图先追上、机器还在滑行”是不同的观感，共用一个 lag 表达不了。

    返回 (pos, aim, state)。
    """
    resp = resp or {}
    dt = max(float(dt), 1e-6)

    def one(key, ideal, state_key, vel_key, lag_key, smooth_key, speed_key, accel_key=None):
        prev = state[state_key]
        if prev is None:
            state[state_key] = ideal.copy()
            state[vel_key] = Vector((0.0, 0.0, 0.0))
            return ideal.copy()
        # 滞后：用一阶近似把目标往“上一帧位置”拉
        lag = float(resp.get(lag_key, 0.0) or 0.0)
        target = ideal.copy()
        if lag > 0.0:
            alpha = min(1.0, dt / max(lag, 1e-6))
            target = prev + (ideal - prev) * alpha
        # 平滑：指数插值
        smooth = float(resp.get(smooth_key, 0.0) or 0.0)
        if smooth > 0.0:
            k = 1.0 - max(0.0, min(0.99, smooth))
            target = prev + (target - prev) * k
        # 速度上限
        max_speed = resp.get(speed_key)
        new_pos, step = _smooth_toward(prev, target, float(max_speed) * dt if max_speed else 1e9)
        # 加速度上限：限制本帧速度相对上一帧速度的变化
        if accel_key and resp.get(accel_key):
            prev_v = state[vel_key]
            want_v = step / dt
            max_dv = float(resp[accel_key]) * dt
            dv = want_v - prev_v
            if dv.length > max_dv and dv.length > 1e-9:
                want_v = prev_v + dv.normalized() * max_dv
                new_pos = prev + want_v * dt
                step = new_pos - prev
        state[state_key] = new_pos.copy()
        state[vel_key] = step / dt
        return new_pos

    new_pos = one("pos", ideal_pos, "pos", "pos_vel", "pos_lag", "pos_smooth", "max_speed", "max_accel")
    new_aim = one("aim", ideal_aim, "aim", "aim_vel", "aim_lag", "aim_smooth", "max_aim_speed")
    return new_pos, new_aim, state


def camera_orbit(shot, project, blocking, actors, bag_objs, t, fps, u, duration=None, t_sec=None):
    """
    通用运镜：以 solve_camera 的起始位为基准，按 move 参数生成随时间变化的机位。
    返回 (pos, target, dist, span, fill, sensor_h, roll_rad)。
    手持类用**绝对秒**驱动，不随镜长改变节奏。
    """
    pos0, target, dist0, span, fill, sensor_h = solve_camera(shot, project, blocking, actors, bag_objs, t, fps)
    move = shot.get("move", {}) or {}
    kind = move.get("type", "static")
    # 质感层：handheld/steadicam 可以单独用，也可以作为叠加层（move.feel）压在路径上。
    # 之前 handheld 和 dolly 共用单 type，二选一；现在“去哪”（path）和“谁来端机”（feel）分开。
    feel = move.get("feel") or {}
    if isinstance(feel, str):
        feel = {"type": feel}
    if feel.get("type") in ("handheld", "steadicam"):
        path_kind = move.get("path") or ("static" if kind in ("handheld", "steadicam") else kind)
    else:
        feel = {}
        path_kind = kind
    if path_kind == "static" and not feel:
        return pos0, target, dist0, span, fill, sensor_h, 0.0

    e = ease_value(move.get("ease", "in_out"), u)
    # 绝对秒数：优先用调用方传入的镜内秒数，否则按 u × 时长反推
    if t_sec is None:
        t_sec = (u * float(duration)) if duration else u
    roll_out = 0.0
    # 机位相对目标的方向与距离
    offset = pos0 - target
    if offset.length < 1e-6:
        offset = Vector((0.0, -1.0, 0.0))
    yaw0 = math.atan2(offset.y, offset.x)
    pitch0 = math.asin(max(-1.0, min(1.0, offset.z / max(offset.length, 1e-6))))
    radius = offset.length
    cam_height = pos0.z

    # 先算路径（去哪），再叠质感（怎么端）。kind 保持向后兼容。
    kind = path_kind
    if kind in ("dolly_in", "dolly_out"):
        # from/to 是距离倍率：1.0 = 原距离
        f = move.get("from", 1.0) + (move.get("to", 1.0) - move.get("from", 1.0)) * e
        radius *= f
    elif kind == "zoom":
        # zoom 不改机位，改焦距；这里返回原机位，上层逐帧改 lens
        return pos0, target, dist0, span, fill, sensor_h, 0.0
    elif kind == "pan":
        # 水平摇：绕目标转 degrees 度
        yaw0 += math.radians(move.get("degrees", 15.0)) * e
    elif kind == "tilt":
        # 垂直摇：围绕目标抬高/压低机位（保持半径），首尾朝向会明显变化
        pitch0 += math.radians(move.get("degrees", 10.0)) * e
    elif kind == "truck":
        # 平移：沿画面右方向移动 meters
        right = Vector((math.cos(yaw0), math.sin(yaw0), 0))
        pos0 = pos0 + right * move.get("meters", 0.5) * e
        return pos0, target, (pos0 - target).length, span, fill, sensor_h, 0.0
    elif kind == "pedestal":
        # 升降：直接改机位高度，同时保持水平半径（不走后面的 pitch 重算，否则高度会被覆盖）
        lift = move.get("meters", 0.3) * e
        return (
            Vector((pos0.x, pos0.y, pos0.z + lift)),
            target,
            dist0 + abs(lift) * 0.5,
            span,
            fill,
            sensor_h,
        )
    elif kind == "crane":
        # 大升降 + 轻微拉远，同样直接返回
        lift = move.get("meters", 1.0) * e
        out = 0.15 * e
        horiz = math.hypot(pos0.x - target.x, pos0.y - target.y) * (1.0 + out)
        dir_h = Vector((pos0.x - target.x, pos0.y - target.y, 0.0))
        if dir_h.length < 1e-6:
            dir_h = Vector((0.0, -1.0, 0.0))
        dir_h.normalize()
        new_pos = Vector((target.x + dir_h.x * horiz, target.y + dir_h.y * horiz, pos0.z + lift))
        return new_pos, target, (new_pos - target).length, span, fill, sensor_h, 0.0
    elif kind == "orbit":
        # 绕目标转圈，同时可带半径变化
        yaw0 += math.radians(move.get("degrees", 30.0)) * e
        radius *= 1.0 + move.get("dolly", 0.0) * e
    elif kind == "whip_pan":
        # 甩镜：前 35% 快速甩过，后段稳住。
        total = math.radians(move.get("degrees", 60.0))
        if u < 0.35:
            yaw0 += total * ease_value("out", u / 0.35)
        else:
            yaw0 += total
    elif kind == "handheld":
        # 手持：按赫兹计的多倍频噪声，节奏与镜长无关（3 秒和 12 秒的手抖速度一致）。
        src = feel if feel else move
        amp = math.radians(src.get("degrees", 0.4))
        hz = float(src.get("hz", 1.6))
        seed = float(src.get("seed", 1.0))
        # 步速耦合：走动/奔跑时机器跟着人一起颠，幅度和频率都上去。
        # 以前只有“放大 degree”这一个旋钮，跑起来还是同一条慢正弦。
        # 判据是主体真实移动速度（m/s），不依赖姿态标签，避免“写了字段但没读”。
        speed_gain = 1.0
        if src.get("follow_speed", True):
            try:
                sid = shot["subjects"][0]
                dt = 1.0 / max(fps, 1)
                x_now, y_now = actor_pos_at(blocking, sid, t)
                x_next, y_next = actor_pos_at(blocking, sid, t + dt)
                v = math.hypot(x_next - x_now, y_next - y_now) / dt  # m/s
                if v > 0.15:
                    speed_gain = 1.0 + min(v, 3.0) * 0.45
            except Exception:
                speed_gain = 1.0
        amp *= speed_gain
        hz *= 1.0 + (speed_gain - 1.0) * 0.6
        yaw0 += amp * handheld_noise(t_sec, hz, seed)
        pitch0 += amp * 0.7 * handheld_noise(t_sec, hz * 1.6, seed + 11.0)
        # 横滚：真实手持几乎不可能完全水平；单独给一个小幅度
        roll_out = math.radians(src.get("roll_degrees", 0.25)) * handheld_noise(t_sec, hz * 0.7, seed + 23.0)
    elif kind == "steadicam":
        # 稳定器：位移平滑跟随、朝向缓慢修正。抖动幅度远小于 handheld，
        # 且只作用在瞄准/朝向上，不制造位置抖动。
        src = feel if feel else move
        amp = math.radians(src.get("degrees", 0.12))
        hz = float(src.get("hz", 0.6))
        seed = float(src.get("seed", 3.0))
        yaw0 += amp * handheld_noise(t_sec, hz, seed)
        pitch0 += amp * 0.5 * handheld_noise(t_sec, hz * 1.3, seed + 5.0)
        roll_out = math.radians(src.get("roll_degrees", 0.1)) * handheld_noise(t_sec, hz * 0.5, seed + 9.0)
    elif kind == "static" and feel:
        # 纯叠加：路径不动，只加质感（相当于“原地手持/原地稳定器”）
        roll_out = 0.0
    else:
        return pos0, target, dist0, span, fill, sensor_h, 0.0

    # 叠加层：路径已算完，再把 feel 的抖动叠上去（不影响“去哪”，只影响“怎么端”）。
    if feel and path_kind not in ("handheld", "steadicam"):
        fsrc = feel
        famp = math.radians(fsrc.get("degrees", 0.4 if fsrc.get("type") == "handheld" else 0.12))
        fhz = float(fsrc.get("hz", 1.6 if fsrc.get("type") == "handheld" else 0.6))
        fseed = float(fsrc.get("seed", 1.0))
        yaw0 += famp * handheld_noise(t_sec, fhz, fseed)
        pitch0 += famp * 0.7 * handheld_noise(t_sec, fhz * 1.6, fseed + 11.0)
        roll_out = math.radians(fsrc.get("roll_degrees", 0.25 if fsrc.get("type") == "handheld" else 0.1)) * handheld_noise(
            t_sec, fhz * 0.7, fseed + 23.0
        )

    pitch0 = max(math.radians(-80.0), min(math.radians(80.0), pitch0))
    horizontal = radius * math.cos(pitch0)
    new_pos = Vector((
        target.x + horizontal * math.cos(yaw0),
        target.y + horizontal * math.sin(yaw0),
        target.z + radius * math.sin(pitch0),
    ))
    return new_pos, target, (new_pos - target).length, span, fill, sensor_h, roll_out


def build_cameras(project, shots, blocking, actors, bag_objs, fps, coll):
    cams = {}
    for shot in shots["shots"]:
        start = round(shot["in"] * fps) + 1
        t0 = shot["in"]
        bpy.context.scene.frame_set(start)
        # 取景距离按主主体算；多人镜头的横向覆盖由 solve_camera 的组宽度兜底。
        lead_id = shot.get("framing", {}).get("lead") or shot["subjects"][0]
        bbox = subject_bbox(shot["subjects"], actors, bag_objs, blocking, t0, fps)
        lead_bbox = subject_bbox([lead_id], actors, bag_objs, blocking, t0, fps)
        sensor_h = project.get("defaults", {}).get("sensor_mm", 36) / aspect_ratio(project)
        fill = shot.get("framing", {}).get("fill", 0.8)
        lead_shot = dict(shot)
        # 跟拍时用全组主体解距离：只按 lead 算，两人相距较远时同行的人会出画。
        lead_shot["subjects"] = list(shot["subjects"]) if shot.get("camera", {}).get("follow") else [lead_id]
        if shot["size"] == "OTS" and len(shot["subjects"]) >= 2 and all(s in actors for s in shot["subjects"][:2]):
            fg, bg = shot["subjects"][0], shot["subjects"][1]
            fx, fy = actor_pos_at(blocking, fg, t0)
            bx, by = actor_pos_at(blocking, bg, t0)
            d = Vector((bx - fx, by - fy, 0))
            if d.length < 1e-6:
                d = Vector((0, 1, 0))
            d.normalize()
            perp = Vector((-d.y, d.x, 0))
            pos = Vector((fx, fy, 0)) - d * 1.8 + perp * 1.25
            pos.z = shot.get("camera", {}).get("height", 1.55)
            target = Vector((bx, by, 1.3))
            dist = (pos - target).length
            cx, cy, cz, span = size_span("OTS", lead_bbox)
        else:
            pos, target, dist, span, fill, sensor_h = solve_camera(lead_shot, project, blocking, actors, bag_objs, t0, fps)
        cam, tgt = create_camera(shot["id"], shot["lens_mm"], project.get("defaults", {}).get("sensor_mm", 36), coll)
        cam.location = pos
        tgt.location = target
        follow = shot.get("camera", {}).get("follow")
        move = shot.get("move", {}) or {}
        move_kind = move.get("type", "static")
        end = round(shot["out"] * fps)
        # 是否要逐帧算：凡是有 follow、有非 static 路径、或带质感层（feel）的镜头都要。
        # 只看 move.type 会漏掉 {type:"static", path:"orbit", feel:{...}} 这种叠加写法——
        # 曾经因为这里只判 type，path 被静默忽略（travel=0）。
        _feel = move.get("feel")
        animated = bool(follow) or move_kind != "static" or bool(move.get("path")) or bool(_feel)
        if animated:
            actor_root = actors[follow["actor"]][0] if follow else None
            base = Vector((actor_root.location.x, actor_root.location.y, 0)) if actor_root else None
            cam_off = (pos - base) if base is not None else None
            tgt_off = (target - base) if base is not None else None
            base_shot = dict(shot)
            if follow:
                # 跟拍：相机以演员为基准整体平移；主主体换成了跟随对象也仍然按主演员取景
                pass
            # lag：跟拍滞后（秒）。人物先动，相机在 lag 秒后才到位，形成“跟得上但不即时”的操作感。
            follow_lag = float((follow or {}).get("lag", 0.0) or 0.0)
            # 记录人物历史位置，用于按 lag 回溯
            actor_history = {}
            shot_seconds = (end - start) / max(fps, 1)
            op_state = make_operator_state()
            # 预设/显式参数先解析一次（不随帧变化）
            response = resolve_response(shot)
            rolled = False
            for frame in range(start, end + 1):
                bpy.context.scene.frame_set(frame)
                u = (frame - start) / max(end - start, 1)
                t_sec = (frame - start) / max(fps, 1)
                if follow:
                    base_now = Vector((actor_root.location.x, actor_root.location.y, 0))
                    actor_history[frame] = base_now.copy()
                    if follow_lag > 0.0:
                        # 用 lag 秒前的演员位置当基准 —— 之前 lag 完全没被读取，配置是装饰
                        lag_frames = int(round(follow_lag * fps))
                        src = max(start, frame - lag_frames)
                        base_now = actor_history.get(src, base_now)
                    p2, t2, _d2, _s2, _f2, _sh2, _roll2 = camera_orbit(
                        dict(base_shot, subjects=shot["subjects"]), project, blocking, actors, bag_objs,
                        (frame - 1) / fps, fps, u, duration=shot_seconds, t_sec=t_sec,
                    )
                    cur_off = p2 - t2
                    ref = base_now + tgt_off
                    new_pos = ref + cur_off
                    new_target = ref
                else:
                    new_pos, new_target, _dist, _span, _fill, _sh, _roll2 = camera_orbit(
                        base_shot, project, blocking, actors, bag_objs, (frame - 1) / fps, fps, u,
                        duration=shot_seconds, t_sec=t_sec,
                    )
                # 操作响应层：把“理想机位/理想瞄准”变成“操作者实际能做到的”。
                # 支持只写 preset（如 steadicam），也支持显式参数覆盖。
                if response:
                    new_pos, new_target, op_state = operator_response(
                        Vector(new_pos), Vector(new_target), op_state, response, 1.0 / max(fps, 1)
                    )
                cam.location = new_pos
                tgt.location = new_target
                cam.keyframe_insert("location", frame=frame)
                tgt.keyframe_insert("location", frame=frame)
                # 横滚：TRACK_TO 在世界空间锁死朝向（euler/父级都会被覆盖，实测画面倾斜仍是 0°），
                # 所以一旦本镜需要 roll，就整段改用四元数手动朝向（避免中途 roll 归零导致“不再看目标”）。
                if abs(_roll2) > 1e-6 and not rolled:
                    con = next((c for c in cam.constraints if c.type == "TRACK_TO"), None)
                    if con is not None:
                        cam.constraints.remove(con)
                    rolled = True
                if rolled:
                    bpy.context.view_layer.update()
                    aim_with_roll(cam, new_target, _roll2)
                    cam.keyframe_insert("rotation_quaternion", frame=frame)
                # zoom：不改机位，改焦距（from/to 单位 mm；缺省用当前镜头值）
                if move_kind == "zoom":
                    lens_from = float(move.get("from", shot["lens_mm"]))
                    lens_to = float(move.get("to", lens_from * 1.5))
                    cam.data.lens = lens_from + (lens_to - lens_from) * ease_value(move.get("ease", "in_out"), u)
                    cam.data.keyframe_insert("lens", frame=frame)
            bpy.context.scene.frame_set(start)
        else:
            cam.location = pos
            tgt.location = target
        cams[shot["id"]] = (cam, tgt, {
            "start_frame": start,
            "end_frame": round(shot["out"] * fps),
            "distance": dist,
            "span": span,
            "fill_target": fill,
            "sensor_h": sensor_h,
            "camera_pos": list(cam.location),
            "target_pos": list(tgt.location),
            "framing_mode": "custom_ots" if shot["size"] == "OTS" and len(shot["subjects"]) >= 2 else "solve",
        })
    return cams


# ---------------------------------------------------------------- render


def set_render(project, res):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.film_transparent = False
    sc.render.fps = project.get("fps", 24)
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_cavity = True
    sh.show_object_outline = True
    sh.show_shadows = True
    sh.show_specular_highlight = False
    sh.background_type = "VIEWPORT"
    sh.background_color = (0.16, 0.16, 0.18)
    sc.display.render_aa = "8"


def render_shot(shot, cam, info, out_dir, shutter_samples=1, shutter_angle=0.5):
    sc = bpy.context.scene
    sc.camera = cam
    sc.frame_start = info["start_frame"]
    sc.frame_end = info["end_frame"]
    ensure_dir(out_dir)
    sc.render.filepath = os.path.join(out_dir, "f_")
    t = time.time()
    samples = max(1, int(shutter_samples or 1))
    if samples > 1:
        # 快门窗口：默认 0.5 帧（180°）。在 [t, t+angle) 内均匀取 samples 个亚帧，各渲一张；
        # 平均由 Node 侧用 ffmpeg 做（不在 Blender 里碰 pixels：实测会 EXCEPTION_ACCESS_VIOLATION）。
        angle = max(0.05, min(1.0, float(shutter_angle or 0.5)))
        tmp = os.path.join(out_dir, "_sub")
        ensure_dir(tmp)
        for frame in range(info["start_frame"], info["end_frame"] + 1):
            for k in range(samples):
                sub = (k / samples) * angle
                sc.frame_set(frame, subframe=sub)
                bpy.context.view_layer.update()
                # 文件名必须带帧号：之前只带 k，每帧互相覆盖，合成出来的是最后几帧
                sc.render.filepath = os.path.join(tmp, "s_%04d_%02d.png" % (frame, k))
                bpy.ops.render.render(write_still=True)
        sc.render.filepath = os.path.join(out_dir, "f_")
        log(f"shutter: {info['end_frame'] - info['start_frame'] + 1} frames x {samples} subsamples -> {tmp}（待外部合成）")
    else:
        bpy.ops.render.render(animation=True)
    frames = [f for f in os.listdir(out_dir) if f.startswith("f_") and f.endswith(".png")]
    frames.sort()
    if frames:
        mid = frames[len(frames) // 2]
        shutil.copyfile(os.path.join(out_dir, frames[0]), os.path.join(os.path.dirname(out_dir), "first.png"))
        shutil.copyfile(os.path.join(out_dir, mid), os.path.join(os.path.dirname(out_dir), "mid.png"))
        shutil.copyfile(os.path.join(out_dir, frames[-1]), os.path.join(os.path.dirname(out_dir), "last.png"))
    log(f"render {shot['id']}: {len(frames)} frames in {time.time() - t:.1f}s (samples={samples}) -> {out_dir}")


def render_plan(project, shots, cams, out_dir, plan_res):
    sc = bpy.context.scene
    # plan camera
    cam_data = bpy.data.cameras.new("CAMDATA_PLAN")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 12.0
    cam = bpy.data.objects.new("CAM_PLAN", cam_data)
    ensure_collection("PV_CAMERAS").objects.link(cam)
    cam.location = (0, 0, 12)
    cam.rotation_euler = (0, 0, 0)
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = plan_res
    sc.frame_start = 1
    sc.frame_end = 1
    sc.frame_set(1)
    sh = sc.display.shading
    sh.light = "FLAT"
    sh.color_type = "MATERIAL"
    sh.show_cavity = False
    sh.show_object_outline = True
    sh.show_shadows = False
    sh.show_specular_highlight = False
    sh.background_type = "VIEWPORT"
    sh.background_color = (0.96, 0.96, 0.96)
    guides = bpy.data.collections.get("PV_GUIDES")
    if guides:
        guides.hide_render = False
    sc.render.filepath = os.path.join(out_dir, "plan.png")
    bpy.ops.render.render(write_still=True)
    if guides:
        guides.hide_render = True
    log(f"plan -> {sc.render.filepath}")


# ---------------------------------------------------------------- facts


def ndc(sc, cam, p):
    co = world_to_camera_view(sc, cam, Vector(p))
    return [round(co.x, 4), round(co.y, 4), round(co.z, 4)]


# ---------------------------------------------------------------- P1 checks

SCREEN_DIRECTIONS = ("left_to_right", "right_to_left", "toward_camera", "away_from_camera", "hold")


def screen_ok(direction, dx, dz):
    if direction == "left_to_right":
        return dx > 0.03
    if direction == "right_to_left":
        return dx < -0.03
    if direction == "toward_camera":
        return dz < -0.03
    if direction == "away_from_camera":
        return dz > 0.03
    if direction == "hold":
        return abs(dx) <= 0.02 and abs(dz) <= 0.02
    return None


def axis_side(point, line):
    """返回有向轴线的右侧/左侧（p0→p1 的右手边为 right）。"""
    (x0, y0), (x1, y1) = line
    dx, dy = x1 - x0, y1 - y0
    if abs(dx) < 1e-9 and abs(dy) < 1e-9:
        return "on"
    cross = dx * (point.y - y0) - dy * (point.x - x0)
    if cross < -1e-6:
        return "right"
    if cross > 1e-6:
        return "left"
    return "on"


def object_owner(name, actors):
    for aid in actors:
        if name == f"ACT_{aid}" or name.startswith(f"{aid}_"):
            return "actor", aid
    if name.startswith("PROP_"):
        return "prop", None
    if name.startswith("SET_"):
        return "set", None
    return "other", None


def subject_aim(sid, actors, bag_objs):
    if sid in actors:
        return actors[sid][1]["head"].matrix_world.translation.copy()
    ob = bag_objs[sid]
    corners = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    return sum(corners, Vector((0, 0, 0))) / 8


def occlusion_at(sc, cam, sid, actors, bag_objs, allowed_actor=False):
    """相机到主体头/包中心的第一命中；自己的身体不算外部遮挡。"""
    deps = bpy.context.evaluated_depsgraph_get()
    origin = cam.evaluated_get(deps).matrix_world.translation.copy()
    target = subject_aim(sid, actors, bag_objs)
    delta = target - origin
    dist = delta.length
    if dist < 0.05:
        return {"visible": True, "blocker": None, "blocker_kind": None, "blocker_actor": None, "allowed": False}
    hit, loc, _normal, _index, ob, _matrix = sc.ray_cast(
        deps, origin, delta.normalized(), distance=max(dist - 0.02, 0.01)
    )
    if not hit or ob is None:
        return {"visible": True, "blocker": None, "blocker_kind": None, "blocker_actor": None, "allowed": False}
    kind, owner = object_owner(ob.name, actors)
    if owner == sid:
        return {"visible": True, "blocker": None, "blocker_kind": kind, "blocker_actor": owner, "allowed": False}
    if kind == "prop" and ob.name == f"PROP_{sid}":
        return {"visible": True, "blocker": None, "blocker_kind": kind, "blocker_actor": None, "allowed": False}
    allowed = bool(allowed_actor and kind == "actor" and owner and owner != sid)
    return {
        "visible": False,
        "blocker": ob.name,
        "blocker_kind": kind,
        "blocker_actor": owner,
        "allowed": allowed,
        "distance": round((loc - origin).length, 3),
    }


def collect_facts(project, shots, cams, blocking, actors, bag_objs, fps):
    sc = bpy.context.scene
    facts = {"scene": shots["scene"], "fps": fps, "axis": shots.get("axis"), "expected_frames": round(blocking["duration"] * fps), "shots": []}
    for shot in shots["shots"]:
        cam, tgt, info = cams[shot["id"]]
        sc.camera = cam
        sc.frame_start = info["start_frame"]
        sc.frame_end = info["end_frame"]
        # 运动端点：起始帧与结束帧的相机位置 + 朝向夹角（pan/tilt 主要改角度，位移很小）
        sc.frame_set(info["end_frame"])
        bpy.context.view_layer.update()
        _deps_end = bpy.context.evaluated_depsgraph_get()
        cam_end = cam.evaluated_get(_deps_end).matrix_world.translation.copy()
        move_delta = (cam_end - Vector(info["camera_pos"])).length
        sc.frame_set(info["end_frame"])
        bpy.context.view_layer.update()
        lens_end = round(float(cam.data.lens), 2)
        # 中段位置：ease 改的是过程曲线，首尾相同也必须能看出区别
        mid_frame = info["start_frame"] + (info["end_frame"] - info["start_frame"]) // 2
        sc.frame_set(mid_frame)
        bpy.context.view_layer.update()
        _deps_mid = bpy.context.evaluated_depsgraph_get()
        cam_mid = cam.evaluated_get(_deps_mid).matrix_world.translation.copy()
        sc.frame_set(info["start_frame"])
        bpy.context.view_layer.update()
        _deps_start = bpy.context.evaluated_depsgraph_get()
        fwd_start = (cam.evaluated_get(_deps_start).matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()
        sc.frame_set(info["end_frame"])
        bpy.context.view_layer.update()
        _deps_end2 = bpy.context.evaluated_depsgraph_get()
        fwd_end = (cam.evaluated_get(_deps_end2).matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()
        rot_deg = math.degrees(math.acos(max(-1.0, min(1.0, fwd_start.dot(fwd_end)))))
        entry = {
            "id": shot["id"],
            "beat": shot.get("beat"),
            "in": shot["in"],
            "out": shot["out"],
            "frames": info["end_frame"] - info["start_frame"] + 1,
            "size": shot["size"],
            "lens_mm": shot["lens_mm"],
            "move": (shot.get("move") or {}).get("type", "static"),
            "camera": {
                "pos": info["camera_pos"],
                "end": [round(v, 4) for v in cam_end],
                "mid": [round(v, 4) for v in cam_mid],
                "target": info["target_pos"],
                "distance": round(info["distance"], 3),
                "travel": round(move_delta, 4),
                "rotate_deg": round(rot_deg, 3),
                "lens_end": lens_end,
            },
            "fill_target": info["fill_target"],
            "framing_mode": info.get("framing_mode", "solve"),
            "fill_check": info.get("framing_mode", "solve") != "custom_ots",
            "subject_ids": list(shot["subjects"]),
            "subjects": {},
        }
        # 目标取景范围的 fill（不是头顶到脚底；MS/OTS 本来就会切脚）
        # 多人镜头按“主主体”（framing.lead 或第一个主体）算占幅；按组 bbox 算会把横向距离算进来而永远不达标。
        lead_id = shot.get("framing", {}).get("lead") or shot["subjects"][0]
        # fill 是“主主体占画面高度的比例”，所以量的是 lead 的 bbox，而不是全组。
        # 多人镜头相机距离会为组宽让步（否则边缘的人出画），此时 group fill 必然小于 0.7，
        # 用 lead 口径才和 fill_target 可比。
        bbox0 = subject_bbox([lead_id], actors, bag_objs, blocking, shot["in"], fps)
        cx, cy, cz, span = size_span(shot["size"], bbox0)
        sc.frame_set(info["start_frame"])
        bpy.context.view_layer.update()
        span_top = ndc(sc, cam, (cx, cy, cz + span / 2))
        span_bottom = ndc(sc, cam, (cx, cy, cz - span / 2))
        entry["frame_span"] = {
            "top": span_top,
            "bottom": span_bottom,
            "fill_actual": round(abs(span_top[1] - span_bottom[1]), 4),
            "measured_on": lead_id,
        }
        # 首/中/尾都采样：只查起点会漏掉“人走到画外”的镜头（镜尾出画但 QC 全绿）。
        mid_frame = info["start_frame"] + (info["end_frame"] - info["start_frame"]) // 2
        for tag, frame in (("start", info["start_frame"]), ("mid", mid_frame), ("end", info["end_frame"])):
            sc.frame_set(frame)
            bpy.context.view_layer.update()
            entry[tag] = {"frame": frame}
            for sid in shot["subjects"]:
                if sid in actors:
                    x, y = actor_pos_at(blocking, sid, (frame - 1) / fps)
                    height = blocking["actors"][sid]["height"]
                    head = ndc(sc, cam, (x, y, height))
                    feet = ndc(sc, cam, (x, y, 0.0))
                    entry[tag][sid] = {"head": head, "feet": feet, "floor_z": 0.0}
                elif sid in bag_objs:
                    ob = bag_objs[sid]
                    corners = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
                    zs = [p.z for p in corners]
                    mid = sum(corners, Vector((0, 0, 0))) / 8
                    entry[tag][sid] = {
                        "center": ndc(sc, cam, mid),
                        "top": ndc(sc, cam, (mid.x, mid.y, max(zs))),
                        "bottom": ndc(sc, cam, (mid.x, mid.y, min(zs))),
                    }
        # actual fill from first subject bbox head/feet at start
        sid0 = shot["subjects"][0]
        if sid0 in actors:
            d = entry["start"][sid0]
            entry["head_to_feet_fill"] = round(abs(d["head"][1] - d["feet"][1]), 4)
        elif sid0 in bag_objs:
            d = entry["start"][sid0]
            entry["head_to_feet_fill"] = round(abs(d["top"][1] - d["bottom"][1]), 4)

        # P1：屏幕方向（只检查显式声明的镜头；不替人做艺术判断）
        lead = shot.get("framing", {}).get("lead") or sid0
        a = entry["start"].get(lead, {})
        b = entry["end"].get(lead, {})
        pa = a.get("head") or a.get("center")
        pb = b.get("head") or b.get("center")
        direction = shot.get("screen_direction")
        if pa and pb:
            dx = pb[0] - pa[0]
            dz = pb[2] - pa[2]
            entry["screen"] = {"direction": direction, "dx": round(dx, 4), "dz": round(dz, 4), "ok": screen_ok(direction, dx, dz)}

        # P1：越轴（相机在轴线的哪一侧）；INSERT 不参与演员轴线检查
        axis_cfg = shots.get("axis") or {}
        line = axis_cfg.get("line")
        if line and all(s in actors for s in shot["subjects"]):
            deps = bpy.context.evaluated_depsgraph_get()
            sc.frame_set(info["start_frame"])
            bpy.context.view_layer.update()
            start_side = axis_side(cam.evaluated_get(deps).matrix_world.translation, line)
            sc.frame_set(info["end_frame"])
            bpy.context.view_layer.update()
            end_side = axis_side(cam.evaluated_get(deps).matrix_world.translation, line)
            expected = axis_cfg.get("side")
            ok = expected in (None, start_side) and expected in (None, end_side)
            entry["axis"] = {"expected": expected, "start_side": start_side, "end_side": end_side, "ok": ok}

        # P1：遮挡。OTS 里前景演员挡后景是允许的（allowed=true）；SET/PROP 遮挡一律算问题。
        entry["occlusion"] = []
        for tag, frame in (("start", info["start_frame"]), ("mid", info["start_frame"] + (info["end_frame"] - info["start_frame"]) // 2), ("end", info["end_frame"])):
            sc.frame_set(frame)
            bpy.context.view_layer.update()
            for sid in shot["subjects"]:
                entry["occlusion"].append({
                    "subject": sid,
                    "frame": frame,
                    "tag": tag,
                    **occlusion_at(sc, cam, sid, actors, bag_objs, allowed_actor=shot["size"] == "OTS"),
                })
        # P1：脚部接触。最低脚 z 必须在 [-0.02, 0.03]；走路的骨盆下沉已经补偿了摆腿抬脚。
        entry["feet"] = []
        for tag, frame in (("start", info["start_frame"]), ("mid", info["start_frame"] + (info["end_frame"] - info["start_frame"]) // 2), ("end", info["end_frame"])):
            sc.frame_set(frame)
            bpy.context.view_layer.update()
            deps = bpy.context.evaluated_depsgraph_get()
            for sid in shot["subjects"]:
                if sid not in actors:
                    continue
                _root, parts, _s = actors[sid]
                zs = []
                pitches = []
                for leg in ("leg_l", "leg_r", "foot_l", "foot_r"):
                    ob = parts[leg].evaluated_get(deps)
                    zs.extend((ob.matrix_world @ Vector(c)).z for c in ob.bound_box)
                for foot in ("foot_l", "foot_r"):
                    ob = parts[foot].evaluated_get(deps)
                    # 脚掌朝向的仰角：+Y 是脚尖方向；正值=脚尖上翘。
                    toe = ob.matrix_world.to_3x3() @ Vector((0, 1, 0))
                    pitches.append(math.degrees(math.atan2(toe.z, math.hypot(toe.x, toe.y))))
                entry["feet"].append({
                    "subject": sid,
                    "frame": frame,
                    "tag": tag,
                    "min_z": round(min(zs), 4),
                    "pitch_deg": round(max(pitches, key=abs), 2),
                })
        # P1：滑步测量。支撑脚=当前最低脚；支撑相（同一只脚连续为最低）内 world xy 漂移就是滑步。
        entry["foot_plant"] = []
        for frame in range(info["start_frame"], info["end_frame"] + 1):
            sc.frame_set(frame)
            bpy.context.view_layer.update()
            deps = bpy.context.evaluated_depsgraph_get()
            for sid in shot["subjects"]:
                if sid not in actors:
                    continue
                _root, parts, _s = actors[sid]
                cand = []
                for side, foot in (("L", "foot_l"), ("R", "foot_r")):
                    ob = parts[foot].evaluated_get(deps)
                    z = min((ob.matrix_world @ Vector(c)).z for c in ob.bound_box)
                    center = sum((ob.matrix_world @ Vector(c) for c in ob.bound_box), Vector((0, 0, 0))) / 8
                    cand.append((z, side, center))
                cand.sort(key=lambda x: x[0])
                z, side, pos = cand[0]
                entry["foot_plant"].append({
                    "subject": sid,
                    "frame": frame,
                    "side": side,
                    "x": round(pos.x, 4),
                    "y": round(pos.y, 4),
                    "z": round(z, 4),
                })
        facts["shots"].append(entry)
    return facts


def main():
    opts = parse_args()
    project_dir = os.path.abspath(opts["project"])
    out_dir = os.path.abspath(opts["out"])
    ensure_dir(out_dir)
    project = read_json(os.path.join(project_dir, "project.json"))
    set_data = read_json(os.path.join(project_dir, "set.json"))
    blocking = read_json(os.path.join(project_dir, "blocking.json"))
    shots = read_json(os.path.join(project_dir, "shots.json"))
    fps = project.get("fps", 24)
    res = tuple(int(x) for x in opts["res"].lower().split("x"))
    plan_res = tuple(int(x) for x in opts["plan_res"].lower().split("x"))

    clear_scene()
    set_render(project, res)
    sc = bpy.context.scene
    sc.frame_start = 1
    sc.frame_end = round(blocking["duration"] * fps)

    coll_set = ensure_collection("PV_SET")
    coll_cast = ensure_collection("PV_CAST")
    coll_props = ensure_collection("PV_PROPS")
    coll_cam = ensure_collection("PV_CAMERAS")
    coll_guides = ensure_collection("PV_GUIDES")

    build_set(set_data, coll_set)
    actors = {}
    for actor_id, a in blocking["actors"].items():
        actors[actor_id] = make_actor(actor_id, a["height"], coll_cast)
    total_frames = round(blocking["duration"] * fps)
    animate_actors(blocking, actors, fps, total_frames)

    bag_objs = {}
    for pr in blocking.get("props", []):
        bag_objs[pr["id"]] = make_bag(pr, actors, blocking, fps, total_frames, coll_props)

    cams = build_cameras(project, shots, blocking, actors, bag_objs, fps, coll_cam)

    # plan guides: camera frustums + actor path + labels
    for shot in shots["shots"]:
        cam, tgt, info = cams[shot["id"]]
        pos = Vector(info["camera_pos"])
        target = Vector(info["target_pos"])
        direction = target - pos
        direction.z = 0
        if direction.length < 1e-6:
            direction = Vector((0, 1, 0))
        direction.normalize()
        hfov = 2 * math.atan(36.0 / (2 * shot["lens_mm"]))
        frustum_len = min((target - pos).length, 2.2)
        wedge_target = pos + direction * frustum_len
        half_w = max(0.2, frustum_len * math.tan(hfov / 2))
        perp = Vector((-direction.y, direction.x, 0))
        left = wedge_target + perp * half_w
        right = wedge_target - perp * half_w
        mesh = bpy.data.meshes.new(f"GUIDE_{shot['id']}")
        mesh.from_pydata(
            [(pos.x, pos.y, 0.03), (left.x, left.y, 0.03), (right.x, right.y, 0.03)],
            [],
            [(0, 1, 2)],
        )
        ob = bpy.data.objects.new(f"GUIDE_{shot['id']}", mesh)
        ob.data.materials.append(get_special_mat("PLAN_CAM", PLAN_CAM_COLOR))
        coll_guides.objects.link(ob)
        add_text(f"LABEL_{shot['id']}", shot["id"], (pos.x, pos.y, 0.06), 0.22, coll_guides)

    for m in blocking.get("moves", []):
        add_path_curve(f"PATH_{m['actor']}", m["path"], coll_guides)

    coll_guides.hide_render = True

    # save before render
    blend_path = os.path.join(out_dir, f"{project['id']}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    log(f"blend -> {blend_path}")

    facts = collect_facts(project, shots, cams, blocking, actors, bag_objs, fps)
    with open(os.path.join(out_dir, "facts.json"), "w", encoding="utf-8") as fh:
        json.dump(facts, fh, indent=2, ensure_ascii=False)
    log(f"facts -> {os.path.join(out_dir, 'facts.json')}")

    mode = opts["mode"]
    only = {s.strip() for s in str(opts.get("only", "")).split(",") if s.strip()}
    target_shots = [s for s in shots["shots"] if not only or s["id"] in only]
    if only and not target_shots:
        raise SystemExit(f"--only 没有匹配到镜头：{sorted(only)}")
    if mode in ("all", "render"):
        for shot in target_shots:
            cam, tgt, info = cams[shot["id"]]
            render_shot(shot, cam, info, os.path.join(out_dir, shots["scene"], shot["id"], "review"),
                        shutter_samples=(project.get("defaults") or {}).get("shutter_samples", 1),
                        shutter_angle=(project.get("defaults") or {}).get("shutter_angle", 0.5))
    if mode in ("all", "plan"):
        render_plan(project, shots, cams, out_dir, plan_res)

    print("PREVIZ_DONE " + json.dumps({"out": out_dir, "shots": len(shots["shots"]), "rendered": [s["id"] for s in target_shots], "frames": total_frames}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
