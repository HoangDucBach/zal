// WebGL2 renderer for the landing globe: a halftone dot sphere, transfer arcs with a travelling head, endpoint
// pulses and an atmosphere glow. Plain WebGL instead of three.js: the scene is four draw programs, and the whole
// module costs a few kilobytes where three.js would cost the landing page over a hundred.

import {
  PULSE_SECONDS,
  RIBBON_STRIDE,
  ROUTES,
  TRAIL,
  arcFrame,
  arcPoint,
  arcRibbon,
  dotGrid,
  liftFor,
  toVector,
  type Vec3,
} from "./geometry";

export type Rgb = readonly [number, number, number];

export interface GlobePalette {
  readonly accent: Rgb;
  readonly foreground: Rgb;
  readonly background: Rgb;
  /** Strength of the atmosphere, 1 on a dark page; a light page needs less or the glow washes the dots out. */
  readonly glow: number;
}

/** Where the sphere sits in the canvas, in CSS pixels. */
export interface GlobeLayout {
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly radius: number;
}

export interface Globe {
  /** Draws one frame at `seconds` of scene time. */
  readonly draw: (seconds: number) => void;
  readonly resize: (layout: GlobeLayout, pixelRatio: number) => void;
  readonly setPalette: (palette: GlobePalette) => void;
  readonly destroy: () => void;
}

const FOV = (28 * Math.PI) / 180;
const DISTANCE = 4;
/** The sphere's centre sits near the bottom edge, so the latitude facing the viewer is off screen; tilting it just
 * south of the equator puts the northern hemisphere's cities in the visible upper half. */
const TILT = (-12 * Math.PI) / 180;
/** One turn every 120 s: slow enough to read as calm, fast enough to see it move. */
const SPIN_PER_SECOND = (2 * Math.PI) / 120;
/** Longitude facing the viewer at t = 0: Europe and Africa, with Asia coming round. */
const START_LON = (-20 * Math.PI) / 180;
const DOT_STEP = 0.7;
const ARC_SEGMENTS = 64;

const DOT_VS = `#version 300 es
in vec3 aPos;
in float aLand;
uniform mat4 uMvp;
uniform mat4 uModel;
uniform float uScale;
uniform vec2 uOffset;
uniform float uPx;
out float vLand;
out float vFacing;
void main() {
  vec4 clip = uMvp * vec4(aPos * 1.003, 1.0);
  clip.xy = clip.xy * uScale + uOffset * clip.w;
  gl_Position = clip;
  vec3 n = normalize((uModel * vec4(aPos, 0.0)).xyz);
  vFacing = n.z;
  vLand = aLand;
  gl_PointSize = uPx * mix(1.3, 2.2, aLand) * (0.65 + 0.35 * max(n.z, 0.0));
}`;

const DOT_FS = `#version 300 es
precision highp float;
in float vLand;
in float vFacing;
uniform vec3 uLand;
uniform vec3 uSea;
out vec4 color;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float edge = 1.0 - smoothstep(0.55, 1.0, r);
  float limb = smoothstep(-0.05, 0.45, vFacing);
  float a = mix(0.07, 0.9, vLand) * edge * limb;
  color = vec4(mix(uSea, uLand, vLand) * a, a);
}`;

const SPHERE_VS = `#version 300 es
in vec3 aPos;
uniform mat4 uMvp;
uniform mat4 uModel;
uniform float uScale;
uniform vec2 uOffset;
out float vFacing;
void main() {
  vec4 clip = uMvp * vec4(aPos, 1.0);
  clip.xy = clip.xy * uScale + uOffset * clip.w;
  gl_Position = clip;
  vFacing = normalize((uModel * vec4(aPos, 0.0)).xyz).z;
}`;

const SPHERE_FS = `#version 300 es
precision highp float;
in float vFacing;
uniform vec3 uBackground;
uniform vec3 uAccent;
uniform float uGlow;
out vec4 color;
void main() {
  float rim = pow(1.0 - max(vFacing, 0.0), 3.0);
  color = vec4(mix(uBackground, uAccent, (0.02 + 0.16 * rim) * uGlow), 1.0);
}`;

const GLOW_VS = `#version 300 es
in vec2 aCorner;
uniform vec2 uCenter;
uniform vec2 uViewport;
uniform float uRadius;
out vec2 vPx;
void main() {
  vec2 px = uCenter + aCorner * uRadius * 1.6;
  vPx = px;
  gl_Position = vec4(px / uViewport * 2.0 - 1.0, 0.0, 1.0);
}`;

const GLOW_FS = `#version 300 es
precision highp float;
in vec2 vPx;
uniform vec2 uCenter;
uniform float uRadius;
uniform vec3 uAccent;
uniform float uGlow;
out vec4 color;
void main() {
  float d = length(vPx - uCenter) / uRadius;
  float outside = d > 1.0 ? pow(max(0.0, 1.0 - (d - 1.0) / 0.6), 2.4) * 0.26 : 0.0;
  float inside = d <= 1.0 ? pow(d, 8.0) * 0.18 : 0.0;
  float a = (outside + inside) * uGlow;
  color = vec4(uAccent * a, a);
}`;

const ARC_VS = `#version 300 es
in vec3 aPos;
in vec3 aNext;
in float aT;
in float aSide;
uniform mat4 uMvp;
uniform float uScale;
uniform vec2 uOffset;
uniform vec2 uViewport;
uniform float uWidth;
out float vT;
out float vSide;
vec4 place(vec3 p) {
  vec4 c = uMvp * vec4(p, 1.0);
  c.xy = c.xy * uScale + uOffset * c.w;
  return c;
}
void main() {
  vec4 a = place(aPos);
  vec4 b = place(aNext);
  vec2 sa = a.xy / a.w * uViewport;
  vec2 sb = b.xy / b.w * uViewport;
  vec2 dir = normalize(sb - sa + vec2(1e-6, 0.0));
  vec2 normal = vec2(-dir.y, dir.x);
  a.xy += normal * aSide * uWidth / uViewport * a.w;
  gl_Position = a;
  vT = aT;
  vSide = aSide;
}`;

const ARC_FS = `#version 300 es
precision highp float;
in float vT;
in float vSide;
uniform float uHead;
uniform float uPath;
uniform float uTrail;
uniform vec3 uAccent;
uniform vec3 uForeground;
out vec4 color;
void main() {
  float behind = uHead - vT;
  float trail = behind >= 0.0 && behind <= uTrail ? pow(1.0 - behind / uTrail, 1.6) : 0.0;
  float path = vT <= uHead ? 0.28 : 0.12;
  float a = max(trail, path * uPath) * (1.0 - smoothstep(0.45, 1.0, abs(vSide)));
  vec3 c = mix(uAccent, uForeground, trail * trail * 0.7);
  color = vec4(c * a, a);
}`;

const MARK_VS = `#version 300 es
in vec3 aPos;
in vec2 aSizeAlpha;
in float aRing;
uniform mat4 uMvp;
uniform float uScale;
uniform vec2 uOffset;
uniform float uPx;
out float vAlpha;
out float vRing;
void main() {
  vec4 clip = uMvp * vec4(aPos, 1.0);
  clip.xy = clip.xy * uScale + uOffset * clip.w;
  gl_Position = clip;
  gl_PointSize = aSizeAlpha.x * uPx;
  vAlpha = aSizeAlpha.y;
  vRing = aRing;
}`;

const MARK_FS = `#version 300 es
precision highp float;
in float vAlpha;
in float vRing;
uniform vec3 uAccent;
uniform vec3 uForeground;
out vec4 color;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  if (r > 1.0) discard;
  float core = 1.0 - smoothstep(0.18, 0.32, r);
  float halo = pow(1.0 - r, 2.0) * 0.55;
  float ring = smoothstep(0.78, 0.88, r) * (1.0 - smoothstep(0.9, 1.0, r));
  float a = (vRing > 0.5 ? ring : max(core, halo)) * vAlpha;
  vec3 c = vRing > 0.5 ? uAccent : mix(uAccent, uForeground, core);
  color = vec4(c * a, a);
}`;

function compile(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string,
): WebGLProgram {
  const program = gl.createProgram();

  for (const [type, source] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const shader = gl.createShader(type);

    if (shader === null) throw new Error("WebGL could not create a shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "program link failed");
  }

  return program;
}

type Mat4 = Float32Array;

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);

  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;

      for (let k = 0; k < 4; k++)
        sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      out[col * 4 + row] = sum;
    }
  }

  return out;
}

function rotationX(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  return Float32Array.of(1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1);
}

function rotationY(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  return Float32Array.of(c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1);
}

function viewProjection(aspect: number): Mat4 {
  const f = 1 / Math.tan(FOV / 2);
  const near = 0.1;
  const far = 10;
  // prettier-ignore
  const projection = Float32Array.of(
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  );
  const view = Float32Array.of(
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    -DISTANCE,
    1,
  );

  return multiply(projection, view);
}

/** NDC half-height of the sphere's silhouette before scaling. */
const SILHOUETTE =
  (1 / Math.tan(FOV / 2)) * (1 / Math.sqrt(DISTANCE * DISTANCE - 1));

function sphereMesh(
  rings: number,
  segments: number,
): { positions: Float32Array; indices: Uint16Array } {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= rings; i++) {
    const lat = -90 + (180 * i) / rings;

    for (let j = 0; j <= segments; j++)
      positions.push(...toVector(lat, -180 + (360 * j) / segments));
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = a + segments + 1;

      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  return {
    positions: Float32Array.from(positions),
    indices: Uint16Array.from(indices),
  };
}

interface Attribute {
  readonly name: string;
  readonly size: number;
  readonly offset: number;
}

function bindAttributes(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  buffer: WebGLBuffer,
  stride: number,
  attributes: readonly Attribute[],
): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const { name, size, offset } of attributes) {
    const location = gl.getAttribLocation(program, name);

    if (location < 0) continue;
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(
      location,
      size,
      gl.FLOAT,
      false,
      stride * 4,
      offset * 4,
    );
  }
}

function buffer(
  gl: WebGL2RenderingContext,
  data: Float32Array,
  usage: number = gl.STATIC_DRAW,
): WebGLBuffer {
  const b = gl.createBuffer();

  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage);

  return b;
}

/** Returns undefined when the browser has no WebGL2, so the caller shows its static fallback. */
export function createGlobe(
  canvas: HTMLCanvasElement,
  initial: GlobePalette,
): Globe | undefined {
  const gl = canvas.getContext("webgl2", {
    antialias: true,
    alpha: true,
    premultipliedAlpha: true,
  });

  if (gl === null) return undefined;

  const programs = {
    dots: compile(gl, DOT_VS, DOT_FS),
    sphere: compile(gl, SPHERE_VS, SPHERE_FS),
    glow: compile(gl, GLOW_VS, GLOW_FS),
    arc: compile(gl, ARC_VS, ARC_FS),
    mark: compile(gl, MARK_VS, MARK_FS),
  };
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  const u = (program: keyof typeof programs, name: string) => {
    const key = `${program}.${name}`;

    if (!uniforms.has(key))
      uniforms.set(key, gl.getUniformLocation(programs[program], name));

    return uniforms.get(key) ?? null;
  };

  const grid = dotGrid(DOT_STEP);
  const dots = gl.createVertexArray();

  gl.bindVertexArray(dots);
  bindAttributes(gl, programs.dots, buffer(gl, grid.positions), 3, [
    { name: "aPos", size: 3, offset: 0 },
  ]);
  bindAttributes(gl, programs.dots, buffer(gl, grid.land), 1, [
    { name: "aLand", size: 1, offset: 0 },
  ]);

  const mesh = sphereMesh(48, 96);
  const sphere = gl.createVertexArray();

  gl.bindVertexArray(sphere);
  bindAttributes(gl, programs.sphere, buffer(gl, mesh.positions), 3, [
    { name: "aPos", size: 3, offset: 0 },
  ]);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

  const glow = gl.createVertexArray();

  gl.bindVertexArray(glow);
  bindAttributes(
    gl,
    programs.glow,
    buffer(gl, Float32Array.of(-1, -1, 1, -1, -1, 1, 1, 1)),
    2,
    [{ name: "aCorner", size: 2, offset: 0 }],
  );

  const arcs = ROUTES.map((route) => {
    const ribbon = arcRibbon(route, ARC_SEGMENTS);
    const vao = gl.createVertexArray();

    gl.bindVertexArray(vao);
    bindAttributes(
      gl,
      programs.arc,
      buffer(gl, ribbon.vertices),
      RIBBON_STRIDE,
      [
        { name: "aPos", size: 3, offset: 0 },
        { name: "aNext", size: 3, offset: 3 },
        { name: "aT", size: 1, offset: 6 },
        { name: "aSide", size: 1, offset: 7 },
      ],
    );
    const a = toVector(route.from.lat, route.from.lon);
    const b = toVector(route.to.lat, route.to.lon);

    return { route, vao, count: ribbon.count, a, b, lift: liftFor(a, b) };
  });

  const MARK_STRIDE = 6;
  const maxMarks = ROUTES.length * 4;
  const markData = new Float32Array(maxMarks * MARK_STRIDE);
  const markBuffer = buffer(gl, markData, gl.DYNAMIC_DRAW);
  const marks = gl.createVertexArray();

  gl.bindVertexArray(marks);
  bindAttributes(gl, programs.mark, markBuffer, MARK_STRIDE, [
    { name: "aPos", size: 3, offset: 0 },
    { name: "aSizeAlpha", size: 2, offset: 3 },
    { name: "aRing", size: 1, offset: 5 },
  ]);
  gl.bindVertexArray(null);

  let palette = initial;
  let layout: GlobeLayout = {
    width: 1,
    height: 1,
    centerX: 0,
    centerY: 0,
    radius: 1,
  };
  let ratio = 1;

  const lifted = (p: Vec3): Vec3 => [p[0] * 1.012, p[1] * 1.012, p[2] * 1.012];

  const draw = (seconds: number) => {
    const { width, height, centerX, centerY, radius } = layout;
    const model = multiply(
      rotationX(TILT),
      rotationY(-(START_LON + seconds * SPIN_PER_SECOND)),
    );
    const mvp = multiply(viewProjection(width / height), model);
    const scale = radius / (height / 2) / SILHOUETTE;
    const offset = [
      (centerX / width) * 2 - 1,
      1 - (centerY / height) * 2,
    ] as const;
    const viewport = [gl.drawingBufferWidth, gl.drawingBufferHeight] as const;
    const px = ratio * Math.max(0.8, Math.min(1.25, radius / 420));

    gl.viewport(0, 0, viewport[0], viewport[1]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const common = (name: keyof typeof programs) => {
      gl.useProgram(programs[name]);
      gl.uniformMatrix4fv(u(name, "uMvp"), false, mvp);
      gl.uniformMatrix4fv(u(name, "uModel"), false, model);
      gl.uniform1f(u(name, "uScale"), scale);
      gl.uniform2f(u(name, "uOffset"), offset[0], offset[1]);
      gl.uniform1f(u(name, "uPx"), px);
    };

    // The sphere writes depth so dots and arcs on the far side stay hidden.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    common("sphere");
    gl.uniform3fv(u("sphere", "uBackground"), palette.background);
    gl.uniform3fv(u("sphere", "uAccent"), palette.accent);
    gl.uniform1f(u("sphere", "uGlow"), palette.glow);
    gl.bindVertexArray(sphere);
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);

    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(programs.glow);
    gl.uniform2f(
      u("glow", "uCenter"),
      centerX * ratio,
      (height - centerY) * ratio,
    );
    gl.uniform2f(u("glow", "uViewport"), viewport[0], viewport[1]);
    gl.uniform1f(u("glow", "uRadius"), radius * ratio);
    gl.uniform3fv(u("glow", "uAccent"), palette.accent);
    gl.uniform1f(u("glow", "uGlow"), palette.glow);
    gl.bindVertexArray(glow);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.DEPTH_TEST);
    common("dots");
    gl.uniform3fv(u("dots", "uLand"), palette.accent);
    gl.uniform3fv(u("dots", "uSea"), palette.foreground);
    gl.bindVertexArray(dots);
    gl.drawArrays(gl.POINTS, 0, grid.count);

    common("arc");
    gl.uniform2f(u("arc", "uViewport"), viewport[0] / 2, viewport[1] / 2);
    gl.uniform1f(u("arc", "uWidth"), 1.8 * ratio);
    gl.uniform1f(u("arc", "uTrail"), TRAIL);
    gl.uniform3fv(u("arc", "uAccent"), palette.accent);
    gl.uniform3fv(u("arc", "uForeground"), palette.foreground);

    let markCount = 0;
    const mark = (p: Vec3, size: number, alpha: number, ring: boolean) => {
      if (markCount >= maxMarks || alpha <= 0) return;
      markData.set(
        [p[0], p[1], p[2], size, alpha, ring ? 1 : 0],
        markCount * MARK_STRIDE,
      );
      markCount++;
    };

    arcs.forEach((arc, index) => {
      const frame = arcFrame(arc.route, index, seconds);

      if (frame.path <= 0) return;
      gl.uniform1f(u("arc", "uHead"), frame.head);
      gl.uniform1f(u("arc", "uPath"), frame.path);
      gl.bindVertexArray(arc.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, arc.count);

      mark(lifted(arc.a), 5, 0.8 * frame.path, false);
      mark(lifted(arc.b), 5, 0.8 * frame.path, false);
      if (frame.head < 1)
        mark(arcPoint(arc.a, arc.b, frame.head, arc.lift), 14, 1, false);
      if (frame.leftFor !== undefined && frame.leftFor < PULSE_SECONDS) {
        const k = frame.leftFor / PULSE_SECONDS;

        mark(lifted(arc.a), 6 + 22 * k, 0.7 * (1 - k), true);
      }
      if (frame.landedFor !== undefined && frame.landedFor < PULSE_SECONDS) {
        const k = frame.landedFor / PULSE_SECONDS;

        mark(lifted(arc.b), 6 + 26 * k, 0.9 * (1 - k), true);
      }
    });

    if (markCount > 0) {
      common("mark");
      gl.uniform3fv(u("mark", "uAccent"), palette.accent);
      gl.uniform3fv(u("mark", "uForeground"), palette.foreground);
      gl.bindBuffer(gl.ARRAY_BUFFER, markBuffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        markData,
        0,
        markCount * MARK_STRIDE,
      );
      gl.bindVertexArray(marks);
      gl.drawArrays(gl.POINTS, 0, markCount);
    }
    gl.bindVertexArray(null);
  };

  return {
    draw,
    resize: (next, pixelRatio) => {
      layout = next;
      ratio = pixelRatio;
      canvas.width = Math.max(1, Math.round(next.width * pixelRatio));
      canvas.height = Math.max(1, Math.round(next.height * pixelRatio));
    },
    setPalette: (next) => {
      palette = next;
    },
    destroy: () => {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
