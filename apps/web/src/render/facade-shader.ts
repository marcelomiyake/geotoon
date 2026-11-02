/**
 * GLSL injected into the building toon material. Walls carry a `facade` attribute (window
 * slot along the wall, metres below the wall top, slot width); the fragment shader paints
 * windows with white frames and an ink edge on each storey, and a light trim along the top
 * of the wall. Far away the windows fade into an average tone so they do not shimmer.
 */
export const FACADE_VERTEX_PARS = /* glsl */ `
attribute vec3 facade;
attribute vec3 facadeLayout;
varying vec3 vFacade;
varying float vBuildingY;
flat varying vec2 vWindowStyle;
`;

export const FACADE_VERTEX = /* glsl */ `
vFacade = facade;
vBuildingY = (modelMatrix * vec4(transformed, 1.0)).y - facadeLayout.x;
vWindowStyle = facadeLayout.yz;
`;

export const FACADE_FRAGMENT_PARS = /* glsl */ `
uniform vec3 glassColour;
uniform vec3 glassHighlight;
uniform vec3 frameColour;
uniform vec3 trimColour;
uniform vec3 inkColour;
uniform vec3 windowLightColour;
uniform float nightLights;
varying vec3 vFacade;
varying float vBuildingY;
flat varying vec2 vWindowStyle;

uniform vec4 windowDimensions[6];
uniform vec2 windowFrames[6];
const float MULLION_M = 0.035;
const float TRIM_M = 0.28;
const float TOP_MARGIN_M = 0.45;
`;

export const FACADE_FRAGMENT = /* glsl */ `
float windowGlow = 0.0;
if (vFacade.y >= 0.0) {
  int style = int(clamp(floor(vWindowStyle.x + 0.5), 0.0, 5.0));
  vec4 dimensions = windowDimensions[style];
  float storeyM = dimensions.x;
  float sillM = dimensions.y;
  float headM = dimensions.z;
  float frameM = windowFrames[style].x;
  float mullion = windowFrames[style].y;
  float pxY = max(fwidth(vBuildingY), 1e-4);
  vec3 wall = diffuseColor.rgb;
  float trim = 1.0 - smoothstep(TRIM_M - pxY, TRIM_M + pxY, vFacade.y);
  vec3 painted = mix(wall, trimColour, trim);
  if (vFacade.z > 0.0) {
    float slotWidth = vFacade.z;
    float pxX = max(fwidth(vFacade.x) * slotWidth, 1e-4);
    float px = max(pxX, pxY);
    float x = (fract(vFacade.x) - 0.5) * slotWidth;
    float halfWidth = min(dimensions.w, slotWidth * 0.36);
    float storey = floor(vBuildingY / storeyM);
    float y = vBuildingY - storey * storeyM;
    float wallTop = vBuildingY + vFacade.y;
    float fits = step(0.0, storey) * step(storey * storeyM + headM, wallTop - TOP_MARGIN_M);
    // No rows below the building datum, and no glass or distant glow below the first sill.
    float clearance = smoothstep(sillM, sillM + max(pxY, 0.03), vBuildingY);
    float edge = min(halfWidth - abs(x), min(y - sillM, headM - y));
    float inside = smoothstep(-px, px, edge) * fits * clearance;
    float frame = max(
      1.0 - smoothstep(frameM - px, frameM + px, edge),
      (1.0 - smoothstep(MULLION_M - pxX, MULLION_M + pxX, abs(x))) * step(0.5, mullion)
    );
    frame = max(frame, (1.0 - smoothstep(MULLION_M - pxY, MULLION_M + pxY,
      abs(y - (sillM + headM) * 0.5))) * step(1.5, mullion));
    float shine = fract((x + y) * 0.55 + vWindowStyle.y * 2.0);
    float streak = smoothstep(0.5, 0.53, shine) - smoothstep(0.66, 0.69, shine);
    float rise = clamp((y - sillM) / (headM - sillM), 0.0, 1.0);
    vec3 glass = mix(glassColour * (0.8 + vWindowStyle.y * 0.25), glassHighlight,
      clamp(rise * 0.45 + streak * 0.7, 0.0, 1.0));
    vec3 window = mix(glass, frameColour, frame);
    vec3 near = mix(painted, window, inside);
    float ink = (1.0 - smoothstep(0.0, 1.4 * px, abs(edge))) * fits * clearance;
    near = mix(near, inkColour, ink);
    vec3 far = mix(painted, mix(glassColour, frameColour, 0.3), 0.22 * fits * clearance);
    float detail = 1.0 - smoothstep(0.06, 0.2, px);
    painted = mix(far, near, detail);
    // The same glass mask keeps emission off frames, trim, walls and roofs.
    float random = fract(sin(dot(vec3(floor(vFacade.x), storey, vWindowStyle.y * 1000.0),
      vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float occupied = step(0.28, random) * (0.75 + random * 0.35);
    windowGlow = mix(0.11 * fits * clearance, inside * (1.0 - frame) * (1.0 - ink) * occupied, detail);
  }
  diffuseColor.rgb = painted;
}
`;

/** Applied after the stock emissive map so lit glass remains visible in shade. */
export const FACADE_EMISSION = /* glsl */ `
totalEmissiveRadiance += windowLightColour * nightLights * windowGlow;
`;
