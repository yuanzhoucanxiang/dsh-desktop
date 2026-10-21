# 诊断：分轴估频 vs 主轴估频，看偏差从哪来。
# 上一步发现：quiet 主轴是 z，walk/run 主轴是 x；而抖动噪声同时作用在 yaw(方位) 与 pitch(俯仰) 上，
# 映射到世界坐标会分散到 x/y/z 多轴。用"主轴"估频可能把两个不同频率的分量混在一起。
import bpy
import glob
import json
import math
import os

from mathutils import Vector


def autocorr_hz(series, fps):
    n = len(series)
    if n < 16:
        return 0.0, 0.0
    mean = sum(series) / n
    s = [v - mean for v in series]
    energy = sum(v * v for v in s)
    if energy <= 1e-12:
        return 0.0, 0.0
    min_lag = max(2, int(fps / 5.0))
    max_lag = min(n // 2, int(fps / 0.35))
    if max_lag <= min_lag + 1:
        return 0.0, 0.0
    r = {}
    for lag in range(min_lag, max_lag + 1):
        acc = 0.0
        for i in range(n - lag):
            acc += s[i] * s[i + lag]
        r[lag] = acc / energy
    for lag in range(min_lag + 1, max_lag):
        if r[lag] > r[lag - 1] and r[lag] >= r[lag + 1] and r[lag] > 0.05:
            return fps / float(lag), r[lag]
    best = max(r, key=lambda k: r[k])
    return fps / float(best), r[best]


root = os.path.join(os.environ["TEMP"], "previz-feel-presets")
EXPECTED = {"handheld_quiet": 1.15, "handheld_walk": 1.9, "handheld_run": 2.6}
out = {}
for preset in EXPECTED:
    b = glob.glob(os.path.join(root, preset, "out", "*.blend"))
    if not b:
        continue
    bpy.ops.wm.open_mainfile(filepath=b[0])
    sc = bpy.context.scene
    fps = float(sc.render.fps or 24)
    cam = next((o for o in bpy.data.objects if o.name.startswith("CAM_")), None)
    tgt = next((o for o in bpy.data.objects if o.name.startswith("TGT_")), None)
    offs = []
    tilts = []
    for f in range(sc.frame_start, sc.frame_end + 1):
        sc.frame_set(f)
        bpy.context.view_layer.update()
        offs.append(cam.matrix_world.translation.copy() - tgt.matrix_world.translation.copy())
        m = cam.matrix_world.to_3x3()
        r = (m @ Vector((1.0, 0.0, 0.0))).normalized()
        tilts.append(math.degrees(math.asin(max(-1.0, min(1.0, r.z)))))

    win = 13
    half = win // 2
    resid = []
    for i in range(len(offs)):
        lo = max(0, i - half)
        hi = min(len(offs), i + half + 1)
        avg = sum(offs[lo:hi], Vector((0, 0, 0))) / (hi - lo)
        resid.append(offs[i] - avg)

    roll_resid = []
    for i in range(len(tilts)):
        lo = max(0, i - half)
        hi = min(len(tilts), i + half + 1)
        avg = sum(tilts[lo:hi]) / (hi - lo)
        roll_resid.append(tilts[i] - avg)

    per_axis = {}
    for axis, idx in (("x", 0), ("y", 1), ("z", 2)):
        s = [r[idx] for r in resid]
        hz, conf = autocorr_hz(s, fps)
        rms = math.sqrt(sum(v * v for v in s) / len(s))
        per_axis[axis] = {"hz": round(hz, 2), "conf": round(conf, 2), "rms_mm": round(rms * 1000, 2)}

    hz_roll, conf_roll = autocorr_hz(roll_resid, fps)
    out[preset] = {
        "expected_hz": EXPECTED[preset],
        "per_axis": per_axis,
        "roll_hz": round(hz_roll, 2),
        "roll_conf": round(conf_roll, 2),
    }

print("AXIS_DIAG " + json.dumps(out, ensure_ascii=False))
