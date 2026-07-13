// Biomechanical joint constraint types
export interface JointLimits {
  // Hinge joints (elbow, knee): min/max angle in radians
  minAngle?: number;
  maxAngle?: number;
  // Ball-and-socket joints (shoulder, hip): cone angle in radians
  coneAngle?: number;
  // Twist limits for joints that support rotation around the bone axis
  twistMin?: number;
  twistMax?: number;
}

export interface BoneDefinition {
  name: string;
  parent: string | null;
  position: [number, number, number];
  length: number;
  jointType: 'hinge' | 'ball' | 'fixed';
  limits: JointLimits;
  // Default rotation axis for hinge joints
  axis?: [number, number, number];
}

export interface SKELSkeleton {
  bones: BoneDefinition[];
  // Anthropometric ratios for auto-scaling
  boneLengthRatios: Record<string, number>;
}

export interface FilteredJoint {
  x: number;
  y: number;
  z: number;
  confidence: number;
  timestamp: number;
}

export interface FootContactState {
  left: boolean;
  right: boolean;
  leftConfidence: number;
  rightConfidence: number;
  leftHeight: number;
  rightHeight: number;
}

export interface PoseFrame {
  landmarks: FilteredJoint[];
  worldLandmarks: FilteredJoint[];
  segmentationMask?: ImageData;
  timestamp: number;
}

export interface IKTarget {
  boneName: string;
  position: [number, number, number];
  weight: number;
  confidence: number;
}

export interface DebugInfo {
  fps: number;
  filterLatency: number;
  ikIterations: number;
  activeConstraints: number;
  footContact: FootContactState;
  jointConfidences: Record<string, number>;
  bodyRotation: number;
  rootHeight: number;
}

export interface ProcessingConfig {
  // One Euro Filter parameters
  minCutoff: number;
  beta: number;
  dCutoff: number;
  
  // Kalman filter parameters
  kalmanProcessNoise: number;
  kalmanMeasurementNoise: number;
  
  // IK parameters
  ikIterations: number;
  ikTolerance: number;
  
  // Foot contact
  footContactThreshold: number;
  footLockHeight: number;
  
  // Joint constraints
  enforceConstraints: boolean;
  constraintStrength: number;
  
  // Smoothing
  rotationSmoothing: number;
  positionSmoothing: number;
  
  // Confidence
  minVisibilityThreshold: number;
  confidenceWeighting: boolean;
}

export const DEFAULT_CONFIG: ProcessingConfig = {
  minCutoff: 0.8,
  beta: 0.02,
  dCutoff: 1.0,
  
  kalmanProcessNoise: 0.01,
  kalmanMeasurementNoise: 0.1,
  
  ikIterations: 10,
  ikTolerance: 0.001,
  
  footContactThreshold: 0.08,
  footLockHeight: 0.01,
  
  enforceConstraints: true,
  constraintStrength: 1.0,
  
  rotationSmoothing: 0.25,
  positionSmoothing: 0.12,
  
  minVisibilityThreshold: 0.45,
  confidenceWeighting: true,
};
