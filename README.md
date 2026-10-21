# Branding Studio

**Brand artwork on real packaging dielines, with photoreal 3D mockups.** Live at **https://bghryct.github.io/BrandingStudio/**

A browser-based studio for designing a brand across a product range: cans, glass bottles, perfume flacons, folding cartons, pouches, tubes, jar labels, tote bags, apparel, cups, mugs and stationery. Each product is a parametric dieline with correct panels, folds, glue flaps and bleed. You lay out artwork flat on the dieline with a full vector editor and see it on a three.js model of the product. Export print-ready PDFs with the die on named spot layers, SVG and PNG, stills, and MP4 / WebM / GIF animations.

Branding Studio is a sibling of [Book Design Studio](https://bghryct.github.io/BookDesignStudio/) and shares its typesetting engine, renderer, brushes, lighting rig and PDF writer.

Everything runs client-side, with no server, account or upload. Projects autosave in the browser (IndexedDB) and save as portable `.brand.json` files with images and fonts embedded, so the app is a static site you can host for free on GitHub Pages.

---

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`, which builds the site with Vite and publishes it to GitHub Pages (repository **Settings → Pages → Source: GitHub Actions**). The build uses relative asset paths (`base: './'` in `vite.config.ts`), so the same `dist/` also works on a custom domain or from a sub-folder of any static host.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build in dist/
npm run preview    # serve dist/
```

Node 20+ is recommended (CI uses Node 22).

---

## Products

All geometry is in points internally. Fields accept and display mm, cm, in, pt, pc or px. Every product has its own options panel (Product tab), a spec sheet and printed grounds, and a matching 3D model.

| Family | Template | What is modelled |
|---|---|---|
| Cans | Beverage can | 355 ml standard, 330 ml, 473 ml / 500 ml tall, 250 ml slim, 330 / 355 ml sleek. Body wrap with seam overlap, the printable band between the necks, white base coat or bare aluminium (inks print transparent over metal), gloss / satin / matte varnish, lid colour, condensation droplets. |
| Bottles | Glass bottle | Bordeaux, Burgundy, longneck, soda, spirits and apothecary profiles. Front, back and neck labels (the neck label unwraps as a true conical arc). Label shapes: rectangle, rounded, oval, arch, shield. Label stocks: white, cream, kraft, black, metallic, clear. Glass: flint, amber, green, blue, frosted, black. Optional liquid with colour and fill level. Capsule, crown, screw or cork closure. |
| Perfume | Perfume bottle | Rectangular, round and faceted flacons with an atomizer collar and a cube, cylinder, sphere, tall or faceted cap in gold, silver, black, white, wood, glass or colour. Decoration as a paper label, a screen print or an etched (frosted) mark. Front and optional back decoration. |
| Boxes | Tuck boxes | Reverse tuck end (RTE) and straight tuck end (STE) from length × width × depth. Glue flap, dust flaps, tuck flaps with lock shoulders, board caliper allowances. Boards: SBS, kraft, GC1, black, E-flute corrugated. Finishes: matte, gloss, soft-touch, uncoated. The 3D model folds up from the flat net. |
| | Mailer box | Roll-end-front-tuck mailer: double walls, lid with tuck and dust flaps, ears. |
| | Pillow box | Pillow box whose curved creases fold in to close the ends. |
| | Sleeve & tray | A printed sleeve on a sliding tray. |
| Packaging | Paper tube | Body wrap, lid wrap and a top disc, in kraft, white or black. |
| | Stand-up pouch | Front and back with a bottom gusset, zipper line and tear notch, on matte, gloss, kraft, metallised or black film. |
| | Jar label | Wrap label and lid label, with a gold, silver, black, white or wood lid and coloured contents. |
| Bags | Tote bag | Front and back print areas with gusset and handles, in cotton, canvas or jute, in any fabric colour. |
| | Paper carrier bag | SOS retail bag from W × G × H: glue flap, gussets with their centre crease, a turn-in top and folded base flaps, twisted rope or flat tape handles, in kraft, white or black paper. Folds up in 3D. |
| Apparel | T-shirt and hoodie | S–XL, front, back and left-sleeve print areas, fabric colour. Screen print, DTG or embroidery (raised thread relief). |
| | Cap | Front, side and back panels, brim colour, embroidery or print. |
| Drinkware | Coffee cup | 8, 12 and 16 oz conical wrap (it unwraps as an annular sector), white, kraft or black board, lid, optional sleeve. |
| | Mug | 11 or 15 oz wrap with handle side marked, glaze and inside colour, gloss or matte. |
| Stationery | Business card | EU, US, JP and square sizes, landscape or portrait, round corners, standard, thick or duplex board, coloured edge. |
| | Letterhead | A4 or US Letter on white, cotton, cream or kraft. |

Each dieline carries panels (with a role such as front, back, side, lid or band, a safe area and a reading direction), folds (score, perf, crease), glue zones, dimensions and a 3D net. Elements can be **anchored to a panel**, so they follow it when the product is resized.

## Editor

- A flat artwork editor on the dieline, with cut, fold, bleed, safe-area, glue and panel-name overlays (each toggleable) and every surface of a product on one canvas.
- Item types: text, images, shapes (rectangle, ellipse, polygon, star, triangle, arc, pill, burst, arch), rules, pen paths with Bézier handles and a node editor, linear and radial gradients plus soft mesh gradients, 16 generative patterns, natural-media brushes and eraser, live logos, EAN-13 / UPC-A barcodes with check digits, and imported SVG.
- Align and distribute, snapping to panels, folds, safe areas and other items, rulers and guides (`⌘;` show/hide, `⌥⌘;` lock), layers, blend modes, locking, copy and paste across products, undo and redo.
- Typesetting uses the Book Design Studio engine: Knuth–Plass line breaking, hyphenation, optical kerning, OpenType features, variable-font axes, paragraph and character styles, auto-fit to frame, and the brand tokens `{brand}`, `{tagline}` and `{product}`.
- Finishes per item: hot-foil (gold, silver, copper, holographic), spot UV, emboss, blind deboss and white underprint. They appear in 3D and print on their own spot plates.

## Brand kit

- **Logo**: a generated mark (monogram circle, arch, leaf, waves, sun, sparkle, drop, bolt, diamond) with lockup, stacked, wordmark, mark, badge and monogram variants, or your own uploaded SVG or PNG.
- **Palette**: named colours with HEX and CMYK builds and a spot reference. The nearest of about 70 Pantone-style approximations is suggested, and you can choose to print brand colours as spot separations.
- **Typefaces**: headline and body faces from 12 bundled open-licensed families, or your own fonts.
- **Apply the kit across the range**: recolour and re-font every product by palette and type role, or redesign every product from the kit.
- **Starter brands**: Citrus & Co. (sparkling water), Nordhavn (coffee roastery), Maison Lumière (perfume), Verdant (botanicals), Hopline (craft beer) and POP/KOLLEKTIV (streetwear), each with a kit, copy, a look and a product range.
- **Generative designer** (`src/engine/designer.ts`) lays out hero, back-of-pack (story, ingredients, barcode, web), side, lid and band panels for any product from the kit and copy, in several layouts (circle, band, frame, split, stack). Panels that read upside down on the net are designed upside down.
- **Brand board**: logo, palette with CMYK and spot values, type specimens and the whole range on one sheet, exported as PNG or SVG.

## 3D mockups (`src/three/`)

- Physically based materials: aluminium with a printed or bare-metal wrap (anisotropic grain, a spun anisotropic lid), refractive glass with a punt, a thick base and the drink inside with a meniscus, paper-backed labels; paperboard and kraft with fibre normal maps, cut edges and rounded creases, and gloss, matte, soft-touch and uncoated coatings that look different; pouches with crimped seals, a zipper bead and cut tear notches; fabric with jersey, fleece and canvas weave normal maps and sheen; foil (metalness), spot UV (clearcoat) and emboss / deboss (bump) driven from the artwork's finish masks.
- T-shirt, hoodie and tote are cloth-simulated in Blender (`tools/blender/cloth.py`), with the print areas mapped from the flat pattern. The garments hang on an invisible ghost-mannequin form with a body-deep chest (about 19–20 cm), hollow at the neck, cuffs and hem.
- Studio lighting from HDRIs baked in Blender (`tools/blender/studio_hdri.py` → `public/env`): soft studio, strip lights and daylight (or *Auto*, following the lighting preset), turned with the key light; Neutral, AgX or ACES tone mapping.
- Art is re-rasterised for the view as the camera comes closer (and before every still and video), so type stays sharp in close-ups. The camera cannot be zoomed into a product, and the clip planes hug the shot so nothing fights for depth.
- *Refreshing* for cans, bottles and cups: condensation (droplets of mixed sizes that refract the print and catch the highlights, frost haze, running drips; amount, size, frost, drips), ice cubes on the floor and a bed of crushed ice (Blender-made, `tools/blender/ice.py`), and a glass on set with cola, lager, juice, water or sparkling water and ice.
- Folding cartons are built from the dieline's hinge tree and fold up live (a Fold slider, or the *Fold up* animation).
- Lighting presets (studio, soft box, window, golden hour, dramatic, top-down, overcast, gallery, night) with key, warmth and exposure. Backdrops: studio sweep, solid, gradient, oak table, linen, concrete, paper, marble, felt or transparent. Contact shadows.
- Show one product or the whole range as a line-up. Orbit camera, reset, auto-framing for any aspect.
- Animations: turntable, hero orbit, roll in (cans and other cylinders), fold up (cartons), slide open (sleeve), open lid, card flip, sway, float, push in, *Pour* (the can or bottle tilts over the glass: a flowing stream, the level rising with a meniscus, bubbles, a foam head for beer, a splash) and *Fizz* (an idle beside the full glass), with speed, looping and a time scrubber; a Pour slider poses a mid-pour still.
- *Photo (path-traced)*: renders the current shot with [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) under the same HDRI, for real refraction through glass, drinks and ice, real water drops for condensation and soft studio shadows. It accumulates 32 to 1024 samples with progress, time left and Cancel. A guided filter then removes the remaining grain, using the albedo, normals and depth of the same view so print and type stay sharp. The live view stays rasterised. On an Apple M1 at 1600 × 1200 and 128 samples, a single product takes about 1.5 to 3 minutes; a pour or a can on crushed ice takes 5 to 7 minutes.
- Stills up to 4096 px (PNG with alpha on a transparent backdrop). Video renders frame by frame and encodes in the browser: MP4 (H.264 via WebCodecs with a MediaRecorder fallback), WebM (VP9 / VP8, with alpha where supported) and GIF, in landscape 3:2, wide 16:9, portrait 4:5, square or story 9:16.

## Export (`src/export/`)

- **Print PDF**: one page per surface with TrimBox and BleedBox, CMYK (palette builds preserved) or RGB, embedded and subset fonts or outlined text, and vector artwork wherever possible. The die is on Separation spot colours **CutContour**, **Fold** and **Glue**, each on its own optional-content layer. Dimensions, panel names and safe areas go on a non-printing *Info* layer. Foil, spot UV, emboss, deboss and white print on named spot plates, with optional brand-colour spots. Crop and bleed marks, registration, colour bars and a slug line.
- **SVG**: artwork, CutContour and Fold as separately named groups (layers in Illustrator, Affinity and Figma), with live or outlined text. **PNG** at any dpi, on white or transparent.
- **Project**: `.brand.json` with images and uploaded fonts embedded. Projects autosave to IndexedDB and restore on reload.

## Architecture

```
src/
  products/   parametric dielines: geom (polygons, offsets, cylinder/cone unwraps), cans, bottles,
              perfume, cartons, packaging, apparel, drinkware, stationery; index = registry + derived paths
  model/      project types, element factory, brand presets, defaults, brand operations (apply kit)
  engine/     fonts + text layout (Knuth–Plass), hyphenation, brushes, generators (patterns, logo,
              barcode, rules), the generative designer
  render/     element → display-list primitives (compile), SVG / Canvas backends, product textures,
              brand board
  three/      ProductScene, lighting, backdrop, contact shadow, finishing (composite PBR maps),
              material builders, animation timeline, one model module per product family
  export/     PDF (pdf-lib + fontkit, spot separations, OCG layers), SVG / PNG, video (WebCodecs, GIF)
  store/      zustand + immer store, undo history, IndexedDB autosave
  ui/         React UI: top bar, toolbar, canvas editor, panels, 3D viewer, brand board, dialogs
```

The same display list renders the SVG editor, the Canvas textures for 3D and PNG, and the PDF, so all three agree.

Stack: Vite 6, React 18, TypeScript (strict), Tailwind CSS v4, zustand + immer, three.js, three-gpu-pathtracer, pdf-lib + @pdf-lib/fontkit, mp4-muxer, webm-muxer, gifenc and lucide-react.

## Keyboard

| Key | Action |
|---|---|
| `V` `A` `T` `R` `E` `L` `P` | Select, node, text, rectangle, ellipse, line, pen |
| `B` `X` `I` `K` `G` `O` | Brush, eraser, image, pattern, gradient, logo |
| `H` / hold `Space`, `Z` | Hand, zoom |
| `[` `]` | Brush size |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⌘C` `⌘V` `⌘D` | Copy, paste, duplicate |
| `⌘]` `⌘[` (`⇧` to front/back) | Arrange |
| Arrows (`⇧` ×10) | Nudge |
| `⌘0` `⌘+` `⌘−` | Fit, zoom in, zoom out |
| `⌘;` / `⌥⌘;` | Show / lock guides |

## Fonts

The bundled fonts in `public/fonts` are under the SIL Open Font License 1.1 (licence texts alongside): Inter, Red Hat Display, Oswald, Space Grotesk, Syne, Bungee, Madimi One, Fraunces, EB Garamond, Cinzel, IBM Plex Mono and UnifrakturMaguntia. `scripts/fetch-fonts.sh` re-downloads them from the google/fonts repository (it needs `curl` and `fonttools`).

## Known limitations

- Pantone references are approximations for naming and proofing, not licensed colour data. Confirm spot colours with your printer.
- Dielines are accurate parametric templates for design and proofing. Check them against your converter's die before production.
- The bottle neck label is designed flat, and text on it is not set along the arc.
- Apparel and the tote use one cloth simulation per product (size M), scaled for other sizes and bag dimensions. The hoodie's shoulders are a little square.
- In the live view, liquids, glass and ice use three.js's screen-space transmission. Refraction is approximate, a glass shows what is behind it rather than a second, far wall, and ice on a white set reads more frosted than clear. *Photo* traces them properly.
- *Photo* runs on the GPU in the page. Glass and ice keep a little fine grain at 128 samples. Micro-relief normal maps (knit, weave, paper tooth) are left out of photos, because the tracer samples textures without mipmaps. three-gpu-pathtracer's WebGL renderer is pinned at 0.0.24: newer releases need three.js r185 and move to WebGPU.

## Licence

Apache License 2.0, see [LICENSE](LICENSE). Bundled fonts keep their own OFL licences.
