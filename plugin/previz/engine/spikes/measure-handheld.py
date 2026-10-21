import bpy
import glob
import json
import math
import os
import sys

from mathutils import Vector

# 关键校正：抖动必须测"相机相对理想位置的偏差"，而不是绝对位置残差。
# 跟拍时相机会跟着演员走，绝对位置的频谱里混的是演员的步态，不是手抖。
# 这里用"相机到瞄准点的偏移向量"与"首帧偏移"的差来近似手持分量。

def measure(blend_path):
    bpy.ops.wm.open_mainfile(filepath=blend_path)
    sc = bpy.context.scene
    fps = float(sc.render.fps or 24)
    cam = next((o for o in bpy.data.objects if o.name.startswith("CAM_")), None)
    tgt = next((o for o in bpy.data.objects if o.name.startswith("TGT_")), None)
    if cam is None or tgt is None:
        return {"error": "missing"}

    offs = []      # 相机 - 瞄准点（跟拍时这个向量接近常量，抖动会体现在它的变化上）
    tilts = []
    pos = []
    for f in range(sc.frame_start, sc.frame_end + 1):
        sc.frame_set(f)
        bpy.context.view_layer.update()
        p = cam.matrix_world.translation.copy()
        a = tgt.matrix_world.translation.copy()
        pos.append(p)
        offs.append(p - a)
        m = cam.matrix_world.to_3x3()
        r = (m @ Vector((1.0, 0.0, 0.0))).normalized()
        tilts.append(math.degrees(math.asin(max(-1.0, min(1.0, r.z)))))

    # 相对首帧偏移的偏差 = 纯手持分量
    base = offs[0]
    dev = [(o - base).length for o in offs]
    # 用偏移向量的水平角变化估主频
    xs = [(o - base).x for o in offs]
    meanx = sum(xs) / len(xs)
    c = 0
    for i in range(1, len(xs)):
        if ((xs[i - 1] - meanx) < 0) != ((xs[i] - meanx) < 0):
            c += 1
    secs = len(xs) / fps
    hz = (c / 2.0) / secs if secs else 0

    return {
        "blend": os.path.basename(blend_path),
        "blend_path": blend_path,
        "frames": len(pos),
        "handheld_dev_mean_m": round(sum(dev) / len(dev), 4),
        "handheld_dev_max_m": round(max(dev), 4),
        "handheld_hz": round(hz, 2),
        "offset_range_m": round(max(dev), 4),
        "true_roll_abs_max_deg": round(max(abs(v) for v in tilts), 4),
        "travel_m": round((pos[-1] - pos[0]).length, 3),
    }


argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
root = None
for i, a in enumerate(argv):
    if a == "--dir" and i + 1 < len(argv):
        root = argv[i + 1]
if root is None:
    root = os.path.join(os.environ.get("TEMP", "."), "previz-calib")

blends = sorted(glob.glob(os.path.join(root, "**", "*.blend"), recursive=True))
print("HANDHELD " + json.dumps([measure(b) for b in blends], ensure_ascii=False))
