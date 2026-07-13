/**
 * Biomechanical Joint Constraints based on SKEL model research
 * 
 * Implements anatomically accurate joint limits for human skeleton:
 * - Hinge joints (elbow, knee): 1-DoF flexion/extension
 * - Ball-and-socket joints (shoulder, hip): 3-DoF with cone limits
 * - Pivot joints (neck, spine): limited rotation ranges
 * - Fixed joints (pelvis connection): no rotation
 * 
 * References:
 * - SKEL-CF: Coarse-to-Fine Biomechanical Skeleton (2025)
 * - "Biomechanically Accurate Neural Inverse Kinematics" (ECCV 2024)
 * - "Motion Capture with Constrained Inverse Kinematics" (Aristidou)
 */

import * as THREE from 'three';

export interface JointConstraint {
  type: 'hinge' | 'ball' | 'cone' | 'twist' | 'fixed';
  axis?: THREE.Vector3; // Rotation axis for hinge
  minAngle?: number; // radians
  maxAngle?: number; // radians
  coneAngle?: number; // radians (half-angle of motion cone)
  twistMin?: number; // radians
  twistMax?: number; // radians
  parentAxis?: THREE.Vector3; // Parent bone direction
}

// SKEL-based anthropometric bone lengths (relative to height)
export const SKEL_BONE_RATIOS: Record<string, number> = {
  Hips: 0.0, // Root reference
  Spine: 0.12, // Lumbar + thoracic
  Neck: 0.05,
  Head: 0.08,
  LeftArm: 0.14, // Upper arm
  LeftForeArm: 0.12, // Forearm
  LeftHand: 0.06,
  RightArm: 0.14,
  RightForeArm: 0.12,
  RightHand: 0.06,
  LeftUpLeg: 0.18, // Thigh
  LeftLeg: 0.18, // Calf
  LeftFoot: 0.06,
  RightUpLeg: 0.18,
  RightLeg: 0.18,
  RightFoot: 0.06,
};

// Total leg chain length for floor contact calculations
export const LEG_CHAIN_LENGTH = SKEL_BONE_RATIOS.LeftUpLeg + SKEL_BONE_RATIOS.LeftLeg;

// SKEL-based joint constraints (angles in radians)
export const SKEL_JOINT_CONSTRAINTS: Record<string, JointConstraint> = {
  // Hinge joints - flexion/extension only
  LeftElbow: {
    type: 'hinge',
    axis: new THREE.Vector3(1, 0, 0),
    minAngle: 0.05, // ~3 degrees (almost straight)
    maxAngle: 2.35, // ~135 degrees (bent)
  },
  RightElbow: {
    type: 'hinge',
    axis: new THREE.Vector3(-1, 0, 0),
    minAngle: 0.05,
    maxAngle: 2.35,
  },
  LeftKnee: {
    type: 'hinge',
    axis: new THREE.Vector3(1, 0, 0),
    minAngle: 0.0, // Leg can be straight
    maxAngle: 2.35, // ~135 degrees bent
  },
  RightKnee: {
    type: 'hinge',
    axis: new THREE.Vector3(-1, 0, 0),
    minAngle: 0.0,
    maxAngle: 2.35,
  },
  LeftAnkle: {
    type: 'hinge',
    axis: new THREE.Vector3(1, 0, 0),
    minAngle: -0.79, // Dorsiflexion ~45deg
    maxAngle: 0.79, // Plantarflexion ~45deg
  },
  RightAnkle: {
    type: 'hinge',
    axis: new THREE.Vector3(-1, 0, 0),
    minAngle: -0.79,
    maxAngle: 0.79,
  },

  // Ball-and-socket joints with cone limits
  LeftShoulder: {
    type: 'ball',
    coneAngle: 2.4, // ~137 degrees of abduction
    twistMin: -1.57, // ~90 degrees internal rotation
    twistMax: 1.57, // ~90 degrees external rotation
  },
  RightShoulder: {
    type: 'ball',
    coneAngle: 2.4,
    twistMin: -1.57,
    twistMax: 1.57,
  },
  LeftHip: {
    type: 'ball',
    coneAngle: 2.0, // ~115 degrees flexion
    twistMin: -0.79, // ~45 degrees internal
    twistMax: 0.79, // ~45 degrees external
  },
  RightHip: {
    type: 'ball',
    coneAngle: 2.0,
    twistMin: -0.79,
    twistMax: 0.79,
  },

  // Spine/Neck - limited pivot
  Spine: {
    type: 'cone',
    coneAngle: 0.6, // ~35 degrees
    twistMin: -0.52, // ~30 degrees
    twistMax: 0.52,
  },
  Neck: {
    type: 'cone',
    coneAngle: 0.8, // ~45 degrees
    twistMin: -1.04, // ~60 degrees
    twistMax: 1.04,
  },
};

/**
 * Apply biomechanical constraint to a quaternion rotation
 * @param quat Input rotation quaternion
 * @param boneName Name of the bone for constraint lookup
 * @returns Constrained quaternion
 */
export function applyConstraint(quat: THREE.Quaternion, boneName: string): THREE.Quaternion {
  const constraint = SKEL_JOINT_CONSTRAINTS[boneName];
  if (!constraint) return quat.clone();

  const result = quat.clone();

  switch (constraint.type) {
    case 'hinge':
      return applyHingeConstraint(result, constraint);
    case 'ball':
      return applyBallConstraint(result, constraint);
    case 'cone':
      return applyConeConstraint(result, constraint);
    case 'fixed':
      return new THREE.Quaternion(0, 0, 0, 1);
    default:
      return result;
  }
}

function applyHingeConstraint(
  quat: THREE.Quaternion,
  constraint: JointConstraint
): THREE.Quaternion {
  if (!constraint.axis || constraint.minAngle === undefined || constraint.maxAngle === undefined) {
    return quat;
  }

  // Extract rotation around hinge axis
  const axis = constraint.axis.clone().normalize();
  
  // Decompose quaternion into axis-angle
  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, quat.w)));
  let rotAxis: THREE.Vector3;
  
  if (Math.abs(angle) < 0.001) {
    return quat; // No rotation
  }
  
  const sinHalfAngle = Math.sqrt(1 - quat.w * quat.w);
  if (sinHalfAngle < 0.001) {
    rotAxis = new THREE.Vector3(1, 0, 0);
  } else {
    rotAxis = new THREE.Vector3(
      quat.x / sinHalfAngle,
      quat.y / sinHalfAngle,
      quat.z / sinHalfAngle
    );
  }

  // Project rotation onto hinge axis
  const projection = rotAxis.dot(axis);
  const projectedAxis = axis.clone().multiplyScalar(projection).normalize();
  
  if (projectedAxis.lengthSq() < 0.001) {
    return new THREE.Quaternion(0, 0, 0, 1); // No rotation along hinge
  }

  // Clamp angle
  const clampedAngle = Math.max(constraint.minAngle, Math.min(constraint.maxAngle, angle * Math.sign(projection)));
  
  const halfAngle = clampedAngle / 2;
  const sinHalf = Math.sin(halfAngle);
  
  return new THREE.Quaternion(
    projectedAxis.x * sinHalf,
    projectedAxis.y * sinHalf,
    projectedAxis.z * sinHalf,
    Math.cos(halfAngle)
  );
}

function applyBallConstraint(
  quat: THREE.Quaternion,
  constraint: JointConstraint
): THREE.Quaternion {
  if (constraint.coneAngle === undefined) return quat;

  // Convert to axis-angle
  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, quat.w)));
  
  if (angle < 0.001) return quat;

  // Clamp cone angle
  const clampedAngle = Math.min(constraint.coneAngle, angle);
  
  const sinHalfAngle = Math.sqrt(1 - quat.w * quat.w);
  if (sinHalfAngle < 0.001) return quat;

  const axis = new THREE.Vector3(
    quat.x / sinHalfAngle,
    quat.y / sinHalfAngle,
    quat.z / sinHalfAngle
  ).normalize();

  const halfAngle = clampedAngle / 2;
  const sinHalf = Math.sin(halfAngle);

  const result = new THREE.Quaternion(
    axis.x * sinHalf,
    axis.y * sinHalf,
    axis.z * sinHalf,
    Math.cos(halfAngle)
  );

  // Apply twist limits if specified
  if (constraint.twistMin !== undefined && constraint.twistMax !== undefined) {
    return applyTwistLimit(result, constraint);
  }

  return result;
}

function applyConeConstraint(
  quat: THREE.Quaternion,
  constraint: JointConstraint
): THREE.Quaternion {
  // Similar to ball constraint but typically for spine/neck
  return applyBallConstraint(quat, constraint);
}

function applyTwistLimit(
  quat: THREE.Quaternion,
  constraint: JointConstraint
): THREE.Quaternion {
  if (constraint.twistMin === undefined || constraint.twistMax === undefined) {
    return quat;
  }

  // Decompose into swing and twist
  // For simplicity, we clamp the overall rotation
  const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
  
  // Clamp twist (typically around Y axis for limbs)
  euler.y = Math.max(constraint.twistMin, Math.min(constraint.twistMax, euler.y));
  
  return new THREE.Quaternion().setFromEuler(euler);
}

/**
 * Clamp a quaternion's rotation angle to a maximum
 */
export function clampRotationAngle(quat: THREE.Quaternion, maxAngle: number): THREE.Quaternion {
  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, quat.w)));
  
  if (angle <= maxAngle) return quat.clone();

  const sinHalfAngle = Math.sqrt(1 - quat.w * quat.w);
  if (sinHalfAngle < 0.001) return quat.clone();

  const axis = new THREE.Vector3(
    quat.x / sinHalfAngle,
    quat.y / sinHalfAngle,
    quat.z / sinHalfAngle
  ).normalize();

  const halfAngle = maxAngle / 2;
  const sinHalf = Math.sin(halfAngle);

  return new THREE.Quaternion(
    axis.x * sinHalf,
    axis.y * sinHalf,
    axis.z * sinHalf,
    Math.cos(halfAngle)
  );
}

/**
 * Get bone length from SKEL ratios scaled to target height
 */
export function getBoneLength(boneName: string, targetHeight: number = 1.7): number {
  const ratio = SKEL_BONE_RATIOS[boneName];
  if (ratio === undefined) return 0.1;
  return ratio * targetHeight;
}

/**
 * Create a full SKEL skeleton with proper proportions
 */
export function createSKELSkeleton(height: number = 1.7): {
  bones: string[];
  positions: Map<string, THREE.Vector3>;
  constraints: Map<string, JointConstraint>;
} {
  const bones = [
    'Hips', 'Spine', 'Neck', 'Head',
    'LeftArm', 'LeftForeArm', 'LeftHand',
    'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot',
    'RightUpLeg', 'RightLeg', 'RightFoot'
  ];

  const positions = new Map<string, THREE.Vector3>();
  const h = height;

  // Root at origin (will be positioned by tracking)
  positions.set('Hips', new THREE.Vector3(0, 0, 0));
  positions.set('Spine', new THREE.Vector3(0, h * 0.12, 0));
  positions.set('Neck', new THREE.Vector3(0, h * 0.05, 0));
  positions.set('Head', new THREE.Vector3(0, h * 0.08, 0));

  // Arms
  positions.set('LeftArm', new THREE.Vector3(h * 0.14, h * 0.12, 0));
  positions.set('LeftForeArm', new THREE.Vector3(h * 0.12, 0, 0));
  positions.set('LeftHand', new THREE.Vector3(h * 0.06, 0, 0));
  
  positions.set('RightArm', new THREE.Vector3(-h * 0.14, h * 0.12, 0));
  positions.set('RightForeArm', new THREE.Vector3(-h * 0.12, 0, 0));
  positions.set('RightHand', new THREE.Vector3(-h * 0.06, 0, 0));

  // Legs
  positions.set('LeftUpLeg', new THREE.Vector3(h * 0.09, -h * 0.18, 0));
  positions.set('LeftLeg', new THREE.Vector3(0, -h * 0.18, 0));
  positions.set('LeftFoot', new THREE.Vector3(0, -h * 0.06, h * 0.04));
  
  positions.set('RightUpLeg', new THREE.Vector3(-h * 0.09, -h * 0.18, 0));
  positions.set('RightLeg', new THREE.Vector3(0, -h * 0.18, 0));
  positions.set('RightFoot', new THREE.Vector3(0, -h * 0.06, h * 0.04));

  const constraints = new Map<string, JointConstraint>();
  Object.entries(SKEL_JOINT_CONSTRAINTS).forEach(([name, constraint]) => {
    constraints.set(name, constraint);
  });

  return { bones, positions, constraints };
}
