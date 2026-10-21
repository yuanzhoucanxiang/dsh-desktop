import bpy
import glob
import json
import math
import os
import sys

from mathutils import Vector

# 把相机轨迹的特征量化出来，用于"参照校准"：
#   - 抖动主频与幅度（原地观察：多余运动有多少）
#   - 位置峰值速度/加速度（启停重量）
#   - 构图滞后（相机到瞄准点的距离相对理想值偏离多少）
#   - 真横滚（asin(right.z)）
# 用法：blender -b -P measure-camera-feel.py -- --blend <path> 或 --dir <scenes root>


def args_after_dd():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1:]
    return []


def fcurves(action):
    if action is None:
        return []
    if hasattr(action, "fcurves"):
        try:
            return list(action.fcurves)
        except Exception:
            pass
    out = []
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            for bag in getattr(strip, "channelbags", []):
                out.extend(getattr(bag, "fcurves", []))
    return out


def zero_cross_hz(series, fps):
    if len(series) < 3:
        return 0.0
    mean = sum(series) / len(series)
    c = 0
    for i in range(1, len(series)):
        a = series[i - 1] - mean
        b = series[i] - mean
        if (a < 0) != (b < 0):
            c += 1
    seconds = len(series) / float(fps)
    return (c / 2.0) / seconds if seconds > 0 else 0.0


def measure(blend_path):
    bpy.ops.wm.open_mainfile(filepath=blend_path)
    sc = bpy.context.scene
    fps = float(sc.render.fps or 24)
    cam = next((o for o in bpy.data.objects if o.name.startswith("CAM_")), None)
    tgt = next((o for o in bpy.data.objects if o.name.startswith("TGT_")), None)
    if cam is None:
        return {"error": "no camera"}

    pos, aim, roll, tilt = [], [], [], []
    for f in range(sc.frame_start, sc.frame_end + 1):
        sc.frame_set(f)
        bpy.context.view_layer.update()
        m = cam.matrix_world
        pos.append(m.translation.copy())
        if tgt is not None:
            aim.append(tgt.matrix_world.translation.copy())
        rot = m.to_3x3()
        right = (rot @ Vector((1.0, 0.0, 0.0))).normalized()
        tilt.append(math.degrees(math.asin(max(-1.0, min(1.0, right.z)))))
        roll.append(math.degrees(m.to_euler().z))

    speeds, accels = [], []
    prev_v = None
    for i in range(1, len(pos)):
        v = (pos[i] - pos[i - 1]) * fps
        speeds.append(v.length)
        if prev_v is not None:
            accels.append((v - prev_v).length * fps)
        prev_v = v

    # 抖动量：位置相对"慢速趋势"的残差（用 9 帧滑动平均当趋势）
    jitter = []
    win = 9
    for i in range(len(pos)):
        lo = max(0, i - win // 2)
        hi = min(len(pos), i + win // 2 + 1)
        avg = sum(pos[lo:hi], Vector((0, 0, 0))) / (hi - lo)
        jitter.append((pos[i] - avg).length)
    # 抖动主频：用横向位移的残差序列估
    resid_x = []
    for i in range(len(pos)):
        lo = max(0, i - win // 2)
        hi = min(len(pos), i + win // 2 + 1)
        avgx = sum(p.x for p in pos[lo:hi]) / (hi - lo)
        resid_x.append(pos[i].x - avgx)

    result = {
        "blend": os.path.basename(blend_path),
        "blend_path": blend_path,
        "frames": len(pos),
        "seconds": round(len(pos) / fps, 2),
        "pos_max_speed": round(max(speeds), 3) if speeds else 0,
        "pos_mean_speed": round(sum(speeds) / len(speeds), 3) if speeds else 0,
        "pos_max_accel": round(max(accels), 2) if accels else 0,
        "jitter_mean_m": round(sum(jitter) / len(jitter), 4) if jitter else 0,
        "jitter_max_m": round(max(jitter), 4) if jitter else 0,
        "jitter_hz": round(zero_cross_hz(resid_x, fps), 2),
        "true_roll_abs_max_deg": round(max(abs(v) for v in tilt), 4),
        "travel_m": round((pos[-1] - pos[0]).length, 3),
    }
    if aim:
        dists = [(p - a).length for p, a in zip(pos, aim)]
        result["dist_to_aim_min"] = round(min(dists), 3)
        result["dist_to_aim_max"] = round(max(dists), 3)
        result["dist_to_aim_range"] = round(max(dists) - min(dists), 3)
    return result


argv = args_after_dd()
targets = []
for i, a in enumerate(argv):
    if a == "--blend" and i + 1 < len(argv):
        targets.append(argv[i + 1])
    elif a == "--dir" and i + 1 < len(argv):
        for b in glob.glob(os.path.join(argv[i + 1], "**", "*.blend"), recursive=True):
            targets.append(b)

if not targets:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    targets = glob.glob(os.path.join(os.environ.get("TEMP", "."), "previz-calib", "**", "*.blend"), recursive=True)

out = [measure(t) for t in targets]
print("FEEL_METRICS " + json.dumps(out, ensure_ascii=False))
