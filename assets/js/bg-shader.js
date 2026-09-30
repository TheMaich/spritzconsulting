/*!
 * bg-shader.js: moving gradient page background for spritzconsulting.com
 * A dependency-free WebGL port of the ShaderGradient "waterPlane" (shader set
 * "defaults", lightType "3d"). Geometry, noise, displacement, camera and colour
 * maths follow @shadergradient/react 2.4.20. The Perlin noise below is taken
 * from that package. ShaderGradient is MIT licensed (c) ruucm / ShaderGradient
 * contributors. Classic Perlin noise by Stefan Gustavson, MIT.
 *
 * Needs in the page:
 *   <canvas id="bgShader" aria-hidden="true"></canvas> as first child of <body>
 *   CSS tokens --shader-base, --shader-glow, --shader-dark (1 or 0), --shader-veil
 * Off when: no WebGL, ?bg=off. Reduced motion: one still frame, no animation.
 */
(function () {
  'use strict';
  var canvas = document.getElementById('bgShader');
  if (!canvas) return;
  if (new URLSearchParams(location.search).get('bg') === 'off') { canvas.remove(); return; }
  var gl = canvas.getContext('webgl', { antialias: true, alpha: false, premultipliedAlpha: false, powerPreference: 'low-power' });
  if (!gl) { canvas.remove(); return; }
  var root = document.documentElement;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');

  // The ShaderGradient props, as specified. Export-only props (format, frameRate)
  // and editor helpers (axesHelper, gizmoHelper) have no effect on the page.
  var P = {
    brightness: 1.1, cAzimuthAngle: 180, cDistance: 3.9, cPolarAngle: 115, fov: 45,
    positionX: -0.5, positionY: 0.1, positionZ: 0, rotationX: 0, rotationY: 0, rotationZ: 235,
    uDensity: 1.1, uSpeed: 0.1, uStrength: 2.4, uTime: 0.2, pixelDensity: 1, segments: 192
  };

  var NOISE = 'vec3 mod289(vec3 x)\n{\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 mod289(vec4 x)\n{\n  return x - floor(x * (1.0 / 289.0)) * 289.0;\n}\n\nvec4 permute(vec4 x)\n{\n  return mod289(((x*34.0)+1.0)*x);\n}\n\nvec4 taylorInvSqrt(vec4 r)\n{\n  return 1.79284291400159 - 0.85373472095314 * r;\n}\n\nvec3 fade(vec3 t) {\n  return t*t*t*(t*(t*6.0-15.0)+10.0);\n}\n\nfloat cnoise(vec3 P)\n{\n  vec3 Pi0 = floor(P); // Integer part for indexing\n  vec3 Pi1 = Pi0 + vec3(1.0); // Integer part + 1\n  Pi0 = mod289(Pi0);\n  Pi1 = mod289(Pi1);\n  vec3 Pf0 = fract(P); // Fractional part for interpolation\n  vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0\n  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);\n  vec4 iy = vec4(Pi0.yy, Pi1.yy);\n  vec4 iz0 = Pi0.zzzz;\n  vec4 iz1 = Pi1.zzzz;\n\n  vec4 ixy = permute(permute(ix) + iy);\n  vec4 ixy0 = permute(ixy + iz0);\n  vec4 ixy1 = permute(ixy + iz1);\n\n  vec4 gx0 = ixy0 * (1.0 / 7.0);\n  vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;\n  gx0 = fract(gx0);\n  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);\n  vec4 sz0 = step(gz0, vec4(0.0));\n  gx0 -= sz0 * (step(0.0, gx0) - 0.5);\n  gy0 -= sz0 * (step(0.0, gy0) - 0.5);\n\n  vec4 gx1 = ixy1 * (1.0 / 7.0);\n  vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;\n  gx1 = fract(gx1);\n  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);\n  vec4 sz1 = step(gz1, vec4(0.0));\n  gx1 -= sz1 * (step(0.0, gx1) - 0.5);\n  gy1 -= sz1 * (step(0.0, gy1) - 0.5);\n\n  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);\n  vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);\n  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);\n  vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);\n  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);\n  vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);\n  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);\n  vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);\n\n  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));\n  g000 *= norm0.x;\n  g010 *= norm0.y;\n  g100 *= norm0.z;\n  g110 *= norm0.w;\n  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));\n  g001 *= norm1.x;\n  g011 *= norm1.y;\n  g101 *= norm1.z;\n  g111 *= norm1.w;\n\n  float n000 = dot(g000, Pf0);\n  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));\n  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));\n  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));\n  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));\n  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));\n  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));\n  float n111 = dot(g111, Pf1);\n\n  vec3 fade_xyz = fade(Pf0);\n  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);\n  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);\n  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x); \n  return 2.2 * n_xyz;\n}\n\n';
  var VS = 'precision highp float;\n' + NOISE + '\n' +
    'attribute vec2 aPos;\n' +
    'uniform mat4 uModel, uView, uProj;\n' +
    'uniform float uTime, uSpeed, uNoiseDensity, uNoiseStrength;\n' +
    'varying vec3 vPos;\n' +
    'void main(){\n' +
    '  vec3 position = vec3(aPos, 0.0);\n' +
    '  float t = uTime * uSpeed;\n' +
    '  float distortion = 0.75 * cnoise(0.43 * position * uNoiseDensity + t);\n' +
    '  vec3 pos = position + vec3(0.0, 0.0, 1.0) * distortion * uNoiseStrength;\n' +
    '  vPos = pos;\n' +
    '  gl_Position = uProj * uView * uModel * vec4(pos, 1.0);\n' +
    '}';
  // Dark: the library's own formula. It renders with linear:true and flat:true
  // (no colour encoding, no tone mapping) and its "3d" light is an ambient light
  // at brightness * PI, so the output is colour * brightness.
  // Light: same shape, glow blended over paper and clamped, so no dark troughs.
  var FS = 'precision highp float;\n' +
    'varying vec3 vPos;\n' +
    'uniform vec3 uC1, uC3;\n' +
    'uniform float uBrightness, uDark;\n' +
    'void main(){\n' +
    '  vec3 base = mix(uC1, uC3, vPos.z);\n' +
    '  vec3 dark = clamp(base * uBrightness, 0.0, 1.0);\n' +
    '  vec3 light = mix(uC1, uC3, clamp(vPos.z, 0.0, 1.0));\n' +
    '  gl_FragColor = vec4(mix(light, dark, uDark), 1.0);\n' +
    '}';

  function sh(type, s) { var o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
  var prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) { canvas.remove(); return; }
  gl.useProgram(prog);

  // planeGeometry(10, 10, 192, 192)
  var S = P.segments, verts = new Float32Array((S + 1) * (S + 1) * 2), idx = new Uint16Array(S * S * 6), k = 0, i, j;
  for (j = 0; j <= S; j++) for (i = 0; i <= S; i++) { verts[k++] = -5 + 10 * i / S; verts[k++] = 5 - 10 * j / S; }
  k = 0;
  for (j = 0; j < S; j++) for (i = 0; i < S; i++) { var a = j * (S + 1) + i, b = a + S + 1; idx[k++] = a; idx[k++] = b; idx[k++] = a + 1; idx[k++] = b; idx[k++] = b + 1; idx[k++] = a + 1; }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var U = {}; ['uModel', 'uView', 'uProj', 'uTime', 'uSpeed', 'uNoiseDensity', 'uNoiseStrength', 'uC1', 'uC3', 'uBrightness', 'uDark'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
  gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); // DoubleSide

  var D2R = Math.PI / 180;
  function persp(fov, asp, n, f) { var t = 1 / Math.tan(fov / 2), o = new Float32Array(16); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(p, q) { return [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]; }
  function dot(p, q) { return p[0] * q[0] + p[1] * q[1] + p[2] * q[2]; }
  function lookAt(e) { var z = norm(e), x = norm(cross([0, 1, 0], z)), y = cross(z, x); return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]); }
  function model() { // three.js Euler XYZ, then position
    var rx = P.rotationX * D2R, ry = P.rotationY * D2R, rz = P.rotationZ * D2R;
    var cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    return new Float32Array([cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz, 0, -cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz, 0, sy, -sx * cy, cx * cy, 0, P.positionX, P.positionY, P.positionZ, 1]);
  }
  function eye() { var r = P.cDistance, ph = P.cPolarAngle * D2R, th = P.cAzimuthAngle * D2R; return [r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph), r * Math.sin(ph) * Math.cos(th)]; }
  var VIEW = lookAt(eye()), MODEL = model();

  function hex(v) { v = v.trim(); if (v.length === 4) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]; var n = parseInt(v.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  var C = null;
  function readTheme() { var cs = getComputedStyle(root); C = { c1: hex(cs.getPropertyValue('--shader-base')), c3: hex(cs.getPropertyValue('--shader-glow')), dark: cs.getPropertyValue('--shader-dark').trim() === '1' ? 1 : 0 }; }

  var W = 0, H = 0;
  function resize() {
    var w = Math.round(window.innerWidth * P.pixelDensity), h = Math.round(window.innerHeight * P.pixelDensity);
    if (w === W && h === H) return false;
    W = w; H = h; canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); return true;
  }
  var t0 = performance.now(), raf = 0, visible = !document.hidden;
  function draw(now) {
    resize();
    gl.uniformMatrix4fv(U.uProj, false, persp(P.fov * D2R, W / H, 0.1, 100));
    gl.uniformMatrix4fv(U.uView, false, VIEW); gl.uniformMatrix4fv(U.uModel, false, MODEL);
    gl.uniform1f(U.uTime, reduce.matches ? P.uTime : P.uTime + (now - t0) / 1000);
    gl.uniform1f(U.uSpeed, P.uSpeed); gl.uniform1f(U.uNoiseDensity, P.uDensity); gl.uniform1f(U.uNoiseStrength, P.uStrength);
    gl.uniform3fv(U.uC1, C.c1); gl.uniform3fv(U.uC3, C.c3); gl.uniform1f(U.uBrightness, P.brightness); gl.uniform1f(U.uDark, C.dark);
    gl.clearColor(C.c1[0], C.c1[1], C.c1[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
  }
  function loop(now) { raf = 0; draw(now); if (visible && !reduce.matches) raf = requestAnimationFrame(loop); }
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }

  readTheme(); kick();
  root.classList.add('has-bg-shader');
  new MutationObserver(function () { readTheme(); kick(); }).observe(root, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { readTheme(); kick(); });
  reduce.addEventListener('change', kick);
  window.addEventListener('resize', kick);
  document.addEventListener('visibilitychange', function () { visible = !document.hidden; if (visible) kick(); });
  gl.canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); canvas.remove(); root.classList.remove('has-bg-shader'); });
  window.__bgShader = P;
})();
