/**
 * Kalman Filter for 6-DoF Joint Tracking
 * 
 * Uses a constant velocity model to predict joint positions.
 * State vector: [x, y, z, vx, vy, vz]
 * Measurement vector: [x, y, z]
 * 
 * This provides velocity prediction which helps reduce latency
 * and provides smoother tracking than raw filtering alone.
 */

export class KalmanFilter1D {
  // State: [position, velocity]
  private x: number[]; // state
  private P: number[][]; // covariance
  private Q: number[][]; // process noise
  private R: number; // measurement noise
  private A: number[][]; // state transition
  private H: number[]; // measurement matrix
  
  constructor(
    processNoise: number = 0.01,
    measurementNoise: number = 0.1
  ) {
    // Initial state: position=0, velocity=0
    this.x = [0, 0];
    
    // Initial covariance
    this.P = [
      [1, 0],
      [0, 1]
    ];
    
    // Process noise (tuned for human motion)
    this.Q = [
      [processNoise, 0],
      [0, processNoise * 0.1]
    ];
    
    // Measurement noise
    this.R = measurementNoise;
    
    // State transition: constant velocity model
    // x_new = x + v*dt, v_new = v
    this.A = [
      [1, 1], // assume dt=1 frame
      [0, 1]
    ];
    
    // Measurement: we only observe position
    this.H = [1, 0];
  }

  predict(dt: number = 1): number {
    // Update state transition with actual dt
    this.A[0][1] = dt;
    
    // Predict state: x = A * x
    const xPred = [
      this.A[0][0] * this.x[0] + this.A[0][1] * this.x[1],
      this.A[1][0] * this.x[0] + this.A[1][1] * this.x[1]
    ];
    
    // Predict covariance: P = A*P*A' + Q
    const AP = [
      [this.A[0][0] * this.P[0][0] + this.A[0][1] * this.P[1][0], 
       this.A[0][0] * this.P[0][1] + this.A[0][1] * this.P[1][1]],
      [this.A[1][0] * this.P[0][0] + this.A[1][1] * this.P[1][0],
       this.A[1][0] * this.P[0][1] + this.A[1][1] * this.P[1][1]]
    ];
    
    this.P = [
      [AP[0][0] * this.A[0][0] + AP[0][1] * this.A[0][1] + this.Q[0][0],
       AP[0][0] * this.A[1][0] + AP[0][1] * this.A[1][1]],
      [AP[1][0] * this.A[0][0] + AP[1][1] * this.A[0][1],
       AP[1][0] * this.A[1][0] + AP[1][1] * this.A[1][1] + this.Q[1][1]]
    ];
    
    this.x = xPred;
    return this.x[0];
  }

  update(measurement: number): number {
    // Innovation: y = z - H*x
    const y = measurement - (this.H[0] * this.x[0] + this.H[1] * this.x[1]);
    
    // Innovation covariance: S = H*P*H' + R
    const S = this.H[0] * (this.P[0][0] * this.H[0] + this.P[0][1] * this.H[1]) +
              this.H[1] * (this.P[1][0] * this.H[0] + this.P[1][1] * this.H[1]) +
              this.R;
    
    // Kalman gain: K = P*H' / S
    const K = [
      (this.P[0][0] * this.H[0] + this.P[0][1] * this.H[1]) / S,
      (this.P[1][0] * this.H[0] + this.P[1][1] * this.H[1]) / S
    ];
    
    // Update state: x = x + K*y
    this.x = [
      this.x[0] + K[0] * y,
      this.x[1] + K[1] * y
    ];
    
    // Update covariance: P = (I - K*H) * P
    const I_KH = [
      [1 - K[0] * this.H[0], -K[0] * this.H[1]],
      [-K[1] * this.H[0], 1 - K[1] * this.H[1]]
    ];
    
    this.P = [
      [I_KH[0][0] * this.P[0][0] + I_KH[0][1] * this.P[1][0],
       I_KH[0][0] * this.P[0][1] + I_KH[0][1] * this.P[1][1]],
      [I_KH[1][0] * this.P[0][0] + I_KH[1][1] * this.P[1][0],
       I_KH[1][0] * this.P[0][1] + I_KH[1][1] * this.P[1][1]]
    ];
    
    return this.x[0];
  }

  getVelocity(): number {
    return this.x[1];
  }

  getPosition(): number {
    return this.x[0];
  }

  reset(position: number = 0, velocity: number = 0) {
    this.x = [position, velocity];
    this.P = [[1, 0], [0, 1]];
  }
}

/**
 * 3D Kalman Filter for joint position tracking
 */
export class KalmanFilter3D {
  private filters: [KalmanFilter1D, KalmanFilter1D, KalmanFilter1D];

  constructor(
    processNoise: number = 0.01,
    measurementNoise: number = 0.1
  ) {
    this.filters = [
      new KalmanFilter1D(processNoise, measurementNoise),
      new KalmanFilter1D(processNoise, measurementNoise),
      new KalmanFilter1D(processNoise, measurementNoise),
    ];
  }

  predict(dt: number = 1): [number, number, number] {
    return [
      this.filters[0].predict(dt),
      this.filters[1].predict(dt),
      this.filters[2].predict(dt),
    ];
  }

  update(x: number, y: number, z: number): [number, number, number] {
    return [
      this.filters[0].update(x),
      this.filters[1].update(y),
      this.filters[2].update(z),
    ];
  }

  getVelocity(): [number, number, number] {
    return [
      this.filters[0].getVelocity(),
      this.filters[1].getVelocity(),
      this.filters[2].getVelocity(),
    ];
  }

  reset(x: number = 0, y: number = 0, z: number = 0) {
    this.filters[0].reset(x);
    this.filters[1].reset(y);
    this.filters[2].reset(z);
  }
}

/**
 * Joint Kalman Bank - maintains a Kalman filter per joint
 */
export class JointKalmanBank {
  private filters: Map<string, KalmanFilter3D> = new Map();
  private processNoise: number;
  private measurementNoise: number;

  constructor(
    processNoise: number = 0.01,
    measurementNoise: number = 0.1
  ) {
    this.processNoise = processNoise;
    this.measurementNoise = measurementNoise;
  }

  getFilter(jointName: string): KalmanFilter3D {
    if (!this.filters.has(jointName)) {
      this.filters.set(
        jointName, 
        new KalmanFilter3D(this.processNoise, this.measurementNoise)
      );
    }
    return this.filters.get(jointName)!;
  }

  predictJoint(jointName: string, dt: number = 1): [number, number, number] {
    return this.getFilter(jointName).predict(dt);
  }

  updateJoint(jointName: string, x: number, y: number, z: number): [number, number, number] {
    return this.getFilter(jointName).update(x, y, z);
  }

  getJointVelocity(jointName: string): [number, number, number] {
    return this.getFilter(jointName).getVelocity();
  }

  setParams(processNoise: number, measurementNoise: number) {
    this.processNoise = processNoise;
    this.measurementNoise = measurementNoise;
  }

  reset() {
    this.filters.clear();
  }
}
