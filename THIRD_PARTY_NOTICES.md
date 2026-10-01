# Third-party code notices

The Oobleck VAE and SnakeBeta implementation in `modeling_vae.py` is derived
from stable-audio-tools commit `a6ae0cdf8b2eb1567a4b42ceadddec3712d99d45`.
The module hierarchy, weight normalization and activation equations preserve
the checkpoint's original inference implementation.

- Oobleck / stable-audio-tools: Copyright (c) 2023 Stability AI, MIT.
  Full text: `licenses/stable-audio-tools-MIT.txt`.
- SnakeBeta / BigVGAN: Copyright (c) 2022 NVIDIA CORPORATION, MIT.
  Full text: `licenses/SnakeBeta-NVIDIA-MIT.txt`.

These notices cover the identified source code and retain its original licenses.
The YuE2 model checkpoint weights are separately licensed under CC BY-NC 4.0;
see LICENSE for the scope and full terms. This does not relicense third-party code.

## Groove Box web pages (`docs/`)

- FluidSynth (compiled to WebAssembly by [fluidsynth-emscripten](https://github.com/jet2jet/fluidsynth-emscripten)):
  `docs/vendor/libfluidsynth-2.3.0-with-libsndfile.js`. Copyright (c) 2003-2022 Peter Hanappe and others,
  **LGPL v2.1**. Full text: `licenses/fluidsynth-LGPL-2.1.txt`. Shipped unmodified as a separate file, loaded at runtime.
- js-synthesizer 1.10.0: `docs/vendor/js-synthesizer.js`, `docs/vendor/js-synthesizer.worklet.js`.
  Copyright (c) 2018 jet, **BSD-3-Clause**. Full text: `licenses/js-synthesizer-BSD-3-Clause.txt`.
- `docs/vendor/groovebox-gm.sf3`: a subset (27 presets) of **FluidR3Mono_GM.sf3** as distributed with MuseScore 3.6.2,
  itself derived from Frank Wen's FluidR3 GM SoundFont, **MIT**. Full text: `licenses/FluidR3-MIT.txt`.
  Built with [spessasynth_core](https://github.com/spessasus/spessasynth_core) (Apache-2.0, not shipped).
