# Image Morph

A small [p5.js](https://p5js.org/) sketch that **morphs** one bitmap into another.
A morph is more than a fade: the geometry of matching features travels from one
image to the other (the **warp**) while the pixels cross-blend (the **dissolve**).
Drag the slider to scrub between the two pictures.

The example morphs a caterpillar (`2.png`) into a cocoon (`1.png`), rendered in
1-bit, Floyd–Steinberg-dithered black & white.

![caterpillar ↔ cocoon](2.png)

## Running it

The sketch loads images and reads their pixels, which browsers only allow over
HTTP — opening `index.html` directly from `file://` will **not** work. Start a
local server in this folder and open the printed URL:

```bash
python3 -m http.server
# then open http://localhost:8000
```

(Any static server works, e.g. the VS Code "Live Server" extension.)

## How it works

The two images carry matching **feature points**: `ptsA[i]` on image A marks the
same feature as `ptsB[i]` on image B (head, tail, tip, …). The four image corners
are added automatically by the engine so the whole frame is always covered.

For a morph amount `t` (0 = image A, 1 = image B) the pipeline is:

1. **Triangulate** — the feature points are connected into triangles with a
   built-in [Delaunay (Bowyer–Watson)](https://en.wikipedia.org/wiki/Bowyer%E2%80%93Watson_algorithm)
   triangulation. All three point sets (A, B, and the in-between) share one
   topology, so triangle `[i,j,k]` means the same thing everywhere.
2. **Warp + blend** — each in-between feature point is interpolated from A to B.
   For every pixel in each triangle, [barycentric coordinates](https://en.wikipedia.org/wiki/Barycentric_coordinate_system)
   locate the matching spot in triangle A and triangle B; both images are sampled
   there and cross-blended by `t`.
3. **Dither** — the grayscale result is reduced to black & white with
   Floyd–Steinberg error diffusion, for the stippled look.

## Files

| File         | Role                                                                 |
|--------------|----------------------------------------------------------------------|
| `index.html` | Loads p5.js (from CDN), then `morph.js` and `sketch.js`.             |
| `morph.js`   | The morph engine: Delaunay triangulation, triangle warp, luma sampling, dithering. |
| `sketch.js`  | The sketch: loads the images, sets up the slider, draws the morph.  |
| `1.png`      | Image B — cocoon (224 × 128).                                        |
| `2.png`      | Image A — caterpillar (224 × 128).                                   |

## Customizing

- **Feature points** — edit the hardcoded `ptsA` / `ptsB` arrays in `sketch.js`.
  Keep the two arrays the same length and matched by index. List only the
  interior features; the corners are added automatically. Coordinates are in
  image pixels (0…223 × 0…127).
- **Images** — replace `1.png` / `2.png` (or change the filenames in
  `preload()`). If you use a different size, update `IMG_W` / `IMG_H` in
  `sketch.js` and re-place the feature points.
