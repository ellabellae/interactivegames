# Realistic heart (BodyParts3D)

`heart.glb` is the viewer's default "Realistic heart". It is built from
**BodyParts3D**, a 3D anatomy database of an adult human body published by the
Database Center for Life Science (DBCLS), Japan.

> BodyParts3D, © The Database Center for Life Science, licensed under
> CC Attribution-Share Alike 2.1 Japan.
> Mitsuhashi N, et al. BodyParts3D: 3D structure database for anatomical
> concepts. Nucleic Acids Res. 2009;37:D782-D785. doi:10.1093/nar/gkn613

## Licence

The files in this folder (`heart.glb`, `manifest.json`) are an adaptation of
BodyParts3D and are licensed under **CC BY-SA 2.1 JP**, the same terms as the
source. See [LICENSE](LICENSE). If you redistribute or modify them, keep the
credit above, say what you changed, and share your version under the same terms.

This licence covers the model files only, not the rest of this repository.

## Source

| | |
|---|---|
| Dataset | BodyParts3D 4.0, PART-OF tree, polygon mesh set |
| File | `partof_BP3D_4.0_obj_99.zip` from https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/ |
| SHA-256 | `9fbc713fffeee924a5a657d9813d84d7eb957bded63adb854931dd5e3eb61c97` |
| Piece list | `partof_element_parts.txt` from the same folder |

## Changes made

Made by [`scripts/build-heart-model.mjs`](../../../../scripts/build-heart-model.mjs):

- Selected the heart's element pieces and the nearby great vessels, and grouped
  them into 25 named parts (four chambers, four valves, papillary muscles,
  coronary arteries by branch, cardiac veins, great vessels). `manifest.json`
  lists exactly which source pieces went into each part.
- Trimmed the great vessels to 25 mm around the heart, and the pulmonary
  arteries and veins to 12 mm, since in the source they continue into the
  lungs and abdomen.
- Rotated from BodyParts3D axes (x = patient's left, y = posterior,
  z = superior) to the viewer's axes (y up, z toward the viewer). This is a
  rotation only, with no mirroring, so left and right are preserved.
- Welded duplicate vertices within each part and added smooth normals.

No shapes were edited by hand.

## Rebuilding

```bash
node scripts/build-heart-model.mjs /path/to/partof_BP3D_4.0_obj_99
```

The folder must also contain `partof_element_parts.txt` one level up (see the
comment at the top of the script).

## Known limits

- **Ventricles:** in this BodyParts3D set, the ventricles are modelled by
  their cavity surface. There is no separate ventricular wall (myocardium)
  piece, so the ventricles look slightly smaller than a heart with its full
  muscle wall. The atria are modelled by their wall.
- **One body:** this is one person's anatomy, not an average, and normal
  variation (for example coronary dominance) differs between people.
- **Conduction system:** BodyParts3D does not include the SA node, AV node,
  bundle of His or Purkinje fibres.
