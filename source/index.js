// ——————————————————————————————————————————————————
// Dependencies
// ——————————————————————————————————————————————————

let g_byteArray;

let particleSpriteSrc = './textures/particle.png';

let physicsVS = `
attribute vec2 vertexPosition;
void main() {
  gl_Position = vec4(vertexPosition, 1, 1);
}
`;
let physicsFS = `
precision mediump float;
uniform sampler2D physicsData;
uniform vec2 bounds;
const vec3 TARGET = vec3(0, 0, 0.01);
const int POSITION_SLOT = 0;
const int VELOCITY_SLOT = 1;
vec4 texel(vec2 offset) {
  vec2 coord = (gl_FragCoord.xy + offset) / bounds;
  return texture2D(physicsData, coord);
}
void main() {
  int slot = int(mod(gl_FragCoord.x, 2.0));
  if (slot == POSITION_SLOT) {
    vec4 dataA = texel(vec2(0, 0));
    vec4 dataB = texel(vec2(1, 0));
    vec3 position = dataA.xyz;
    vec3 velocity = dataB.xyz;
    float phase = dataA.w;
    if (phase > 0.0) {
      position = vec3(gl_FragCoord.x/800.0, gl_FragCoord.y/800.0, 0);
    } else {
      position = vec3(-1);
    }
    gl_FragColor = vec4(position, 1.0);
  } 
}
`;
let renderVS  = `

attribute vec3 dataLocation;
uniform sampler2D physicsData;
void main() {
  float zVal = dataLocation.z;
  float perspective = 1.0 + zVal * 5.5;
  float phase = cos(.5) * max(0.5, tan(zVal * 8.05));
  gl_Position = vec4(dataLocation.x-0.5, dataLocation.y-0.5, zVal, perspective);
  gl_PointSize = 30.0;
}
`;
let renderFS  = `
uniform sampler2D particleTexture;
void main() {
  gl_FragColor = texture2D(particleTexture, gl_PointCoord);
}
`;

let debugVS   = `
attribute vec2 vertexPosition;
varying vec2 coord;
void main() {
  coord = (vertexPosition + 1.0) / 2.0;
  gl_Position = vec4(vertexPosition, 1, 1);
}
`;

let debugFS   = `
precision mediump float;
uniform sampler2D texture;
varying vec2 coord;
void main() {
  vec3 rgb = texture2D(texture, coord).xyz;
  gl_FragColor = vec4(rgb, 0.5);
}
`;

let copyVS   = `
  attribute vec2 vertexPosition;
  varying vec2 coord;
  void main() {
    coord = (vertexPosition + 1.0) / 2.0;
    gl_Position = vec4(vertexPosition, 1, 1);
  }
`;

let copyFS   = `
  precision mediump float;
  uniform sampler2D texture;
  varying vec2 coord;
  void main() {
    gl_FragColor = texture2D(texture, coord);
  }
`;

// ——————————————————————————————————————————————————
// Constants
// ——————————————————————————————————————————————————

const PARTICLE_COUNT = Math.pow(8, 2);
const PARTICLE_COUNT_SQRT = Math.sqrt(PARTICLE_COUNT);
const PARTICLE_DATA_SLOTS = 2;
const PARTICLE_DATA_WIDTH = PARTICLE_COUNT_SQRT * PARTICLE_DATA_SLOTS;
const PARTICLE_DATA_HEIGHT = PARTICLE_COUNT_SQRT;
const PARTICLE_EMIT_RATE = 1000;

// ——————————————————————————————————————————————————
// Globals
// ——————————————————————————————————————————————————

let physicsInputTexture;
let physicsOutputTexture;
let dataLocationBuffer;
let imgposBuffer;
let viewportQuadBuffer;
let particleTexture;
let physicsProgram;
let renderProgram;
let debugProgram;
let copyProgram;
let frameBuffer;
let container;
let emitIndex;
let lastEmit;
let millis;
let height;
let width;
let scale;
let clock;
let gl;

// ——————————————————————————————————————————————————
// GL Utils
// ——————————————————————————————————————————————————

const createContext = () => {
  const el = document.createElement('canvas');
  const gl = el.getContext('webgl') || el.getContext('experimental-webgl');
  if (!gl) {
    throw 'WebGL not supported';
  }
  if (!gl.getExtension('OES_texture_float')) {
    throw 'Float textures not supported';
  }
  return gl;
};

const createShader = (source, type) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.log('some bug')
  }
  return shader;
};

const createProgram = (vSource, fSource) => {
  const vs = createShader(vSource, gl.VERTEX_SHADER);
  const fs = createShader(fSource, gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw gl.getProgramInfoLog(program);
  }
  return program;
};

const createImageTexture = (image) => {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const update = () => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
  };
  image.naturalWidth > 0 ? update() : image.onload = update;
  return texture;
};

const createDataTexture = (width, height, data) => {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, data);
  return texture;
};

const createFramebuffer = () => {
  const buffer = gl.createFramebuffer();
  return buffer;
};

// ——————————————————————————————————————————————————
// Helpers
// ——————————————————————————————————————————————————

const random = (min, max) => {
  if (typeof min !== 'number') min = 1;
  if (typeof max !== 'number') max = min, min = 0;
  return min + Math.random() * (max - min);
};

const createPhysicsProgram = () => {
  const program = createProgram(physicsVS, physicsFS);
  program.vertexPosition = gl.getAttribLocation(program, 'vertexPosition');
  program.physicsData = gl.getUniformLocation(program, 'physicsData');
  program.bounds = gl.getUniformLocation(program, 'bounds');
  gl.enableVertexAttribArray(program.vertexPosition);
  return program;
};

const createRenderProgram = () => {
  const program = createProgram(renderVS, renderFS);
  program.dataLocation = gl.getAttribLocation(program, 'dataLocation');
  program.particleTexture = gl.getUniformLocation(program, 'particleTexture');
  program.physicsData = gl.getUniformLocation(program, 'physicsData');
  gl.enableVertexAttribArray(program.dataLocation);
  
  return program;
};

const createDebugProgram = () => {
  const program = createProgram(debugVS, debugFS);
  program.vertexPosition = gl.getAttribLocation(program, 'vertexPosition');
  program.texture = gl.getUniformLocation(program, 'texture');
  gl.enableVertexAttribArray(program.vertexPosition);
  return program;
};

const createCopyProgram = () => {
  const program = createProgram(copyVS, copyFS);
  program.vertexPosition = gl.getAttribLocation(program, 'vertexPosition');
  program.texture = gl.getUniformLocation(program, 'texture');
  gl.enableVertexAttribArray(program.vertexPosition);
  return program;
};

const createPhysicsDataTexture = () => {
  const size = 4 * PARTICLE_COUNT * PARTICLE_DATA_SLOTS;
  const data = new Float32Array(size);
  return createDataTexture(PARTICLE_DATA_WIDTH, PARTICLE_DATA_HEIGHT, data);
};

const createParticleTexture = () => {
  const image = new Image();
  image.src = particleSpriteSrc;
  return createImageTexture(image);
};

const createDataLocationBuffer = () => {
  const data = new Float32Array(g_byteArray.length * 3);
  const pixelCount = g_byteArray.length;
  for (let u, v, z, i = 0; i < pixelCount; i++) {
    u = i * 3;
    v = u + 1;
    z = u + 2;
    
    data[u] = Math.floor(i % 74)/74.0;
    data[v] = Math.floor(i / 74.0)/55.0;
    data[z] = 0;
  }
  
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
};

const createImgposBuffer = () => {
  const data = new Float32Array(PARTICLE_COUNT);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    data[i] = 1;
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
};


const createViewportQuadBuffer = () => {
  const data = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
};

const emitParticles = (count, origin, velocities = [0, 0, 0]) => {
  gl.bindTexture(gl.TEXTURE_2D, physicsInputTexture);
  const x = Math.floor((emitIndex * PARTICLE_DATA_SLOTS) % PARTICLE_DATA_WIDTH);
  const y = Math.floor(emitIndex / PARTICLE_DATA_HEIGHT);
  const chunks = [[x, y, count * PARTICLE_DATA_SLOTS]];
  const split = (chunk) => {
    const boundary = chunk[0] + chunk[2];
    if (boundary > PARTICLE_DATA_WIDTH) {
      const delta = boundary - PARTICLE_DATA_WIDTH;
      chunk[2] -= delta;
      chunk = [0, (chunk[1] + 1) % PARTICLE_DATA_HEIGHT, delta];
      chunks.push(chunk);
      split(chunk);
    }
  };
  split(chunks[0]);
  let i, j, n, m, chunk, data, force = 1.0;
  for (i = 0, n = chunks.length; i < n; i++) {
    chunk = chunks[i];
    data = [];
    for (j = 0, m = chunk[2]; j < m; j++) {
      data.push(
        origin[0] + random(-0.02, 0.02),
        origin[1] + random(-0.02, 0.02),
        origin[2] + random(-0.01, 0.01),
        random(10),
        velocities[0] + force * random(-1, 1),
        velocities[1] + force * random(-1, 1),
        velocities[2] + force * random(-1, 1),
        0
      );
    }
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, chunk[0], chunk[1], chunk[2], 1,
      gl.RGBA, gl.FLOAT, new Float32Array(data)
    );
  }
  emitIndex += count;
  emitIndex %= PARTICLE_COUNT;
};

const leap = () => {
  if (typeof Leap !== 'undefined') {
    Leap.loop(frame => {
      const fingers = frame.pointables;
      for (let i = 0, n = fingers.length; i < n; i++) {
        const { tipPosition, tipVelocity } = fingers[i];
        const count = random(110, 200);
        const position = [
          (tipPosition.x / 200),
          (tipPosition.y / 200) - 1
          (tipPosition.z / 400) * -1
        ];
        const velocity = [
          tipVelocity.x / 100,
          tipVelocity.y / 120,
          tipVelocity.z / 180
        ];
        emitParticles(count, position, velocity);
      }
    });
  }
};

// ——————————————————————————————————————————————————
// Main
// ——————————————————————————————————————————————————

const init = () => {
  gl = createContext();
  container = document.getElementById('container');
  emitIndex = 0;
  millis = 0;
  clock = Date.now();
  document.addEventListener('touchmove', touch);
  document.addEventListener('mousemove', touch);
  window.addEventListener('resize', resize);
  container.appendChild(gl.canvas);
  setup();
  resize();
  update();
  leap();
};

const setup = () => {
  physicsInputTexture = createPhysicsDataTexture();
  physicsOutputTexture = createPhysicsDataTexture();
  dataLocationBuffer = createDataLocationBuffer();
  imgposBuffer = createImgposBuffer();
  viewportQuadBuffer = createViewportQuadBuffer();
  particleTexture = createParticleTexture();
  physicsProgram = createPhysicsProgram();
  renderProgram = createRenderProgram();
  debugProgram = createDebugProgram();
  copyProgram = createCopyProgram();
  frameBuffer = createFramebuffer();
};

const physics = () => {
  gl.useProgram(physicsProgram);
  gl.viewport(0, 0, PARTICLE_DATA_WIDTH, PARTICLE_DATA_HEIGHT);
  gl.bindBuffer(gl.ARRAY_BUFFER, viewportQuadBuffer);
  gl.vertexAttribPointer(physicsProgram.vertexPosition, 2, gl.FLOAT, gl.FALSE, 0, 0);
  gl.uniform2f(physicsProgram.bounds, PARTICLE_DATA_WIDTH, PARTICLE_DATA_HEIGHT);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, physicsInputTexture);
  gl.uniform1i(physicsProgram.physicsData, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, physicsOutputTexture, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
};

const render = () => {
  gl.useProgram(renderProgram);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  
  gl.bindBuffer(gl.ARRAY_BUFFER, dataLocationBuffer);
  gl.vertexAttribPointer(renderProgram.dataLocation, 3, gl.FLOAT, gl.FALSE, 0, 0);
  
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, physicsOutputTexture);
  gl.uniform1i(renderProgram.physicsData, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, particleTexture);
  gl.uniform1i(renderProgram.particleTexture, 1);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.drawArrays(gl.POINTS, 0, g_byteArray.length);
  gl.disable(gl.BLEND);
};

const tick = () => {
  const now = Date.now();
  millis += now - clock || 0;
  clock = now;
};

const spawn = () => {
  if (millis < 3000) {
    emitParticles(800, [
      -1.0 + Math.sin(millis * 0.001) * 2.0,
      -0.2 + Math.cos(millis * 0.004) * 0.5,
      Math.sin(millis * 0.015) * -0.05
    ]);
  }
};

const touch = (event) => {
  if (millis - lastEmit < 20) return;
  const touches = event.changedTouches || [event];
  const limit = PARTICLE_EMIT_RATE / touches.length;
  for (let i = 0; i < touches.length; i++) {
    const touch = touches[i];
    const x = (touch.clientX / width) * 2 - 1;
    const y = (touch.clientY / height) * -2 + 1;
    emitParticles(limit, [x, y, 0]);
  }
  lastEmit = millis;
};

const resize = () => {
  scale = window.devicePixelRatio || 1;
  width = window.innerWidth;
  height = window.innerHeight;
  gl.canvas.width = width * scale;
  gl.canvas.height = height * scale;
  gl.canvas.style.width = width + 'px';
  gl.canvas.style.height = height + 'px';
};

const update = () => {
  requestAnimationFrame(update);
  tick();
  spawn();
  physics();
  render();
};

function convertImageToByteArray(img) {
  // Create an empty canvas element
  var canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;

  // Copy the image contents to the canvas
  var ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  // Get the data-URL formatted image
  // Firefox supports PNG and JPEG. You could check img.src to
  // guess the original format, but be aware the using "image/jpg"
  // will re-encode the image.
  var imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  return imageData.data;
}

function initWrapper(){
    let g_img = new Image();
    g_img.src = "./00004.png";
    g_img.onload = function () {
        g_byteArray = convertImageToByteArray(g_img);
        init();
    }
}

// ——————————————————————————————————————————————————
// Bootstrap
// ——————————————————————————————————————————————————

if (document.readyState === 'complete') initWrapper()
else window.addEventListener('load', initWrapper);
