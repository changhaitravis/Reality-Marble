#!/usr/bin/env python3
"""
gen_sphere_maps.py  –  Generates the four sphere-map PNGs for Reality Marble.

Physics: Snell's Law ray trace through a solid glass sphere (n=1.5).
  Orthographic camera at z=+∞, background at z=−∞, sphere at origin.

  For each pixel at normalised position (nx, ny) inside the unit disc (r ≤ 1):
    1.  N  = (nx, ny, pz)  where  pz = √(1−r²)   [surface normal, outward]
    2.  Refract incident ray (0,0,−1) at front surface (air→glass, n=1.5):
          cos_θi = pz,   cos_θt = √(1 − r²/n²)
          T  (refracted direction inside glass) via vector Snell's law
    3.  Ray exits sphere at  t_exit = 2·cos_θt  (closed-form result).
    4.  Refract at back surface (glass→air):
          By sphere symmetry, exit angle = entry angle  → exit ray direction l_exit.
    5.  Source sample angle  = l_exit_x / |l_exit_z|   (transverse / longitudinal)

  Background source coordinate: 0.5 + angle · FOV_SCALE
  FOV_SCALE = 0.45  → full source image visible within r ≈ 0.80 of the marble;
  the outer 20% rim fades via the Fresnel darkening overlay.

  The input image is pre-inverted (−flip −flop) before LUT sampling because a
  glass sphere inverts the transmitted image.  With pre-inversion the LUT samples
  in the same direction as the screen position (ratio l_exit_x/l_exit_z > 0 for
  screen_x > 0), correctly recovering background content from the flipped image.

Outputs (all SPHERE_SIZE × SPHERE_SIZE, 16-bit grey PNG):
  sphere_lutx_v3.png   – X source coordinate (R channel, value in [0,1])
  sphere_luty_v3.png   – Y source coordinate
  sphere_mask_v3.png   – circular alpha mask (white disc, soft edge)
  sphere_overlay_v3.png – lighting overlay (Fresnel + specular, for HardLight)

Usage:  python3 gen_sphere_maps.py <output_dir> <sphere_size>
"""

import sys
import os
import numpy as np
from PIL import Image, ImageFilter

def main():
    out_dir     = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
    SPHERE_SIZE = int(sys.argv[2]) if len(sys.argv) > 2 else 600
    FOV_SCALE   = 0.45
    N_GLASS     = 1.5

    S = SPHERE_SIZE
    # Pixel centres in [-0.5, 0.5] normalised space (sphere edge at 0.5)
    lin = (np.arange(S) + 0.5) / S - 0.5
    xx, yy = np.meshgrid(lin, lin)   # xx varies along columns, yy along rows

    # Normalised radius (0 → centre, 1 → sphere edge)
    r2 = 4.0 * (xx**2 + yy**2)          # r² in unit-disc coords
    r  = np.sqrt(r2)

    inside = r <= 1.0

    # Surface normal z  (= cos of incidence angle)
    pz = np.where(inside, np.sqrt(np.maximum(0.0, 1.0 - r2)), 0.0)

    # cos of refracted angle inside glass  (Snell: sin_t = r/n)
    ct = np.where(inside, np.sqrt(np.maximum(0.0, 1.0 - r2 / (N_GLASS**2))), 0.0)

    # Intermediate ray-tracing quantities
    A    =  2.0*pz/3.0 - ct          # = pz/n − ct  (n=1.5 → 2pz/3)
    Bfac =  1.5*ct - pz              # = n·ct − pz

    # z-component of exit ray:  n·Tz − Bfac·Pbz
    #   Tz   = −r²/n − pz·ct  →  n·Tz = −r2 − 1.5·pz·ct
    #   Pbz  = pz − 2·ct·(r²/n + pz·ct)
    lez = (-r2 - 1.5*pz*ct) - Bfac*(pz - 2.0*ct*(r2/1.5 + pz*ct))

    # x/y transverse components of exit ray
    #   lex = 2·xx·(n·A − Bfac·(1 + 2·ct·A))   (similarly ley with yy)
    factor = 1.5*A - Bfac*(1.0 + 2.0*ct*A)
    lex = 2.0 * xx * factor
    ley = 2.0 * yy * factor

    # Avoid divide-by-zero at exact centre (lez ≈ −1 there, safe)
    safe_lez = np.where(np.abs(lez) < 1e-9, -1.0, lez)

    src_x = np.where(inside, 0.5 + lex / safe_lez * FOV_SCALE, xx + 0.5)
    src_y = np.where(inside, 0.5 + ley / safe_lez * FOV_SCALE, yy + 0.5)

    # Clamp to [0, 1] so edge pixels don't wrap unexpectedly
    src_x = np.clip(src_x, 0.0, 1.0)
    src_y = np.clip(src_y, 0.0, 1.0)

    # Save as 16-bit greyscale PNG (full [0,1] range → [0, 65535])
    def save_lut(arr, path):
        img = Image.fromarray((arr * 65535).astype(np.uint16))
        img.save(path)

    save_lut(src_x, os.path.join(out_dir, 'sphere_lutx_v3.png'))
    save_lut(src_y, os.path.join(out_dir, 'sphere_luty_v3.png'))

    # ── Circular alpha mask ─────────────────────────────────────────────────
    # White disc with a 1.5px Gaussian soft edge (anti-aliased rim)
    mask = np.where(r <= 1.0, 255.0, 0.0).astype(np.float32)
    mask_img = Image.fromarray(mask.astype(np.uint8), mode='L')
    mask_img = mask_img.filter(ImageFilter.GaussianBlur(radius=1.5))
    mask_img.save(os.path.join(out_dir, 'sphere_mask_v3.png'))

    # ── Lighting overlay (for HardLight composite) ───────────────────────────
    # HardLight semantics: overlay < 0.5 → darkens, > 0.5 → brightens, 0.5 → neutral
    #
    # Components:
    #   Fresnel rim darkening:  0.5·(1 − r^5)  → 0.5 at centre, 0 at rim
    #   Specular highlight:     (N·H)^80
    #     Light  L ≈ (−0.28, −0.47, 0.84) [upper-left front]
    #     Half-vector H = normalise(L + V), V=(0,0,1) → H ≈ (−0.144,−0.192, 0.971)
    #     The specular spot appears at the position where N closest matches H.

    nx_ov = 2.0*(np.arange(S) + 0.5) / S - 1.0
    nxg, nyg = np.meshgrid(nx_ov, nx_ov)
    r2ov = nxg**2 + nyg**2
    nzov = np.sqrt(np.maximum(0.0, 1.0 - r2ov))

    # N·H  (H normalised half-vector, magnitude already 1)
    NdotH = nxg*(-0.144) + nyg*(-0.192) + nzov*0.971
    spec  = np.where(r2ov <= 1.0, np.power(np.maximum(0.0, NdotH), 80), 0.0)

    fresnel = np.where(r2ov <= 1.0, 0.5*(1.0 - np.power(r2ov, 2.5)), 0.0)

    overlay = np.clip(fresnel + spec, 0.0, 1.0)
    ov_img  = Image.fromarray((overlay * 255).astype(np.uint8), mode='L')
    ov_img.save(os.path.join(out_dir, 'sphere_overlay_v3.png'))

    print(f'Sphere maps written to {out_dir}  (size={S}x{S})', flush=True)

if __name__ == '__main__':
    main()
