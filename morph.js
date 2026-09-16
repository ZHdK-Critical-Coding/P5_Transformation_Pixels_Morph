// =============================================================================
//  morph.js  —  Feature-point image morphing (triangle warp + dithered blend)
// =============================================================================
//
//  WHAT THIS FILE DOES
//  -------------------
//  A "morph" is more than a fade between two pictures. It combines two effects
//  that happen at the same time:
//
//    1. WARP  (geometry) — matching features (a head, a tail, a tip) travel
//                          from where they sit in image A to where they sit in
//                          image B.
//    2. BLEND (colour)   — while the geometry travels, image A fades out and
//                          image B fades in.
//
//  Instead of a regular grid, here we mark a handful of FEATURE POINTS by hand.
//  ptsA[i] on image A "corresponds" to ptsB[i] on image B: same index = same
//  feature. The four image corners are always included so the whole frame is
//  covered.
//
//  HOW THE WARP IS DRAWN
//  ---------------------
//  We connect the points into TRIANGLES (Delaunay triangulation, implemented
//  below — no external library). The three point sets (A, B and the in-between
//  M) share ONE topology, so triangle [i,j,k] means the same thing in all three.
//
//  For a morph amount `t` (0 = fully A, 1 = fully B) we build the in-between
//  points M by lerping every feature point from A to B. Then, for each triangle:
//     • we walk every pixel inside its M (on-screen) version,
//     • use barycentric coordinates to find the matching spot in triangle A and
//       triangle B,
//     • sample both images there and cross-blend them by `t`.
//
//  The result is rendered in grayscale and 1-bit DITHERED (Floyd–Steinberg), to
//  match the stippled look of the source bitmaps.
// =============================================================================


// -----------------------------------------------------------------------------
//  Delaunay triangulation (Bowyer–Watson)
// -----------------------------------------------------------------------------
//
//  Given a list of points {x, y}, return triangles as index triples [i, j, k]
//  into that list. "Delaunay" just means it prefers fat, well-shaped triangles
//  over thin slivers — which warps cleanly.
//
//  Algorithm: start with one huge "super-triangle" that swallows every point.
//  Insert points one at a time; each insertion deletes the triangles whose
//  circumcircle contains the new point and re-fills the resulting hole. At the
//  end we throw away anything still touching the super-triangle.

function delaunay(points) {
  if (points.length < 3) return [];

  // A super-triangle large enough to contain all points with room to spare.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const span = Math.max(maxX - minX, maxY - minY) * 10 + 10;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const s0 = { x: cx - span, y: cy - span };
  const s1 = { x: cx + span, y: cy - span };
  const s2 = { x: cx,        y: cy + span };

  let tris = [makeTriangle(s0, s1, s2)];

  for (const p of points) {
    // 1. Triangles whose circumcircle contains p are now invalid.
    const bad = tris.filter(t => inCircumcircle(t, p));

    // 2. The hole's outline = edges that belong to exactly one bad triangle.
    const boundary = [];
    for (const t of bad) {
      for (const e of triangleEdges(t)) {
        const shared = bad.some(o => o !== t && hasEdge(o, e[0], e[1]));
        if (!shared) boundary.push(e);
      }
    }

    // 3. Remove the bad triangles and re-fill the hole, fanning out from p.
    tris = tris.filter(t => !bad.includes(t));
    for (const e of boundary) tris.push(makeTriangle(e[0], e[1], p));
  }

  // Drop every triangle still attached to a super-triangle corner...
  tris = tris.filter(t => !t.pts.some(v => v === s0 || v === s1 || v === s2));

  // ...and report the survivors as indices into the original point list.
  return tris.map(t => t.pts.map(v => points.indexOf(v)));
}

// Build a triangle and precompute its circumcircle (centre + squared radius).
function makeTriangle(a, b, c) {
  const ax = a.x, ay = a.y, bx = b.x, by = b.y, cx = c.x, cy = c.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  let ux, uy;
  if (Math.abs(d) < 1e-12) {            // degenerate (collinear) — fall back
    ux = (ax + bx + cx) / 3;
    uy = (ay + by + cy) / 3;
  } else {
    const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
    ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  }
  const r2 = (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy);
  return { pts: [a, b, c], cx: ux, cy: uy, r2 };
}

function inCircumcircle(t, p) {
  const dx = p.x - t.cx, dy = p.y - t.cy;
  return dx * dx + dy * dy <= t.r2 + 1e-9;
}

function triangleEdges(t) {
  const [a, b, c] = t.pts;
  return [[a, b], [b, c], [c, a]];
}

function hasEdge(t, p, q) {
  return t.pts.includes(p) && t.pts.includes(q);
}


// -----------------------------------------------------------------------------
//  Morph engine
// -----------------------------------------------------------------------------

// How far outside a triangle a pixel may sit and still count as inside, to
// absorb floating-point error on shared/border edges (in barycentric units).
const EDGE_EPS = 1e-6;

class Morph {
  /**
   * @param {number} w  Width of the morph image in pixels.
   * @param {number} h  Height of the morph image in pixels.
   */
  constructor(w, h) {
    this.w = w;
    this.h = h;

    this.amount = 0;        // current morph position, 0 = image A, 1 = image B

    this.imgA = null;       // p5.Image  (source bitmap)
    this.ptsA = null;       // corners + feature points on image A: [{x, y}, ...]
    this.imgB = null;       // p5.Image  (target bitmap)
    this.ptsB = null;       // corners + matching feature points on image B

    this.triangles = [];    // index triples shared by ptsA / ptsB / the morph

    this.out = createImage(w, h);     // the rendered (dithered) morph frame
    this.gray = new Float32Array(w * h); // scratch grayscale buffer, reused
  }

  /**
   * Register the two bitmaps with their matching feature points. Pass only the
   * interior features: the four image corners are always the picture borders, so
   * they are added automatically here. The two arrays MUST be the same length.
   */
  setImages(imgA, ptsA, imgB, ptsB) {
    this.imgA = imgA; this.ptsA = [...this._corners(), ...ptsA];
    this.imgB = imgB; this.ptsB = [...this._corners(), ...ptsB];
    imgA.loadPixels();   // sampleLuma() reads .pixels directly
    imgB.loadPixels();
    this.retriangulate();
  }

  /** The four image corners, shared by both images so the whole frame is covered. */
  _corners() {
    return [
      { x: 0,          y: 0          },
      { x: this.w - 1, y: 0          },
      { x: this.w - 1, y: this.h - 1 },
      { x: 0,          y: this.h - 1 },
    ];
  }

  /** Set how far along the morph we are. 0 = fully A, 1 = fully B (clamped). */
  setAmount(t) {
    this.amount = constrain(t, 0, 1);
  }

  /**
   * Build the shared triangle topology. We triangulate the MIDPOINTS of the
   * A/B point pairs, so the mesh is sensible for both extremes at once.
   */
  retriangulate() {
    if (!this.ptsA || !this.ptsB) return;
    const mids = this.ptsA.map((p, i) => ({
      x: (p.x + this.ptsB[i].x) / 2,
      y: (p.y + this.ptsB[i].y) / 2,
    }));
    this.triangles = delaunay(mids);
  }

  /**
   * Render the current morph state and return it as a p5.Image (w x h). Draw it
   * with image(morph.render(), x, y).
   */
  render() {
    if (!this.imgA || !this.imgB) return this.out;

    const t = this.amount;
    this.gray.fill(255);   // default = white, so any uncovered pixel matches the background

    // In-between feature points for this morph amount.
    const M = this.ptsA.map((p, i) => ({
      x: lerp(p.x, this.ptsB[i].x, t),
      y: lerp(p.y, this.ptsB[i].y, t),
    }));

    // Warp + blend, one triangle at a time.
    for (const tri of this.triangles) {
      this._rasterize(
        [M[tri[0]], M[tri[1]], M[tri[2]]],          // on-screen (destination)
        [this.ptsA[tri[0]], this.ptsA[tri[1]], this.ptsA[tri[2]]],  // sample A
        [this.ptsB[tri[0]], this.ptsB[tri[1]], this.ptsB[tri[2]]],  // sample B
      );
    }

    floydSteinberg(this.gray, this.w, this.h);

    // Copy the 1-bit grayscale buffer into the output image.
    this.out.loadPixels();
    for (let i = 0; i < this.w * this.h; i++) {
      const v = this.gray[i];
      const p = i * 4;
      this.out.pixels[p] = this.out.pixels[p + 1] = this.out.pixels[p + 2] = v;
      this.out.pixels[p + 3] = 255;
    }
    this.out.updatePixels();
    return this.out;
  }

  /**
   * Fill one triangle. We scan every pixel inside triM (the on-screen triangle),
   * find its barycentric weights, use those same weights to locate the matching
   * point inside triA and triB, sample both images there and blend by `amount`.
   * @private
   */
  _rasterize(triM, triA, triB) {
    const W = this.w, H = this.h, t = this.amount, gray = this.gray;

    const minX = Math.max(0,     Math.floor(Math.min(triM[0].x, triM[1].x, triM[2].x)));
    const maxX = Math.min(W - 1, Math.ceil (Math.max(triM[0].x, triM[1].x, triM[2].x)));
    const minY = Math.max(0,     Math.floor(Math.min(triM[0].y, triM[1].y, triM[2].y)));
    const maxY = Math.min(H - 1, Math.ceil (Math.max(triM[0].y, triM[1].y, triM[2].y)));

    const x0 = triM[0].x, y0 = triM[0].y;
    const x1 = triM[1].x, y1 = triM[1].y;
    const x2 = triM[2].x, y2 = triM[2].y;
    const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(denom) < 1e-9) return;   // zero-area triangle

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        // Barycentric weights of (x, y) inside triM.
        const w0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / denom;
        const w1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / denom;
        const w2 = 1 - w0 - w1;
        // Outside the triangle. The small tolerance keeps pixels that sit
        // exactly on a triangle edge (e.g. the image border, which lies on the
        // outer triangles' edges) from being dropped to rounding error and
        // left as stray specks.
        if (w0 < -EDGE_EPS || w1 < -EDGE_EPS || w2 < -EDGE_EPS) continue;

        // Same weights → matching spot in each source triangle.
        const ax = w0 * triA[0].x + w1 * triA[1].x + w2 * triA[2].x;
        const ay = w0 * triA[0].y + w1 * triA[1].y + w2 * triA[2].y;
        const bx = w0 * triB[0].x + w1 * triB[1].x + w2 * triB[2].x;
        const by = w0 * triB[0].y + w1 * triB[1].y + w2 * triB[2].y;

        gray[x + y * W] = lerp(
          sampleLuma(this.imgA, ax, ay),
          sampleLuma(this.imgB, bx, by),
          t,
        );
      }
    }
  }
}


// -----------------------------------------------------------------------------
//  Pixel helpers
// -----------------------------------------------------------------------------

// Bilinearly sample the brightness (luma) of an image at a fractional position.
function sampleLuma(img, x, y) {
  x = constrain(x, 0, img.width - 1);
  y = constrain(y, 0, img.height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, img.width - 1);
  const y1 = Math.min(y0 + 1, img.height - 1);
  const fx = x - x0, fy = y - y0;
  const l00 = lumaAt(img, x0, y0), l10 = lumaAt(img, x1, y0);
  const l01 = lumaAt(img, x0, y1), l11 = lumaAt(img, x1, y1);
  return (l00 * (1 - fx) + l10 * fx) * (1 - fy)
       + (l01 * (1 - fx) + l11 * fx) * fy;
}

function lumaAt(img, x, y) {
  const i = (x + y * img.width) * 4;
  return 0.299 * img.pixels[i] + 0.587 * img.pixels[i + 1] + 0.114 * img.pixels[i + 2];
}

// Floyd–Steinberg dithering: snap each pixel to black/white and push the
// rounding error into neighbours, so flat grays read as stippled patterns.
function floydSteinberg(buf, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      const old = buf[i];
      const next = old < 128 ? 0 : 255;
      buf[i] = next;
      const err = old - next;
      if (x + 1 < w)                buf[i + 1]     += err * 7 / 16;
      if (x - 1 >= 0 && y + 1 < h)  buf[i - 1 + w] += err * 3 / 16;
      if (y + 1 < h)                buf[i + w]     += err * 5 / 16;
      if (x + 1 < w && y + 1 < h)   buf[i + 1 + w] += err * 1 / 16;
    }
  }
}
