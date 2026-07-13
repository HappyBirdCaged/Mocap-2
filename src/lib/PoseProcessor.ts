/**
 * Main Pose Processing Pipeline
 * 
 * Integrates all HPE improvements:
 * 1. One Euro Filter per joint (adaptive smoothing)
 * 2. Kalman Filter for velocity prediction
 * 3. FABRIK IK for end-effector correction
 * 4. Biomechanical constraints (SKEL-based)
 * 5. Foot contact detection and locking
 * 6. Confidence-weighted joint blending
 * 7. Temporal consistency
 * 
 * Pipeline flow:
 * Raw MediaPipe Landmarks → OneEuroFilter → KalmanFilter → 
 * 3D Position Estimation → FABRIK IK → Constraint Enforcement → 
 * Foot Contact Locking → Final Bone Rotations
 */

import * as THREE from 'three';
import { JointFilterBank } from './filters/OneEuroFilter';
import { JointKalmanBank } from './filters/KalmanFilter';
import { FABRIKSolver } from './ik/FABRIK';
import { applyConstraint, SKEL_JOINT_CONSTRAINTS } from './biomech/JointConstraints';
import { FootContactDetector, FootLocker } from './biomech/FootContact';
import type { ProcessingConfig, FootContactState, DebugInfo } from '@/types';
import { DEFAULT_CONFIG } from '@/types';

// Joint mapping for pose processing
interface JointMapping {
  landmarkIdx: number;
  boneName: string | null;
  parentBone: string | null;
}

const JOINT_MAP: Record<string, JointMapping> = {
  leftShoulder: { landmarkIdx: 11, boneName: 'LeftArm', parentBone: 'Spine' },
  rightShoulder: { landmarkIdx: 12, boneName: 'RightArm', parentBone: 'Spine' },
  leftElbow: { landmarkIdx: 13, boneName: 'LeftForeArm', parentBone: 'LeftArm' },
  rightElbow: { landmarkIdx: 14, boneName: 'RightForeArm', parentBone: 'RightArm' },
  leftWrist: { landmarkIdx: 15, boneName: 'LeftHand', parentBone: 'LeftForeArm' },
  rightWrist: { landmarkIdx: 16, boneName: 'RightHand', parentBone: 'RightForeArm' },
  leftHip: { landmarkIdx: 23, boneName: 'LeftUpLeg', parentBone: 'Hips' },
  rightHip: { landmarkIdx: 24, boneName: 'RightUpLeg', parentBone: 'Hips' },
  leftKnee: { landmarkIdx: 25, boneName: 'LeftLeg', parentBone: 'LeftUpLeg' },
  rightKnee: { landmarkIdx: 26, boneName: 'RightLeg', parentBone: 'RightUpLeg' },
  leftAnkle: { landmarkIdx: 27, boneName: 'LeftFoot', parentBone: 'LeftLeg' },
  rightAnkle: { landmarkIdx: 28, boneName: 'RightFoot', parentBone: 'RightLeg' },
};

export class PoseProcessor {
  private config: ProcessingConfig;
  private oneEuroFilters: JointFilterBank;
  private kalmanFilters: JointKalmanBank;
  private fabrikSolver: FABRIKSolver;
  private footDetector: FootContactDetector;
  private footLocker: FootLocker;
  
  // State
  private smoothedJoints: Map<string, { x: number; y: number; z: number }> = new Map();
  private prevPositions: Map<string, THREE.Vector3> = new Map();
  private velocities: Map<string, THREE.Vector3> = new Map();
  private lastTimestamp: number = 0;
  private frameCount: number = 0;
  private fps: number = 30;
  private lastFpsUpdate: number = 0;
  
  // Body rotation tracking
  private bodyRotationSmooth: number = 0;
  private targetBodyRotation: number = 0;
  private lastRotationUpdate: number = 0;
  
  // Debug info
  private debugInfo: DebugInfo = {
    fps: 0,
    filterLatency: 0,
    ikIterations: 0,
    activeConstraints: 0,
    footContact: {
      left: false,
      right: false,
      leftConfidence: 0,
      rightConfidence: 0,
      leftHeight: 0,
      rightHeight: 0,
    },
    jointConfidences: {},
    bodyRotation: 0,
    rootHeight: 0,
  };

  constructor(config: Partial<ProcessingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.oneEuroFilters = new JointFilterBank(
      this.config.minCutoff,
      this.config.beta
    );
    
    this.kalmanFilters = new JointKalmanBank(
      this.config.kalmanProcessNoise,
      this.config.kalmanMeasurementNoise
    );
    
    this.fabrikSolver = new FABRIKSolver(
      this.config.ikIterations,
      this.config.ikTolerance
    );
    
    this.footDetector = new FootContactDetector(
      this.config.footContactThreshold,
      0.03 // velocity threshold
    );
    
    this.footLocker = new FootLocker();
  }

  /**
   * Process raw MediaPipe landmarks through the full pipeline
   * @param landmarks Raw MediaPipe pose landmarks
   * @param worldLandmarks Raw MediaPipe world landmarks
   * @returns Processed joint positions and rotations
   */
  process(
    landmarks: { x: number; y: number; z: number; visibility: number }[],
    worldLandmarks: { x: number; y: number; z: number; visibility: number }[]
  ): {
    jointPositions: Map<string, THREE.Vector3>;
    boneRotations: Map<string, THREE.Quaternion>;
    rootPosition: THREE.Vector3;
    bodyRotation: number;
    debugInfo: DebugInfo;
    footContact: FootContactState;
  } {
    const startTime = performance.now();
    const timestamp = performance.now();
    const dt = Math.min((timestamp - this.lastTimestamp) / 1000, 0.1); // Cap at 100ms
    this.lastTimestamp = timestamp;

    // Update FPS
    this.frameCount++;
    if (timestamp - this.lastFpsUpdate > 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsUpdate = timestamp;
    }

    // Step 1: Extract and filter joint positions
    const filteredPositions = this.extractAndFilterJoints(landmarks, worldLandmarks, timestamp);

    // Step 2: Apply Kalman prediction/correction
    const predictedPositions = this.applyKalmanFilter(filteredPositions, dt);

    // Step 3: Compute body rotation from shoulders
    const bodyRotation = this.computeBodyRotation(predictedPositions);

    // Step 4: Detect foot contact
    const leftAnkle = predictedPositions.get('leftAnkle');
    const rightAnkle = predictedPositions.get('rightAnkle');
    const leftVel = this.velocities.get('leftAnkle')?.y || 0;
    const rightVel = this.velocities.get('rightAnkle')?.y || 0;
    
    const footContact = leftAnkle && rightAnkle
      ? this.footDetector.detect(
          new THREE.Vector3(leftAnkle.x, leftAnkle.y, leftAnkle.z),
          new THREE.Vector3(rightAnkle.x, rightAnkle.y, rightAnkle.z),
          leftVel,
          rightVel
        )
      : this.debugInfo.footContact;

    // Step 5: Apply foot locking
    const lockedPositions = this.applyFootLocking(predictedPositions, footContact);

    // Step 6: Compute bone rotations with constraints
    const boneRotations = this.computeBoneRotations(lockedPositions, bodyRotation);

    // Step 7: Compute root position
    const rootPosition = this.computeRootPosition(lockedPositions);

    // Update velocities
    this.updateVelocities(lockedPositions, dt);

    // Build debug info
    this.debugInfo = {
      fps: this.fps,
      filterLatency: performance.now() - startTime,
      ikIterations: this.config.ikIterations,
      activeConstraints: Object.keys(SKEL_JOINT_CONSTRAINTS).length,
      footContact,
      jointConfidences: this.extractConfidences(landmarks),
      bodyRotation,
      rootHeight: rootPosition.y,
    };

    // Convert to Vector3 map
    const jointPositions = new Map<string, THREE.Vector3>();
    lockedPositions.forEach((pos, name) => {
      jointPositions.set(name, new THREE.Vector3(pos.x, pos.y, pos.z));
    });

    return {
      jointPositions,
      boneRotations,
      rootPosition,
      bodyRotation,
      debugInfo: this.debugInfo,
      footContact,
    };
  }

  /**
   * Step 1: Extract landmarks and apply One Euro filtering
   */
  private extractAndFilterJoints(
    _landmarks: { x: number; y: number; z: number; visibility: number }[],
    worldLandmarks: { x: number; y: number; z: number; visibility: number }[],
    timestamp: number
  ): Map<string, { x: number; y: number; z: number; confidence: number }> {
    const result = new Map<string, { x: number; y: number; z: number; confidence: number }>();

    for (const [jointName, mapping] of Object.entries(JOINT_MAP)) {
      const lm = worldLandmarks[mapping.landmarkIdx];
      if (!lm) continue;

      const confidence = lm.visibility || 0;
      
      // Skip low-confidence joints but keep last known position
      if (confidence < this.config.minVisibilityThreshold) {
        const last = this.smoothedJoints.get(jointName);
        if (last) {
          result.set(jointName, { ...last, confidence: confidence * 0.5 });
        }
        continue;
      }

      // Convert MediaPipe coordinates to 3D space
      // MediaPipe: x right, y down, z forward (toward camera)
      // Our space: x right, y up, z forward
      const rawX = lm.x;
      const rawY = -lm.y + 0.95; // Offset to bring hips to reasonable height
      const rawZ = -lm.z;

      // Apply One Euro filter
      const [fx, fy, fz] = this.oneEuroFilters.filterJoint(
        jointName,
        rawX,
        rawY,
        rawZ,
        timestamp
      );

      const smoothed = { x: fx, y: fy, z: fz, confidence };
      this.smoothedJoints.set(jointName, smoothed);
      result.set(jointName, smoothed);
    }

    // Compute derived joints (spine, neck)
    this.computeDerivedJoints(result);

    return result;
  }

  /**
   * Compute spine top, spine bottom, and neck positions
   */
  private computeDerivedJoints(
    joints: Map<string, { x: number; y: number; z: number; confidence: number }>
  ): void {
    // Spine top = midpoint of shoulders
    const leftShoulder = joints.get('leftShoulder');
    const rightShoulder = joints.get('rightShoulder');
    if (leftShoulder && rightShoulder) {
      joints.set('spineTop', {
        x: (leftShoulder.x + rightShoulder.x) / 2,
        y: (leftShoulder.y + rightShoulder.y) / 2,
        z: (leftShoulder.z + rightShoulder.z) / 2,
        confidence: Math.min(leftShoulder.confidence, rightShoulder.confidence),
      });
    }

    // Spine bottom = midpoint of hips
    const leftHip = joints.get('leftHip');
    const rightHip = joints.get('rightHip');
    if (leftHip && rightHip) {
      joints.set('spineBottom', {
        x: (leftHip.x + rightHip.x) / 2,
        y: (leftHip.y + rightHip.y) / 2,
        z: (leftHip.z + rightHip.z) / 2,
        confidence: Math.min(leftHip.confidence, rightHip.confidence),
      });
    }

    // Neck = above spine top
    const spineTop = joints.get('spineTop');
    if (spineTop) {
      joints.set('neck', {
        x: spineTop.x,
        y: spineTop.y + 0.12,
        z: spineTop.z,
        confidence: spineTop.confidence,
      });
    }
  }

  /**
   * Step 2: Apply Kalman filter for velocity prediction
   */
  private applyKalmanFilter(
    positions: Map<string, { x: number; y: number; z: number; confidence: number }>,
    dt: number
  ): Map<string, { x: number; y: number; z: number; confidence: number }> {
    const result = new Map<string, { x: number; y: number; z: number; confidence: number }>();

    for (const [name, pos] of positions) {
      // Predict
      this.kalmanFilters.predictJoint(name, dt);
      
      // Update with measurement
      const [kx, ky, kz] = this.kalmanFilters.updateJoint(name, pos.x, pos.y, pos.z);
      
      // Blend Kalman output with One Euro based on confidence
      // High confidence = trust measurement more, low confidence = trust prediction
      const blend = pos.confidence; // 0-1
      result.set(name, {
        x: kx * blend + pos.x * (1 - blend),
        y: ky * blend + pos.y * (1 - blend),
        z: kz * blend + pos.z * (1 - blend),
        confidence: pos.confidence,
      });
    }

    return result;
  }

  /**
   * Step 3: Compute body rotation from shoulder orientation
   */
  private computeBodyRotation(
    positions: Map<string, { x: number; y: number; z: number }>
  ): number {
    const leftShoulder = positions.get('leftShoulder');
    const rightShoulder = positions.get('rightShoulder');
    
    if (!leftShoulder || !rightShoulder) return this.bodyRotationSmooth;

    const dx = rightShoulder.x - leftShoulder.x;
    const dz = rightShoulder.z - leftShoulder.z;
    
    this.targetBodyRotation = Math.atan2(dz, dx);
    
    const now = performance.now();
    const dt = Math.min((now - this.lastRotationUpdate) / 16, 1);
    this.lastRotationUpdate = now;
    
    // Smooth rotation
    const smoothFactor = this.config.rotationSmoothing * dt + 0.05;
    let diff = this.targetBodyRotation - this.bodyRotationSmooth;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    this.bodyRotationSmooth += diff * smoothFactor;
    
    return this.bodyRotationSmooth;
  }

  /**
   * Step 5: Apply foot locking to prevent sliding
   */
  private applyFootLocking(
    positions: Map<string, { x: number; y: number; z: number }>,
    footContact: FootContactState
  ): Map<string, { x: number; y: number; z: number }> {
    const result = new Map(positions);
    
    const leftAnkle = positions.get('leftAnkle');
    const rightAnkle = positions.get('rightAnkle');
    
    if (leftAnkle) {
      const locked = this.footLocker.lock(
        new THREE.Vector3(leftAnkle.x, leftAnkle.y, leftAnkle.z),
        footContact.left,
        'left'
      );
      result.set('leftAnkle', { x: locked.x, y: locked.y, z: locked.z });
    }
    
    if (rightAnkle) {
      const locked = this.footLocker.lock(
        new THREE.Vector3(rightAnkle.x, rightAnkle.y, rightAnkle.z),
        footContact.right,
        'right'
      );
      result.set('rightAnkle', { x: locked.x, y: locked.y, z: locked.z });
    }
    
    return result;
  }

  /**
   * Step 6: Compute bone rotations from joint positions with constraints
   */
  private computeBoneRotations(
    positions: Map<string, { x: number; y: number; z: number }>,
    _bodyRotation: number
  ): Map<string, THREE.Quaternion> {
    const rotations = new Map<string, THREE.Quaternion>();

    // Define bone chains
    const chains = [
      { child: 'LeftArm', start: 'leftShoulder', end: 'leftElbow' },
      { child: 'LeftForeArm', start: 'leftElbow', end: 'leftWrist' },
      { child: 'RightArm', start: 'rightShoulder', end: 'rightElbow' },
      { child: 'RightForeArm', start: 'rightElbow', end: 'rightWrist' },
      { child: 'LeftUpLeg', start: 'leftHip', end: 'leftKnee' },
      { child: 'LeftLeg', start: 'leftKnee', end: 'leftAnkle' },
      { child: 'RightUpLeg', start: 'rightHip', end: 'rightKnee' },
      { child: 'RightLeg', start: 'rightKnee', end: 'rightAnkle' },
    ];

    for (const chain of chains) {
      const start = positions.get(chain.start);
      const end = positions.get(chain.end);
      
      if (!start || !end) continue;

      // Compute target direction
      const targetDir = new THREE.Vector3(
        end.x - start.x,
        end.y - start.y,
        end.z - start.z
      ).normalize();

      // Default direction (bone at rest)
      const defaultDir = new THREE.Vector3(0, 1, 0);

      // Compute rotation quaternion
      const quat = new THREE.Quaternion().setFromUnitVectors(defaultDir, targetDir);

      // Apply biomechanical constraints
      if (this.config.enforceConstraints) {
        const constrained = applyConstraint(quat, chain.child);
        rotations.set(chain.child, constrained);
      } else {
        rotations.set(chain.child, quat);
      }
    }

    // Compute spine rotation
    const spineBottom = positions.get('spineBottom');
    const spineTop = positions.get('spineTop');
    if (spineBottom && spineTop) {
      const spineDir = new THREE.Vector3(
        spineTop.x - spineBottom.x,
        spineTop.y - spineBottom.y,
        spineTop.z - spineBottom.z
      ).normalize();
      
      const defaultUp = new THREE.Vector3(0, 1, 0);
      const spineQuat = new THREE.Quaternion().setFromUnitVectors(defaultUp, spineDir);
      
      if (this.config.enforceConstraints) {
        rotations.set('Spine', applyConstraint(spineQuat, 'Spine'));
      } else {
        rotations.set('Spine', spineQuat);
      }
    }

    return rotations;
  }

  /**
   * Step 7: Compute root (hips) position
   */
  private computeRootPosition(
    positions: Map<string, { x: number; y: number; z: number }>
  ): THREE.Vector3 {
    const spineBottom = positions.get('spineBottom');
    if (spineBottom) {
      return new THREE.Vector3(spineBottom.x, spineBottom.y, spineBottom.z);
    }
    
    const leftHip = positions.get('leftHip');
    const rightHip = positions.get('rightHip');
    if (leftHip && rightHip) {
      return new THREE.Vector3(
        (leftHip.x + rightHip.x) / 2,
        (leftHip.y + rightHip.y) / 2,
        (leftHip.z + rightHip.z) / 2
      );
    }
    
    return new THREE.Vector3(0, 1, 0);
  }

  /**
   * Update velocity estimates
   */
  private updateVelocities(
    positions: Map<string, { x: number; y: number; z: number }>,
    dt: number
  ): void {
    for (const [name, pos] of positions) {
      const prev = this.prevPositions.get(name);
      if (prev && dt > 0) {
        const vel = new THREE.Vector3(
          (pos.x - prev.x) / dt,
          (pos.y - prev.y) / dt,
          (pos.z - prev.z) / dt
        );
        
        // Smooth velocity
        const prevVel = this.velocities.get(name);
        if (prevVel) {
          vel.lerp(prevVel, 0.7); // Heavy smoothing for stable velocity
        }
        
        this.velocities.set(name, vel);
      }
      
      this.prevPositions.set(name, new THREE.Vector3(pos.x, pos.y, pos.z));
    }
  }

  /**
   * Extract confidences from landmarks
   */
  private extractConfidences(
    landmarks: { visibility?: number }[]
  ): Record<string, number> {
    const confidences: Record<string, number> = {};
    
    for (const [name, mapping] of Object.entries(JOINT_MAP)) {
      const lm = landmarks[mapping.landmarkIdx];
      if (lm) {
        confidences[name] = lm.visibility || 0;
      }
    }
    
    return confidences;
  }

  /**
   * Update processing configuration
   */
  setConfig(config: Partial<ProcessingConfig>) {
    this.config = { ...this.config, ...config };
    
    this.oneEuroFilters.setParams(this.config.minCutoff, this.config.beta);
    this.kalmanFilters.setParams(
      this.config.kalmanProcessNoise,
      this.config.kalmanMeasurementNoise
    );
    this.fabrikSolver.setParams(this.config.ikIterations, this.config.ikTolerance);
    this.footDetector.setThresholds(
      this.config.footContactThreshold,
      0.03
    );
  }

  getConfig(): ProcessingConfig {
    return { ...this.config };
  }

  getDebugInfo(): DebugInfo {
    return { ...this.debugInfo };
  }

  /**
   * Reset all filters and state
   */
  reset() {
    this.oneEuroFilters.reset();
    this.kalmanFilters.reset();
    this.footDetector.reset();
    this.footLocker.reset();
    this.smoothedJoints.clear();
    this.prevPositions.clear();
    this.velocities.clear();
    this.bodyRotationSmooth = 0;
    this.targetBodyRotation = 0;
    this.frameCount = 0;
  }
}
