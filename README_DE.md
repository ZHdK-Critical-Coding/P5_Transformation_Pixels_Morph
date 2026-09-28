# P5.js: Image Morph

[English](README.md)

Morpht eine Bitmap in eine andere. Ein Morph ist mehr als eine
Überblendung: Einander entsprechende Merkmale wandern von einem Bild zum
anderen (Warp), während die Pixel überblenden (Dissolve). Im Beispiel wird
aus einer Raupe (`2.png`) ein Kokon (`1.png`), dargestellt als geditherte
1-Bit-Schwarzweissgrafik; ein Schieberegler wechselt stufenlos zwischen den
beiden.

![Raupe ↔ Kokon](2.png)

## Installation

Voraussetzungen: ein Browser und eine Internetverbindung (p5.js wird von
einem CDN geladen). Der Sketch liest Bildpixel aus, was nur über HTTP
funktioniert – `index.html` direkt über `file://` zu öffnen geht nicht.

1. Den Ordner in Visual Studio Code öffnen und Live Server starten (in der
   Statusleiste auf **Go Live** klicken). Jeder andere statische Server geht
   auch, z. B. `python3 -m http.server` und dann `http://localhost:8000`.
2. Den Schieberegler unter dem Bild bewegen.

Bibliotheken: p5.js 1.9.4 (von jsDelivr, eingebunden in `index.html`).

## Coding-Hilfe

| Datei        | Aufgabe                                                        |
|--------------|----------------------------------------------------------------|
| `index.html` | Lädt p5.js (vom CDN), dann `morph.js` und `sketch.js`.         |
| `morph.js`   | Die Morph-Engine: Triangulation, Warp, Abtastung, Dithering.   |
| `sketch.js`  | Lädt die Bilder, erstellt den Schieberegler, zeichnet den Morph. |
| `1.png`      | Bild B – Kokon (224 × 128).                                    |
| `2.png`      | Bild A – Raupe (224 × 128).                                    |

- **`sketch.js` → `ptsA` / `ptsB`**: die Merkmalspunkte in Bildpixeln
  (0…223 × 0…127). `ptsA[i]` auf Bild A markiert dasselbe Merkmal wie
  `ptsB[i]` auf Bild B. Beide Arrays gleich lang halten und nur innere
  Punkte eintragen; die vier Ecken werden automatisch ergänzt.
- **`preload()` / `IMG_W` / `IMG_H`**: die beiden Bilder und ihre Grösse.
  Für andere Bilder die Dateinamen ändern, die Grösse anpassen und die
  Merkmalspunkte neu setzen.
- **`setup()` / `draw()`**: erstellen die Zeichenfläche, den `Morph` und den
  Schieberegler. Der Morph ist aufwendig zu berechnen, deshalb ist
  `noLoop()` gesetzt und `draw()` läuft nur, wenn der Regler bewegt wird;
  es übergibt den Reglerwert an `morph.setAmount()` und zeichnet
  `morph.render()`.
- **`morph.js` → `delaunay()`**: Delaunay-Triangulation
  ([Bowyer–Watson](https://en.wikipedia.org/wiki/Bowyer%E2%80%93Watson_algorithm))
  ohne externe Bibliothek. `Morph.retriangulate()` trianguliert die
  Mittelpunkte der A/B-Paare, damit alle Punktmengen dieselbe Topologie
  haben.
- **`Morph.render()` / `_rasterize()`**: interpoliert jeden Merkmalspunkt
  mit dem Morph-Wert `t` von A nach B. Für jedes Pixel jedes
  Zwischendreiecks finden
  [baryzentrische Koordinaten](https://de.wikipedia.org/wiki/Baryzentrische_Koordinaten)
  die passende Stelle in Dreieck A und B; beide Bilder werden dort
  abgetastet (`sampleLuma()`, bilinear) und mit `t` gemischt.
- **`floydSteinberg()`**: reduziert das Graustufenergebnis mit
  Fehlerdiffusion auf Schwarz und Weiss, für den gepunkteten Look.
