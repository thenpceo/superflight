import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';

/**
 * Filmic stack: soft bloom, fine grain, vignette, and a whisper of
 * chromatic aberration that intensifies during boost.
 */
export function createPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: Math.min(4, renderer.capabilities.maxSamples ?? 0),
  });
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({
    blendFunction: BlendFunction.ADD,
    mipmapBlur: true,
    luminanceThreshold: 0.62,
    luminanceSmoothing: 0.25,
    intensity: 0.85,
    radius: 0.72,
  });

  const chroma = new ChromaticAberrationEffect({
    offset: new THREE.Vector2(0.0008, 0.0005),
    radialModulation: true,
    modulationOffset: 0.28,
  });

  const grain = new NoiseEffect({ blendFunction: BlendFunction.COLOR_DODGE, premultiply: true });
  grain.blendMode.opacity.value = 0.055;

  const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.62 });

  composer.addPass(new EffectPass(camera, bloom, chroma, grain, vignette));

  const baseChroma = 0.0008;
  return {
    composer,
    /** speed-reactive tweaks */
    update(state) {
      const k = baseChroma + state.boost01 * 0.0028 + state.justBoosted * 0.004;
      chroma.offset.set(k, k * 0.6);
      bloom.intensity = 0.85 + state.boost01 * 0.5;
      vignette.darkness = 0.62 + state.boost01 * 0.16;
    },
  };
}
