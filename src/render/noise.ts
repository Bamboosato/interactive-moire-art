function fade(value: number): number {
  return value * value * (3 - 2 * value);
}

function lerp(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let value = Math.imul(x, 374761393);
  value = Math.imul(value + Math.imul(y, 668265263), 1274126177);
  value = Math.imul(value + Math.imul(z, 2147483647), 42595009);
  value = Math.imul(value ^ Math.floor(seed), 1597334677);
  value ^= value >>> 16;
  return (value >>> 0) / 4_294_967_295 * 2 - 1;
}

export function valueNoise3D(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const fz = fade(z - z0);

  const x00 = lerp(hash3(x0, y0, z0, seed), hash3(x0 + 1, y0, z0, seed), fx);
  const x10 = lerp(hash3(x0, y0 + 1, z0, seed), hash3(x0 + 1, y0 + 1, z0, seed), fx);
  const x01 = lerp(hash3(x0, y0, z0 + 1, seed), hash3(x0 + 1, y0, z0 + 1, seed), fx);
  const x11 = lerp(hash3(x0, y0 + 1, z0 + 1, seed), hash3(x0 + 1, y0 + 1, z0 + 1, seed), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

export function fbm3D(x: number, y: number, z: number, seed: number, octaves = 4): number {
  let amplitude = 0.5;
  let frequency = 1;
  let value = 0;
  let amplitudeSum = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    value += valueNoise3D(x * frequency, y * frequency, z * frequency, seed + octave * 1013) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return amplitudeSum === 0 ? 0 : value / amplitudeSum;
}
