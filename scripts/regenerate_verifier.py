#!/usr/bin/env python3
"""Regenerate a Garaga Groth16 verifier constants file from a snarkjs verification_key.json.

The installed garaga Python CLI is broken in this environment (its `garaga_rs` Rust
extension fails to import). However, only TWO parts of the generated constants file
actually change when a circuit's public inputs change:

  - `N_PUBLIC_INPUTS`      = nPublic
  - `ic`                   = the IC coefficient points (length nPublic + 1)

The `vk` struct (alpha_beta_miller_loop_result, gamma_g2, delta_g2) and the
`precomputed_lines` array depend ONLY on the Groth16 trusted setup (alpha/beta/gamma/delta
from the ptau), which is unchanged across circuit edits. So we serialize the new `ic` and
copy the rest verbatim from the existing (already-correct) constants file.

Usage:
    python3 scripts/regenerate_verifier.py <vk.json> <existing_constants.cairo> <out_constants.cairo>
"""
import json
import re
import sys

MASK96 = (1 << 96) - 1


def limbs(v: int):
    return [v & MASK96, (v >> 96) & MASK96, (v >> 192) & MASK96, (v >> 288) & MASK96]


def serialize_g1(x: int, y: int) -> str:
    xl, yl = limbs(x), limbs(y)

    def u384(ls):
        return (
            "u384 {\n"
            f"            limb0: 0x{ls[0]:x},\n"
            f"            limb1: 0x{ls[1]:x},\n"
            f"            limb2: 0x{ls[2]:x},\n"
            f"            limb3: 0x{ls[3]:x},\n"
            "        }"
        )

    return f"    G1Point {{\n        x: {u384(xl)},\n        y: {u384(yl)},\n    }}"


def main() -> None:
    vk_path = sys.argv[1]
    existing_path = sys.argv[2]
    out_path = sys.argv[3]

    vk = json.load(open(vk_path))
    n_public = int(vk["nPublic"])
    ic_points = vk["IC"]  # list of [x, y, "1"] decimal strings

    ic_lines = [serialize_g1(int(p[0]), int(p[1])) for p in ic_points]
    ic_block = "pub const ic: [G1Point; %d] = [\n" % len(ic_points) + ",\n".join(ic_lines) + ",\n];"

    src = open(existing_path).read()

    # 1. replace N_PUBLIC_INPUTS
    src = re.sub(r"pub const N_PUBLIC_INPUTS: usize = \d+;", f"pub const N_PUBLIC_INPUTS: usize = {n_public};", src)

    # 2. replace the ic array (between 'pub const ic' and the closing '];' before precomputed_lines)
    src = re.sub(
        r"pub const ic: \[G1Point; \d+\] = \[.*?\n\];",
        ic_block,
        src,
        flags=re.DOTALL,
    )

    open(out_path, "w").write(src)
    print(f"Wrote {out_path}  (nPublic={n_public}, ic len={len(ic_points)})")


if __name__ == "__main__":
    main()
