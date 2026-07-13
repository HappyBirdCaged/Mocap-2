/**
 * FABRIK (Forward And Backward Reaching Inverse Kinematics)
 * Based on: Aristidou, A. and Lasenby, J. "FABRIK: A fast, iterative solver for 
 * the Inverse Kinematics problem"
 * 
 * Key advantages over traditional IK:
 * - Uses points/lines instead of angle rotations (faster)
 * - Always converges when target is reachable
 * - Supports biomechanical constraints naturally
 * - 1.13ms per frame for 25 joints (76 FPS capable)
 * - Provides smooth, natural motion
 * 
 * Algorithm:
 * 1. Forward pass: Move end effector to target, propagate back to root
 * 2. Backward pass: Fix root position, propagate forward
 * 3. Repeat until convergence
 */

import * as THREE from 'three';

export interface FABRIKJoint {
  position: THREE.Vector3;
  boneLength: number;
  constraints?: FABRIKConstraints;
  name: string;
}

export interface FABRIKConstraints {
  // Cone constraint for ball-and-socket joints
  coneAngle?: number; // radians
  // Hinge constraint
  hingeAxis?: THREE.Vector3;
  minAngle?: number;
  maxAngle?: number;
  // Twist limits
  twistMin?: number;
  twistMax?: number;
}

export interface FABRIKChain {
  joints: FABRIKJoint[];
  targets: Map<number, THREE.Vector3>; // joint index -> target position
  weights: Map<number, number>; // joint index -> influence weight
}

export class FABRIKSolver {
  private maxIterations: number;
  private tolerance: number;
  private constraints: boolean;

  constructor(
    maxIterations: number = 10,
    tolerance: number = 0.001,
    useConstraints: boolean = true
  ) {
    this.maxIterations = maxIterations;
    this.tolerance = tolerance;
    this.constraints = useConstraints;
  }

  /**
   * Solve IK chain to reach target(s)
   * @param chain The kinematic chain to solve
   * @returns Final joint positions
   */
  solve(chain: FABRIKChain): THREE.Vector3[] {
    const joints = chain.joints.map(j => j.position.clone());
    const targets = chain.targets;
    
    if (targets.size === 0 || joints.length < 2) {
      return joints;
    }

    // Check if any target is close enough already
    let allConverged = false;
    
    for (let iter = 0; iter < this.maxIterations && !allConverged; iter++) {
      allConverged = true;
      
      // --- Forward reaching (from end effectors to root) ---
      // Process each target (for multi-end-effector chains)
      const targetEntries = Array.from(targets.entries());
      
      for (const [targetIdx, targetPos] of targetEntries) {
        if (targetIdx >= joints.length) continue;
        
        // Move end effector to target
        joints[targetIdx].copy(targetPos);
        
        // Propagate back toward root
        for (let i = targetIdx - 1; i >= 0; i--) {
          const dir = new THREE.Vector3()
            .subVectors(joints[i], joints[i + 1])
            .normalize();
          
          const length = chain.joints[i].boneLength;
          joints[i].copy(joints[i + 1]).add(dir.multiplyScalar(length));
          
          // Apply constraints during forward pass
          if (this.constraints && chain.joints[i].constraints) {
            this.applyConstraint(joints, i, i + 1, chain.joints[i].constraints!);
          }
        }
      }
      
      // --- Backward reaching (from root to end effectors) ---
      // Fix root position
      const rootPos = chain.joints[0].position.clone();
      joints[0].copy(rootPos);
      
      // Propagate forward
      for (let i = 1; i < joints.length; i++) {
        const dir = new THREE.Vector3()
          .subVectors(joints[i], joints[i - 1])
          .normalize();
        
        const length = chain.joints[i - 1].boneLength;
        joints[i].copy(joints[i - 1]).add(dir.multiplyScalar(length));
        
        // Apply constraints during backward pass
        if (this.constraints && chain.joints[i - 1].constraints) {
          this.applyConstraint(joints, i - 1, i, chain.joints[i - 1].constraints!);
        }
      }
      
      // Check convergence
      for (const [targetIdx, targetPos] of targetEntries) {
        if (targetIdx < joints.length) {
          const dist = joints[targetIdx].distanceTo(targetPos);
          if (dist > this.tolerance) {
            allConverged = false;
          }
        }
      }
    }
    
    return joints;
  }

  /**
   * Apply biomechanical constraints to joint position
   */
  private applyConstraint(
    joints: THREE.Vector3[],
    parentIdx: number,
    childIdx: number,
    constraints: FABRIKConstraints
  ): void {
    if (constraints.coneAngle !== undefined) {
      // Cone constraint: limit the angle between parent->child and reference direction
      const parent = joints[parentIdx];
      const child = joints[childIdx];
      
      const dir = new THREE.Vector3().subVectors(child, parent).normalize();
      const refDir = new THREE.Vector3(0, 1, 0); // Reference direction in parent's local space
      
      const angle = dir.angleTo(refDir);
      
      if (angle > constraints.coneAngle) {
        // Clamp to cone boundary
        const correctionAxis = new THREE.Vector3()
          .crossVectors(refDir, dir)
          .normalize();
        
        const clampedDir = refDir.clone()
          .applyAxisAngle(
            correctionAxis,
            constraints.coneAngle * Math.sign(angle)
          )
          .normalize();
        
        const length = child.distanceTo(parent);
        joints[childIdx].copy(parent).add(clampedDir.multiplyScalar(length));
      }
    }

    if (constraints.hingeAxis && constraints.minAngle !== undefined && constraints.maxAngle !== undefined) {
      // Hinge constraint: restrict motion to plane around hinge axis
      const parent = joints[parentIdx];
      const child = joints[childIdx];
      
      const dir = new THREE.Vector3().subVectors(child, parent);
      
      // Project direction onto hinge plane
      const axis = constraints.hingeAxis.clone().normalize();
      const projected = dir.clone().sub(axis.clone().multiplyScalar(dir.dot(axis)));
      
      if (projected.lengthSq() > 0.0001) {
        projected.normalize();
        const refDir = new THREE.Vector3(1, 0, 0); // Reference in hinge plane
        
        let angle = Math.atan2(
          projected.cross(refDir).dot(axis),
          projected.dot(refDir)
        );
        
        // Clamp angle
        angle = Math.max(constraints.minAngle, Math.min(constraints.maxAngle, angle));
        
        const clampedDir = refDir.clone()
          .applyAxisAngle(axis, angle)
          .multiplyScalar(dir.length());
        
        joints[childIdx].copy(parent).add(clampedDir);
      }
    }
  }

  /**
   * Solve IK for a single limb chain given a target
   */
  solveLimb(
    rootPos: THREE.Vector3,
    boneLengths: number[],
    targetPos: THREE.Vector3,
    constraints?: FABRIKConstraints[]
  ): THREE.Vector3[] {
    // Create chain
    const joints: FABRIKJoint[] = [];
    let pos = rootPos.clone();
    
    joints.push({
      position: pos.clone(),
      boneLength: boneLengths[0],
      name: 'root',
      constraints: constraints?.[0]
    });
    
    for (let i = 0; i < boneLengths.length; i++) {
      pos.y += boneLengths[i]; // Initial guess: straight up
      joints.push({
        position: pos.clone(),
        boneLength: boneLengths[i + 1] || 0,
        name: `joint_${i}`,
        constraints: constraints?.[i + 1]
      });
    }
    
    const chain: FABRIKChain = {
      joints,
      targets: new Map([[joints.length - 1, targetPos]]),
      weights: new Map([[joints.length - 1, 1.0]])
    };
    
    return this.solve(chain);
  }

  setParams(maxIterations: number, tolerance: number) {
    this.maxIterations = maxIterations;
    this.tolerance = tolerance;
  }
}

/**
 * Utility to extract joint angles from solved IK positions
 */
export function extractJointAngles(
  positions: THREE.Vector3[],
  parentRotations: THREE.Quaternion[]
): THREE.Quaternion[] {
  const rotations: THREE.Quaternion[] = [];
  
  for (let i = 0; i < positions.length - 1; i++) {
    const dir = new THREE.Vector3()
      .subVectors(positions[i + 1], positions[i])
      .normalize();
    
    const defaultDir = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(defaultDir, dir);
    
    // Convert to local rotation (remove parent rotation)
    if (i > 0 && parentRotations[i - 1]) {
      const parentInv = parentRotations[i - 1].clone().invert();
      quat.premultiply(parentInv);
    }
    
    rotations.push(quat);
  }
  
  return rotations;
}
