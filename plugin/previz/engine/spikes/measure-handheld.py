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

    # 纯抖动分量：先减去低频趋势（滑动平均），只留高频残差。
    # 之前用"相对首帧偏移"，但 dolly 推近会系统性改变偏移，
    # 结果量到的是路径变化而不是抖动——四个质感预设的"抖动幅度"因此几乎一样。
    win = 13  # 约 0.55s @24fps，足够滤掉 dolly/跟拍这类慢变，又保留 0.5–3Hz 的手抖
    half = win // 2
    resid = []
    for i in range(len(offs)):
        lo = max(0, i - half)
        hi = min(len(offs), i + half + 1)
        avg = sum(offs[lo:hi], Vector((0, 0, 0))) / (hi - lo)
        resid.append(offs[i] - avg)
    dev = [r.length for r in resid]

    # 主频：用**自相关**估，而不是过零率。
    # 过零法会被多倍频噪声抬高（handheld_noise 第二层是 1.37×）：
    # steadicam 设定 0.55Hz 却测出 0.83Hz。自相关找周期性最强的时滞，更接近真实主频。
    def autocorr_hz(series, fps):
        """
        归一化自相关找主周期。

        未归一化的 sum(s[i]*s[i+lag])/(n-lag) 会偏向小 lag（样本更多、值更大），
        总是选中最小 lag —— steadicam 甚至测出 6Hz（超出搜索上限）。
        必须除以总能量做归一化，并找**第一个局部峰**而不是全局最大值。
        """
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
        best_lag = max(r, key=lambda k: r[k])
        return fps / float(best_lag), r[best_lag]

    # 横向 + 纵向残差各估一次，取幅度更大的那个轴（抖动主轴）
    ax_hz, ax_conf = autocorr_hz([r.x for r in resid], fps)
    ay_hz, ay_conf = autocorr_hz([r.y for r in resid], fps)
    amp_x = sum(abs(r.x) for r in resid) / len(resid)
    amp_y = sum(abs(r.y) for r in resid) / len(resid)
    if amp_x >= amp_y:
        hz, conf = ax_hz, ax_conf
    else:
        hz, conf = ay_hz, ay_conf
    # 信噪比门槛：自相关峰值太低说明抖动幅度接近数值噪声（如 steadicam 0.0009m），
    # 此时测出的频率不可信，宁可标成 None 也不报一个假数。
    # 频率可信度：自相关峰值高**不等于**频率对。
    # steadicam 抖动只有 0.0009m，残差主要是数值噪声，自相关在最短 lag 上高度自相似
    # （conf 0.886 但测出 6Hz = 搜索上限，是伪峰）。所以还要看幅度是否够大。
    amp_axis = max(amp_x, amp_y)
    MIN_AMP_FOR_FREQ = 0.002  # 2mm 以下测频率没有意义
    hz_confident = conf >= 0.25 and amp_axis >= MIN_AMP_FOR_FREQ
    # 保留过零法结果，便于对照"两种方法差多少"
    xs = [r.x for r in resid]
    c = 0
    for i in range(1, len(xs)):
        if (xs[i - 1] < 0) != (xs[i] < 0):
            c += 1
    secs = len(xs) / fps
    hz_zero = (c / 2.0) / secs if secs else 0

    return {
        "blend": os.path.basename(blend_path),
        "blend_path": blend_path,
        "frames": len(pos),
        "handheld_dev_mean_m": round(sum(dev) / len(dev), 4),
        "handheld_dev_max_m": round(max(dev), 4),
        "handheld_hz": round(hz, 2) if hz_confident else None,
        "hz_confidence": round(conf, 3),
        "hz_reliable": hz_confident,
        "hz_zero_cross": round(hz_zero, 2),
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
