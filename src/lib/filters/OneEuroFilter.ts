/**
 * One Euro Filter - Adaptive low-pass filter for noisy real-time signals
 * Based on: Casiez, G., Roussel, N. and Vogel, D. (2012)
 * "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems"
 * CHI '12, Austin, Texas
 * 
 * Key insight: At low speeds, low cutoff reduces jitter; at high speeds,
 * increased cutoff reduces lag. People are sensitive to jitter when moving
 * slowly and sensitive to latency when moving fast.
 */

function smoothingFactor(te: number, cutoff: number): number {
  const r = 2 * Math.PI * cutoff * te;
  return r / (r + 1);
}

function exponentialSmoothing(alpha: number, x: number, xPrev: number): number {
  return alpha * x + (1 - alpha) * xPrev;
}

export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  
  private xPrev: number;
  private dxPrev: number;
  private tPrev: number;
  private initialized: boolean = false;

  constructor(
    minCutoff: number = 1.0,
    beta: number = 0.0,
    dCutoff: number = 1.0,
    initialValue: number = 0
  ) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = initialValue;
    this.dxPrev = 0;
    this.tPrev = performance.now();
  }

  /**
   * Filter a new value
   * @param x Raw signal value
   * @param t Optional timestamp (ms), defaults to performance.now()
   * @returns Filtered value
   */
  filter(x: number, t?: number): number {
    const ti = t ?? performance.now();
    
    if (!this.initialized) {
      this.tPrev = ti;
      this.xPrev = x;
      this.initialized = true;
      return x;
    }

    const te = Math.max(ti - this.tPrev, 1); // Ensure at least 1ms
    
    // Filtered derivative
    const ad = smoothingFactor(te, this.dCutoff);
    const dx = (x - this.xPrev) / te;
    const dxHat = exponentialSmoothing(ad, dx, this.dxPrev);
    
    // Adaptive cutoff based on speed
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = smoothingFactor(te, cutoff);
    const xHat = exponentialSmoothing(a, x, this.xPrev);
    
    // Memorize
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = ti;
    
    return xHat;
  }

  reset(value: number = 0) {
    this.xPrev = value;
    this.dxPrev = 0;
    this.tPrev = performance.now();
    this.initialized = false;
  }

  setParams(minCutoff: number, beta: number) {
    this.minCutoff = minCutoff;
    this.beta = beta;
  }
}

/**
 * 3D One Euro Filter - applies One Euro filtering to Vector3 components
 */
export class OneEuroFilterVec3 {
  private filters: [OneEuroFilter, OneEuroFilter, OneEuroFilter];
  
  constructor(
    minCutoff: number = 1.0,
    beta: number = 0.0,
    dCutoff: number = 1.0
  ) {
    this.filters = [
      new OneEuroFilter(minCutoff, beta, dCutoff),
      new OneEuroFilter(minCutoff, beta, dCutoff),
      new OneEuroFilter(minCutoff, beta, dCutoff),
    ];
  }

  filter(x: number, y: number, z: number, t?: number): [number, number, number] {
    return [
      this.filters[0].filter(x, t),
      this.filters[1].filter(y, t),
      this.filters[2].filter(z, t),
    ];
  }

  filterFromVector(v: { x: number; y: number; z: number }, t?: number): [number, number, number] {
    return this.filter(v.x, v.y, v.z, t);
  }

  reset(x: number = 0, y: number = 0, z: number = 0) {
    this.filters[0].reset(x);
    this.filters[1].reset(y);
    this.filters[2].reset(z);
  }

  setParams(minCutoff: number, beta: number) {
    this.filters.forEach(f => f.setParams(minCutoff, beta));
  }
}

/**
 * Per-joint filter bank for pose estimation
 * Creates a OneEuroFilterVec3 for each tracked joint
 */
export class JointFilterBank {
  private filters: Map<string, OneEuroFilterVec3> = new Map();
  private minCutoff: number;
  private beta: number;

  constructor(minCutoff: number = 0.8, beta: number = 0.02) {
    this.minCutoff = minCutoff;
    this.beta = beta;
  }

  getFilter(jointName: string): OneEuroFilterVec3 {
    if (!this.filters.has(jointName)) {
      this.filters.set(jointName, new OneEuroFilterVec3(this.minCutoff, this.beta));
    }
    return this.filters.get(jointName)!;
  }

  filterJoint(jointName: string, x: number, y: number, z: number, t?: number): [number, number, number] {
    return this.getFilter(jointName).filter(x, y, z, t);
  }

  setParams(minCutoff: number, beta: number) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.filters.forEach(f => f.setParams(minCutoff, beta));
  }

  reset() {
    this.filters.clear();
  }

  getJointNames(): string[] {
    return Array.from(this.filters.keys());
  }
}
