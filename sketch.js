// =============================================================================
//  sketch.js  —  Main p5 sketch (feature-point morph)
// =============================================================================
//
//  This file stays deliberately small. All the morphing maths lives in
//  morph.js. Here we only:
//     • preload()   load the two bitmaps,
//     • setup()     create the canvas, the morpher and the slider,
//     • draw()      render the morph at the slider's position.
//
//  A slider scrubs between image A (0) and image B (1). The feature points are
//  hardcoded below: ptsA[i] on image A corresponds to ptsB[i] on image B.
// =============================================================================

let imgA, imgB;   // the two raw bitmaps
let morph;        // the Morph instance from morph.js
let slider;       // DOM slider that controls the morph position live

const IMG_W = 224;
const IMG_H = 128;

// Feature points, in image pixels. ptsA[i] on image A corresponds to ptsB[i] on
// image B (same index = same feature). The four image corners are added
// automatically by the Morph, so list only the interior features here.
let ptsA = [
  { x: 40,  y: 55 },   // head end
  { x: 110, y: 50 },   // middle-top
  { x: 110, y: 80 },   // middle-bottom
  { x: 180, y: 70 },   // tail end
];
let ptsB = [
  { x: 115, y: 25  },   // top tip
  { x: 100, y: 65  },   // mid-left
  { x: 130, y: 65  },   // mid-right
  { x: 115, y: 110 },   // bottom
];


function preload() {
  imgA = loadImage('2.png');   // caterpillar
  imgB = loadImage('1.png');   // cocoon
}


function setup() {
  createCanvas(IMG_W, IMG_H + 40);
  pixelDensity(1);
  noStroke();

  morph = new Morph(IMG_W, IMG_H);
  morph.setImages(imgA, ptsA, imgB, ptsB);

  // Slider scrubs the morph: createSlider(min, max, startValue, step).
  slider = createSlider(0, 1, 0.5, 0.01);
  slider.position(8, IMG_H + 10);
  slider.size(IMG_W - 16);
  slider.input(redraw);   // re-render only when the value actually changes

  // The morph is expensive to compute, so we don't run draw() 60x a second.
  // Instead we redraw() on demand: whenever the slider moves.
  noLoop();
}


function draw() {
  background(40);
  morph.setAmount(slider.value());
  image(morph.render(), 0, 0);   // the warped + dithered morph frame
}
