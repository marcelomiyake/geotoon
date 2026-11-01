/**
 * GLSL injected into the building toon material. Walls carry a `facade` attribute (window
 * slot along the wall, metres below the wall top, slot width); the fragment shader paints
 * windows with white frames and an ink edge on each storey, and a light trim along the top
 * of the wall. Far away the windows fade into an average tone so they do not shimmer.
 */
export const FACADE_VERTEX_PARS = /* glsl */ `
attribute vec3 facade;
varying vec3 vFacade;
varying float vWorldY;
`;

export const FACADE_VERTEX = /* glsl */ `
vFacade = facade;
vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;
`;

export const FACADE_FRAGMENT_PARS = /* glsl */ `
uniform vec3 glassColour;
uniform vec3 glassHighlight;
uniform vec3 frameColour;
uniform vec3 trimColour;
uniform vec3 inkColour;
varying vec3 vFacade;
varying float vWorldY;

const float STOREY_M = 3.0;
const float SILL_M = 0.95;
const float HEAD_M = 2.3;
const float FRAME_M = 0.09;
const float MULLION_M = 0.035;
const float TRIM_M = 0.28;
const float TOP_MARGIN_M = 0.45;
`;

export const FACADE_FRAGMENT = /* glsl */ `
if (vFacade.y >= 0.0) {
  float pxY = max(fwidth(vWorldY), 1e-4);
  vec3 wall = diffuseColor.rgb;
  float trim = 1.0 - smoothstep(TRIM_M - pxY, TRIM_M + pxY, vFacade.y);
  vec3 painted = mix(wall, trimColour, trim);
  if (vFacade.z > 0.0) {
    float slotWidth = vFacade.z;
    float pxX = max(fwidth(vFacade.x) * slotWidth, 1e-4);
    float px = max(pxX, pxY);
    float x = (fract(vFacade.x) - 0.5) * slotWidth;
    float halfWidth = min(0.8, slotWidth * 0.28);
    float storey = floor(vWorldY / STOREY_M);
    float y = vWorldY - storey * STOREY_M;
    float wallTop = vWorldY + vFacade.y;
    float fits = step(storey * STOREY_M + HEAD_M, wallTop - TOP_MARGIN_M);
    float edge = min(halfWidth - abs(x), min(y - SILL_M, HEAD_M - y));
    float inside = smoothstep(-px, px, edge) * fits;
    float frame = max(
      1.0 - smoothstep(FRAME_M - px, FRAME_M + px, edge),
      1.0 - smoothstep(MULLION_M - pxX, MULLION_M + pxX, abs(x))
    );
    float shine = fract((x + y) * 0.55);
    float streak = smoothstep(0.5, 0.53, shine) - smoothstep(0.66, 0.69, shine);
    float rise = clamp((y - SILL_M) / (HEAD_M - SILL_M), 0.0, 1.0);
    vec3 glass = mix(glassColour, glassHighlight, clamp(rise * 0.45 + streak * 0.7, 0.0, 1.0));
    vec3 window = mix(glass, frameColour, frame);
    vec3 near = mix(painted, window, inside);
    float ink = (1.0 - smoothstep(0.0, 1.4 * px, abs(edge))) * fits;
    near = mix(near, inkColour, ink);
    vec3 far = mix(painted, mix(glassColour, frameColour, 0.3), 0.22 * fits);
    float detail = 1.0 - smoothstep(0.06, 0.2, px);
    painted = mix(far, near, detail);
  }
  diffuseColor.rgb = painted;
}
`;
