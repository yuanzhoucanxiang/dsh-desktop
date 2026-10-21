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

from mathutils import Vector
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

    parts["leg_l"] = parent(add_cylinder(f"{actor_id}_leg_l", (-0.11 * s, 0, 0.425 * s), 0.075 * s, 0.85 * s, "BODY", coll))
    parts["leg_r"] = parent(add_cylinder(f"{actor_id}_leg_r", (0.11 * s, 0, 0.425 * s), 0.075 * s, 0.85 * s, "BODY", coll))
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
    for frame in range(1, total_frames + 1):
        t = (frame - 1) / fps
        scene.frame_set(frame)
        for actor_id, (root, parts, s) in actors.items():
            x, y = actor_pos_at(blocking, actor_id, t)
            facing = actor_facing_at(blocking, actor_id, t)
            root.rotation_euler = (0, 0, math.radians(-facing))
            pose = actor_pose_at(blocking, actor_id, t)
            swing = 0.0
            if pose in ("walk", "run"):
                speed = 1.0
                m = move_of(blocking, actor_id)
                if m:
                    speed = m.get("speed", 1.0)
                phase = t * 2 * math.pi * (1.6 if pose == "walk" else 3.0) * max(0.6, speed)
                swing = math.sin(phase) * math.radians(30 if pose == "walk" else 45)
            # 先按地面放骨盆；摆腿后按实测最低脚把骨盆抬起，做简易 foot lock。
            root.location = (x, y, 0)
            for name, ob in parts.items():
                ob.rotation_euler = (0, 0, 0)
            if pose in ("walk", "run"):
                parts["leg_l"].rotation_euler.x = swing
                parts["leg_r"].rotation_euler.x = -swing
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
            for leg in ("leg_l", "leg_r"):
                ob = parts[leg].evaluated_get(deps)
                zs.extend((ob.matrix_world @ Vector(c)).z for c in ob.bound_box)
            root.location = (x, y, -min(zs) if zs else 0.0)
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


def build_cameras(project, shots, blocking, actors, bag_objs, fps, coll):
    cams = {}
    for shot in shots["shots"]:
        start = round(shot["in"] * fps) + 1
        t0 = shot["in"]
        bpy.context.scene.frame_set(start)
        bbox = subject_bbox(shot["subjects"], actors, bag_objs, blocking, t0, fps)
        sensor_h = project.get("defaults", {}).get("sensor_mm", 36) / aspect_ratio(project)
        fill = shot.get("framing", {}).get("fill", 0.8)
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
            cx, cy, cz, span = size_span("OTS", bbox)
        else:
            pos, target, dist, span, fill, sensor_h = solve_camera(shot, project, blocking, actors, bag_objs, t0, fps)
        cam, tgt = create_camera(shot["id"], shot["lens_mm"], project.get("defaults", {}).get("sensor_mm", 36), coll)
        cam.location = pos
        tgt.location = target
        follow = shot.get("camera", {}).get("follow")
        if follow:
            actor_root = actors[follow["actor"]][0]
            base = Vector((actor_root.location.x, actor_root.location.y, 0))
            cam_off = pos - base
            tgt_off = target - base
            end = round(shot["out"] * fps)
            move = shot.get("move", {})
            for frame in range(start, end + 1):
                bpy.context.scene.frame_set(frame)
                base_now = Vector((actor_root.location.x, actor_root.location.y, 0))
                u = (frame - start) / max(end - start, 1)
                factor = 1.0
                if move.get("type") in ("dolly_in", "dolly_out"):
                    factor = move.get("from", 1.0) + (move.get("to", 1.0) - move.get("from", 1.0)) * u
                cam.location = base_now + cam_off * factor
                tgt.location = base_now + tgt_off
                cam.keyframe_insert("location", frame=frame)
                tgt.keyframe_insert("location", frame=frame)
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


def render_shot(shot, cam, info, out_dir):
    sc = bpy.context.scene
    sc.camera = cam
    sc.frame_start = info["start_frame"]
    sc.frame_end = info["end_frame"]
    ensure_dir(out_dir)
    sc.render.filepath = os.path.join(out_dir, "f_")
    t = time.time()
    bpy.ops.render.render(animation=True)
    frames = [f for f in os.listdir(out_dir) if f.startswith("f_") and f.endswith(".png")]
    frames.sort()
    if frames:
        mid = frames[len(frames) // 2]
        shutil.copyfile(os.path.join(out_dir, frames[0]), os.path.join(os.path.dirname(out_dir), "first.png"))
        shutil.copyfile(os.path.join(out_dir, mid), os.path.join(os.path.dirname(out_dir), "mid.png"))
        shutil.copyfile(os.path.join(out_dir, frames[-1]), os.path.join(os.path.dirname(out_dir), "last.png"))
    log(f"render {shot['id']}: {len(frames)} frames in {time.time() - t:.1f}s -> {out_dir}")


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
    facts = {"scene": shots["scene"], "fps": fps, "axis": shots.get("axis"), "shots": []}
    for shot in shots["shots"]:
        cam, tgt, info = cams[shot["id"]]
        sc.camera = cam
        sc.frame_start = info["start_frame"]
        sc.frame_end = info["end_frame"]
        entry = {
            "id": shot["id"],
            "beat": shot.get("beat"),
            "in": shot["in"],
            "out": shot["out"],
            "frames": info["end_frame"] - info["start_frame"] + 1,
            "size": shot["size"],
            "lens_mm": shot["lens_mm"],
            "camera": {"pos": info["camera_pos"], "target": info["target_pos"], "distance": round(info["distance"], 3)},
            "fill_target": info["fill_target"],
            "framing_mode": info.get("framing_mode", "solve"),
            "fill_check": info.get("framing_mode", "solve") != "custom_ots",
            "subject_ids": list(shot["subjects"]),
            "subjects": {},
        }
        # 目标取景范围的 fill（不是头顶到脚底；MS/OTS 本来就会切脚）
        bbox0 = subject_bbox(shot["subjects"], actors, bag_objs, blocking, shot["in"], fps)
        cx, cy, cz, span = size_span(shot["size"], bbox0)
        sc.frame_set(info["start_frame"])
        bpy.context.view_layer.update()
        span_top = ndc(sc, cam, (cx, cy, cz + span / 2))
        span_bottom = ndc(sc, cam, (cx, cy, cz - span / 2))
        entry["frame_span"] = {
            "top": span_top,
            "bottom": span_bottom,
            "fill_actual": round(abs(span_top[1] - span_bottom[1]), 4),
        }
        for tag, frame in (("start", info["start_frame"]), ("end", info["end_frame"])):
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
                for leg in ("leg_l", "leg_r"):
                    ob = parts[leg].evaluated_get(deps)
                    zs.extend((ob.matrix_world @ Vector(c)).z for c in ob.bound_box)
                entry["feet"].append({
                    "subject": sid,
                    "frame": frame,
                    "tag": tag,
                    "min_z": round(min(zs), 4),
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
    if mode in ("all", "render"):
        for shot in shots["shots"]:
            cam, tgt, info = cams[shot["id"]]
            render_shot(shot, cam, info, os.path.join(out_dir, "S03", shot["id"], "review"))
    if mode in ("all", "plan"):
        render_plan(project, shots, cams, out_dir, plan_res)

    print("PREVIZ_DONE " + json.dumps({"out": out_dir, "shots": len(shots["shots"]), "frames": total_frames}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
