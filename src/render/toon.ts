import * as THREE from 'three';

// Shared pieces of the Brawl Stars-like look: banded toon lighting and thick dark outlines.

let gradientMap: THREE.DataTexture | null = null;

function getGradientMap(): THREE.DataTexture {
  if (gradientMap) return gradientMap;
  // Three light bands: shadow, mid, lit.
  const data = new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
  gradientMap = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

export function toon(color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: getGradientMap(), ...extra });
}

// --- See-through fade --------------------------------------------------------
// Walls in front of the player and bushes the player hides in are dithered
// out so the player never loses sight of their hand. Dithering keeps the
// meshes opaque, so instancing and draw order still just work.

export interface FadeUniforms {
  uFocus: { value: THREE.Vector3 };
  uViewDir: { value: THREE.Vector3 };
  uFadeRadius: { value: number };
  uFadeAmount: { value: number };
  uFadeMode: { value: number }; // 0 = fade what's between camera and focus, 1 = fade around focus
}

export function makeFadeUniforms(mode: 0 | 1, radius: number): FadeUniforms {
  return {
    uFocus: { value: new THREE.Vector3() },
    uViewDir: { value: new THREE.Vector3(0, -1, 0) },
    uFadeRadius: { value: radius },
    uFadeAmount: { value: 0 },
    uFadeMode: { value: mode },
  };
}

const FADE_PARS = /* glsl */ `
  varying vec3 vFadeWorld;
  uniform vec3 uFocus;
  uniform vec3 uViewDir;
  uniform float uFadeRadius;
  uniform float uFadeAmount;
  uniform int uFadeMode;
`;

const FADE_DISCARD = /* glsl */ `
  if (uFadeAmount > 0.0) {
    vec3 rel = vFadeWorld - uFocus;
    float d;
    bool inFront = true;
    if (uFadeMode == 0) {
      float along = dot(rel, -uViewDir);
      inFront = along > 0.2;
      d = length(rel + uViewDir * along);
    } else {
      d = length(rel.xz);
    }
    if (inFront && d < uFadeRadius) {
      float edge = smoothstep(uFadeRadius, uFadeRadius * 0.6, d) * uFadeAmount;
      vec2 p = floor(gl_FragCoord.xy);
      float dither = fract(dot(p, vec2(0.5, 0.25)) + 0.125 * mod(p.y, 2.0));
      if (dither < edge * 0.75) discard;
    }
  }
`;

const FADE_WORLD_POS = /* glsl */ `
  vec4 fadeWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fadeWorld = instanceMatrix * fadeWorld;
  #endif
  vFadeWorld = (modelMatrix * fadeWorld).xyz;
`;

export function addFade(material: THREE.Material, uniforms: FadeUniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFadeWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>\n${FADE_WORLD_POS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FADE_PARS}`)
      .replace('void main() {', `void main() {\n${FADE_DISCARD}`);
  };
  material.customProgramCacheKey = () => 'fade';
}

// --- Outlines ----------------------------------------------------------------

export function outlineMaterial(thickness = 0.035, color = 0x1a1422, fade?: FadeUniforms) {
  const fadeDefine = fade ? '#define USE_FADE\n' : '';
  return new THREE.ShaderMaterial({
    uniforms: {
      thickness: { value: thickness },
      color: { value: new THREE.Color(color) },
      ...(fade ?? {}),
    },
    vertexShader: /* glsl */ `
      ${fadeDefine}
      uniform float thickness;
      #ifdef USE_FADE
        varying vec3 vFadeWorld;
      #endif
      void main() {
        vec3 transformed = position + normal * thickness;
        vec4 local = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          local = instanceMatrix * local;
        #endif
        #ifdef USE_FADE
          vFadeWorld = (modelMatrix * local).xyz;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * local;
      }
    `,
    fragmentShader: /* glsl */ `
      ${fadeDefine}
      uniform vec3 color;
      #ifdef USE_FADE
        ${FADE_PARS}
      #endif
      void main() {
        #ifdef USE_FADE
          ${FADE_DISCARD}
        #endif
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.BackSide,
  });
}

/**
 * Adds an inverted-hull outline to a mesh. Geometry should have smooth normals
 * (rounded shapes) or the hull splits at hard edges.
 */
export function withOutline(mesh: THREE.Mesh, thickness = 0.035): THREE.Mesh {
  const hull = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness));
  hull.name = 'outline';
  mesh.add(hull);
  return mesh;
}
