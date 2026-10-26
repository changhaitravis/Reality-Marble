#!/usr/bin/env python3
"""
gen_sphere_maps.py  –  Generates the four sphere-map PNGs for Reality Marble.

Physics: Authentic optical ray deflection through a solid glass sphere (n=1.5).
  When an incident light ray enters a spherical ball lens at normalized radius r in [0, 1]:
    - Angle of incidence:   sin(θ₁) = r
    - Angle of refraction:  sin(θ₂) = r / n
    - Total ray deflection: Δθ = 2 * (arcsin(r) - arcsin(r / n))

  This provides authentic, smooth fisheye optical compression:
    - Magnifies and clarifies the center of the scene.
    - Smoothly compresses details toward the periphery.
    - Eliminates edge clamping, singularities, and streaking artifacts.

  Specular highlight flare: Completely eliminated to ensure the scene inside the
  transparent glass marble remains crystal clear and unobscured.

Outputs (all SPHERE_SIZE × SPHERE_SIZE, 16-bit grey PNG):
  sphere_lutx_v4.png   – X source coordinate (value in [0, 1])
  sphere_luty_v4.png   – Y source coordinate (value in [0, 1])
  sphere_mask_v4.png   – circular alpha mask (smooth anti-aliased edge)
  sphere_overlay_v4.png – lighting overlay (neutral 128: crystal clear glass, no glare)

Usage:  python3 gen_sphere_maps.py <output_dir> <sphere_size>
"""

import sys
import os
import numpy as np
from PIL import Image, ImageFilter

def main():
    out_dir     = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
    SPHERE_SIZE = int(sys.argv[2]) if len(sys.argv) > 2 else 600
    N_GLASS     = 1.5

    S = SPHERE_SIZE
    lin = (np.arange(S) + 0.5) / S - 0.5
    xx, yy = np.meshgrid(lin, lin)

    # Normalized radius u, v in [-1, 1], r in [0, 1]
    u = 2.0 * xx
    v = 2.0 * yy
    r = np.sqrt(u**2 + v**2)
    inside = r <= 1.0

    # Direction unit vector on unit disc
    safe_r = np.where(r < 1e-9, 1.0, r)
    u_hat = np.where(inside, u / safe_r, 0.0)
    v_hat = np.where(inside, v / safe_r, 0.0)

    # Exact Snell's deflection angle: Δθ(r) = 2 * (arcsin(r) - arcsin(r / n))
    theta_max = 2.0 * (np.pi / 2.0 - np.arcsin(1.0 / N_GLASS))
    theta = np.where(inside, 2.0 * (np.arcsin(np.clip(r, 0.0, 1.0)) - np.arcsin(np.clip(r / N_GLASS, 0.0, 1.0))), 0.0)
    r_src = theta / theta_max

    # Map smoothly to [0, 1] texture coordinates
    src_x = np.where(inside, 0.5 + 0.5 * u_hat * r_src, 0.5 + xx)
    src_y = np.where(inside, 0.5 + 0.5 * v_hat * r_src, 0.5 + yy)
    src_x = np.clip(src_x, 0.0, 1.0)
    src_y = np.clip(src_y, 0.0, 1.0)

    # Save 16-bit greyscale LUTs
    def save_lut(arr, path):
        img = Image.fromarray((arr * 65535).astype(np.uint16))
        img.save(path)

    save_lut(src_x, os.path.join(out_dir, 'sphere_lutx_v4.png'))
    save_lut(src_y, os.path.join(out_dir, 'sphere_luty_v4.png'))

    # ── Circular alpha mask ─────────────────────────────────────────────────
    # White disc with a smooth anti-aliased edge
    mask = np.where(r <= 1.0, 255.0, 0.0).astype(np.float32)
    mask_img = Image.fromarray(mask.astype(np.uint8), mode='L')
    mask_img = mask_img.filter(ImageFilter.GaussianBlur(radius=1.5))
    mask_img.save(os.path.join(out_dir, 'sphere_mask_v4.png'))

    # ── Lighting overlay (for HardLight composite) ───────────────────────────
    # Neutral 128 (0.5) composite ensures the transmitted image is completely
    # crystal clear with NO specular flare blinding/obfuscating the center.
    overlay = np.full((S, S), 128, dtype=np.uint8)
    ov_img  = Image.fromarray(overlay, mode='L')
    ov_img.save(os.path.join(out_dir, 'sphere_overlay_v4.png'))

    print(f'Sphere maps (v4) written to {out_dir} (size={S}x{S})', flush=True)

if __name__ == '__main__':
    main()
