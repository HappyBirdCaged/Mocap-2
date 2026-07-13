/**
 * Foot Contact Detection and Ground Locking System
 * 
 * Based on research from:
 * - "UnderPressure: Deep Learning for Foot Contact Detection" (Mourot et al., 2022)
 * - "Towards Stable Human Pose Estimation via Cross-View Fusion and Foot-Ground Contact" (Zhuo et al., CVPR 2023)
 * 
 * Key features:
 * - Detects when feet are in contact with ground based on height and velocity
 * - Locks foot position when contact is detected to prevent foot sliding
 * - Uses hysteresis to prevent rapid contact state switching
 * - Estimates ground plane height automatically
 */

import * as THREE from 'three';
import type { FootContactState } from '@/types';

export class FootContactDetector {
  private leftHeights: number[] = [];
  private rightHeights: number[] = [];
  private groundHeight: number = 0;
  private historySize: number = 5;
  private contactThreshold: number;
  private velocityThreshold: number;
  private hysteresisFrames: number = 3;
  private leftContactCount: number = 0;
  private rightContactCount: number = 0;
  private leftNoContactCount: number = 0;
  private rightNoContactCount: number = 0;

  constructor(
    contactThreshold: number = 0.08,
    velocityThreshold: number = 0.03
  ) {
    this.contactThreshold = contactThreshold;
    this.velocityThreshold = velocityThreshold;
  }

  /**
   * Detect foot contact state based on ankle position and velocity
   * @param leftAnklePos Current left ankle position
   * @param rightAnklePos Current right ankle position
   * @param leftAnkleVel Left ankle vertical velocity
   * @param rightAnkleVel Right ankle vertical velocity
   * @returns Foot contact state for both feet
   */
  detect(
    leftAnklePos: THREE.Vector3,
    rightAnklePos: THREE.Vector3,
    leftAnkleVel: number = 0,
    rightAnkleVel: number = 0
  ): FootContactState {
    // Update ground height estimate (lowest ankle position with smoothing)
    const minHeight = Math.min(leftAnklePos.y, rightAnklePos.y);
    this.groundHeight = this.groundHeight * 0.95 + minHeight * 0.05;

    // Store heights
    this.leftHeights.push(leftAnklePos.y - this.groundHeight);
    this.rightHeights.push(rightAnklePos.y - this.groundHeight);
    if (this.leftHeights.length > this.historySize) {
      this.leftHeights.shift();
      this.rightHeights.shift();
    }

    // Compute average recent heights
    const leftAvgHeight = this.leftHeights.reduce((a, b) => a + b, 0) / this.leftHeights.length;
    const rightAvgHeight = this.rightHeights.reduce((a, b) => a + b, 0) / this.rightHeights.length;

    // Detect contact based on height and velocity
    const leftNearGround = leftAvgHeight < this.contactThreshold;
    const rightNearGround = rightAvgHeight < this.contactThreshold;
    const leftLowVel = Math.abs(leftAnkleVel) < this.velocityThreshold;
    const rightLowVel = Math.abs(rightAnkleVel) < this.velocityThreshold;

    // Raw contact detection
    const leftRawContact = leftNearGround && leftLowVel;
    const rightRawContact = rightNearGround && rightLowVel;

    // Apply hysteresis to prevent flickering
    const leftContact = this.applyHysteresis(leftRawContact, 'left');
    const rightContact = this.applyHysteresis(rightRawContact, 'right');

    // Compute contact confidence based on how firmly planted
    const leftConfidence = Math.max(0, 1 - leftAvgHeight / this.contactThreshold);
    const rightConfidence = Math.max(0, 1 - rightAvgHeight / this.contactThreshold);

    return {
      left: leftContact,
      right: rightContact,
      leftConfidence,
      rightConfidence,
      leftHeight: leftAnklePos.y,
      rightHeight: rightAnklePos.y,
    };
  }

  private applyHysteresis(rawContact: boolean, foot: 'left' | 'right'): boolean {
    if (foot === 'left') {
      if (rawContact) {
        this.leftContactCount++;
        this.leftNoContactCount = 0;
        return this.leftContactCount >= this.hysteresisFrames;
      } else {
        this.leftNoContactCount++;
        this.leftContactCount = 0;
        return this.leftNoContactCount < this.hysteresisFrames;
      }
    } else {
      if (rawContact) {
        this.rightContactCount++;
        this.rightNoContactCount = 0;
        return this.rightContactCount >= this.hysteresisFrames;
      } else {
        this.rightNoContactCount++;
        this.rightContactCount = 0;
        return this.rightNoContactCount < this.hysteresisFrames;
      }
    }
  }

  /**
   * Get the estimated ground plane height
   */
  getGroundHeight(): number {
    return this.groundHeight;
  }

  /**
   * Reset contact detector
   */
  reset() {
    this.leftHeights = [];
    this.rightHeights = [];
    this.groundHeight = 0;
    this.leftContactCount = 0;
    this.rightContactCount = 0;
    this.leftNoContactCount = 0;
    this.rightNoContactCount = 0;
  }

  setThresholds(contactThreshold: number, velocityThreshold: number) {
    this.contactThreshold = contactThreshold;
    this.velocityThreshold = velocityThreshold;
  }
}

/**
 * Foot locking system - prevents foot sliding when in contact
 */
export class FootLocker {
  private leftLockPosition: THREE.Vector3 | null = null;
  private rightLockPosition: THREE.Vector3 | null = null;
  private lockInfluence: number = 0.85; // How strongly to lock (0-1)
  private unlockSpeed: number = 0.15; // Speed of transition when unlocking

  /**
   * Apply foot locking to prevent sliding
   * @param currentPos Current foot/ankle position
   * @param isContact Whether foot is in contact with ground
   * @param foot Which foot ('left' or 'right')
   * @returns Adjusted position with locking applied
   */
  lock(
    currentPos: THREE.Vector3,
    isContact: boolean,
    foot: 'left' | 'right'
    ): THREE.Vector3 {
    if (isContact) {
      // Lock foot in place
      if (foot === 'left') {
        if (this.leftLockPosition === null) {
          this.leftLockPosition = currentPos.clone();
        }
        // Blend between locked position and current
        return new THREE.Vector3().lerpVectors(
          currentPos,
          this.leftLockPosition,
          this.lockInfluence
        );
      } else {
        if (this.rightLockPosition === null) {
          this.rightLockPosition = currentPos.clone();
        }
        return new THREE.Vector3().lerpVectors(
          currentPos,
          this.rightLockPosition,
          this.lockInfluence
        );
      }
    } else {
      // Unlock foot
      if (foot === 'left') {
        if (this.leftLockPosition) {
          const unlocked = new THREE.Vector3().lerpVectors(
            this.leftLockPosition,
            currentPos,
            this.unlockSpeed
          );
          this.leftLockPosition = null;
          return unlocked;
        }
      } else {
        if (this.rightLockPosition) {
          const unlocked = new THREE.Vector3().lerpVectors(
            this.rightLockPosition,
            currentPos,
            this.unlockSpeed
          );
          this.rightLockPosition = null;
          return unlocked;
        }
      }
      return currentPos;
    }
  }

  reset() {
    this.leftLockPosition = null;
    this.rightLockPosition = null;
  }
}
