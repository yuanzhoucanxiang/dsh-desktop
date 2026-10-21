# 真实场景侧：从 .blend 抽出的抖动残差序列，看看它到底长什么样。
# 纯噪声模型偏差只有 3–5%，实测却 15–16%，说明真实序列里混进了别的东西。
import bpy
import json
import math
import glob
import os
import sys

from mathutils import Vector

root = os.path.join(os.environ["TEMP"], "previz-feel-presets")
out = {}
for preset in ("handheld_quiet", "handheld_walk", "handheld_run"):
    b = glob.glob(os.path.join(root, preset, "out", "*.blend"))
    if not b:
        continue
    bpy.ops.wm.open_mainfile(filepath=b[0])
    sc = bpy.context.scene
    fps = float(sc.render.fps or 24)
    cam = next((o for o in bpy.data.objects if o.name.startswith("CAM_")), None)
    tgt = next((o for o in bpy.data.objects if o.name.startswith("TGT_")), None)
    if cam is None or tgt is None:
        continue
    offs = []
    for f in range(sc.frame_start, sc.frame_end + 1):
        sc.frame_set(f)
        bpy.context.view_layer.update()
        offs.append(cam.matrix_world.translation.copy() - tgt.matrix_world.translation.copy())

    win = 13
    half = win // 2
    resid = []
    for i in range(len(offs)):
        lo = max(0, i - half)
        hi = min(len(offs), i + half + 1)
        avg = sum(offs[lo:hi], Vector((0, 0, 0))) / (hi - lo)
        resid.append(offs[i] - avg)

    xs = [r.x for r in resid]
    ys = [r.y for r in resid]
    zs = [r.z for r in resid]
    rms = lambda a: math.sqrt(sum(v * v for v in a) / max(len(a), 1))
    amp_x, amp_y, amp_z = rms(xs), rms(ys), rms(zs)
    # 主轴
    axis = "x" if amp_x >= max(amp_y, amp_z) else ("y" if amp_y >= amp_z else "z")
    series = {"x": xs, "y": ys, "z": zs}[axis]
    out[preset] = {
        "axis": axis,
        "rms_x_mm": round(amp_x * 1000, 3),
        "rms_y_mm": round(amp_y * 1000, 3),
        "rms_z_mm": round(amp_z * 1000, 3),
        "series_head": [round(v * 1000, 3) for v in series[:24]],
        "frames": len(series),
    }
print("RESID_SHAPE " + json.dumps(out, ensure_ascii=False))
