/**
 * Three.js Scene Manager for Mocap Visualization
 * Handles rendering of the skeletal rig, environment, and debug overlays
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export interface BoneMap {
  [key: string]: THREE.Bone;
}

export class ThreeScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private animationId: number | null = null;
  
  // Model
  private modelGroup: THREE.Group | null = null;
  private boneMap: BoneMap = {};
  private rootBone: THREE.Bone | null = null;
  
  // Visual helpers
  private skeletonHelper: THREE.SkeletonHelper | null = null;
  private groundPlane: THREE.Mesh | null = null;
  
  // Lights
  private ambientLight: THREE.AmbientLight;
  private keyLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  
  // Callbacks
  onBeforeRender: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d15);
    this.scene.fog = new THREE.FogExp2(0x0b0d15, 0.08);
    
    // Camera
    this.camera = new THREE.PerspectiveCamera(
      42,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 1.4, 3.2);
    
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);
    
    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.target.set(0, 1.0, 0);
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 8;
    this.controls.maxPolarAngle = Math.PI * 0.85;
    this.controls.minPolarAngle = 0.1;
    
    // Lights - 3-point lighting setup
    this.ambientLight = new THREE.AmbientLight(0x445566, 0.4);
    this.scene.add(this.ambientLight);
    
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    this.keyLight.position.set(3, 8, 5);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = 2048;
    this.keyLight.shadow.mapSize.height = 2048;
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 25;
    this.keyLight.shadow.bias = -0.001;
    this.scene.add(this.keyLight);
    
    this.fillLight = new THREE.DirectionalLight(0x88aadd, 0.4);
    this.fillLight.position.set(-5, 4, -3);
    this.scene.add(this.fillLight);
    
    this.rimLight = new THREE.DirectionalLight(0xff8866, 0.3);
    this.rimLight.position.set(-2, 6, -6);
    this.scene.add(this.rimLight);
    
    // Environment
    this.setupEnvironment();
    
    // Create default procedural skeleton
    this.createProceduralSkeleton();
    
    // Start animation loop
    this.animate();
    
    // Handle resize
    window.addEventListener('resize', this.onResize);
  }

  private setupEnvironment() {
    // Grid
    const grid = new THREE.GridHelper(10, 20, 0x14b8a6, 0x1e293b);
    grid.position.y = 0;
    this.scene.add(grid);
    
    // Floor
    const floorGeo = new THREE.PlaneGeometry(20, 20);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x090b11,
      roughness: 0.85,
      metalness: 0.15,
    });
    this.groundPlane = new THREE.Mesh(floorGeo, floorMat);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.position.y = -0.01;
    this.groundPlane.receiveShadow = true;
    this.scene.add(this.groundPlane);
    
    // Environment map (simple)
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envLight = new THREE.Mesh(
      new THREE.SphereGeometry(10, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0x223344, side: THREE.BackSide })
    );
    envScene.add(envLight);
    const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
    this.scene.environment = envMap;
  }

  /**
   * Create a procedural SKEL-inspired skeleton
   */
  private createProceduralSkeleton() {
    // Remove existing model
    if (this.modelGroup) {
      this.scene.remove(this.modelGroup);
    }
    
    this.modelGroup = new THREE.Group();
    this.boneMap = {};
    
    const group = new THREE.Group();
    const skeletonRoot = new THREE.Group();
    group.add(skeletonRoot);
    
    // Materials
    const boneMat = new THREE.MeshStandardMaterial({
      color: 0x0d9488,
      roughness: 0.3,
      metalness: 0.6,
      emissive: 0x0d9488,
      emissiveIntensity: 0.1,
    });
    
    const jointMat = new THREE.MeshStandardMaterial({
      color: 0x14b8a6,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0x14b8a6,
      emissiveIntensity: 0.2,
    });
    
    // Create hips (root)
    const hips = new THREE.Bone();
    hips.name = 'Hips';
    hips.position.set(0, 1.0, 0);
    skeletonRoot.add(hips);
    this.boneMap.Hips = hips;
    this.rootBone = hips;
    
    // Spine
    const spine = new THREE.Bone();
    spine.name = 'Spine';
    spine.position.set(0, 0.22, 0);
    hips.add(spine);
    this.boneMap.Spine = spine;
    
    // Neck
    const neck = new THREE.Bone();
    neck.name = 'Neck';
    neck.position.set(0, 0.25, 0);
    spine.add(neck);
    this.boneMap.Neck = neck;
    
    // Arms
    const armData = [
      { parent: spine, name: 'LeftArm', pos: [0.16, 0.1, 0], child: 'LeftForeArm', cpos: [0.26, 0, 0] },
      { parent: spine, name: 'RightArm', pos: [-0.16, 0.1, 0], child: 'RightForeArm', cpos: [-0.26, 0, 0] },
      { parent: hips, name: 'LeftUpLeg', pos: [0.09, -0.04, 0], child: 'LeftLeg', cpos: [0, -0.42, 0] },
      { parent: hips, name: 'RightUpLeg', pos: [-0.09, -0.04, 0], child: 'RightLeg', cpos: [0, -0.42, 0] },
    ];
    
    armData.forEach(l => {
      const pBone = new THREE.Bone();
      pBone.name = l.name;
      pBone.position.fromArray(l.pos);
      l.parent.add(pBone);
      this.boneMap[l.name] = pBone;
      
      const cBone = new THREE.Bone();
      cBone.name = l.child;
      cBone.position.fromArray(l.cpos);
      pBone.add(cBone);
      this.boneMap[l.child] = cBone;
    });
    
    // Feet
    const leftFoot = new THREE.Bone();
    leftFoot.name = 'LeftFoot';
    leftFoot.position.set(0, -0.42, 0.06);
    this.boneMap.LeftLeg.add(leftFoot);
    this.boneMap.LeftFoot = leftFoot;
    
    const rightFoot = new THREE.Bone();
    rightFoot.name = 'RightFoot';
    rightFoot.position.set(0, -0.42, 0.06);
    this.boneMap.RightLeg.add(rightFoot);
    this.boneMap.RightFoot = rightFoot;
    
    // Visual meshes for bones
    const jointGeometry = new THREE.SphereGeometry(0.035, 8, 8);
    
    Object.values(this.boneMap).forEach(bone => {
      // Joint sphere
      const joint = new THREE.Mesh(jointGeometry, jointMat);
      bone.add(joint);
    });
    
    // Add bone tubes between joints
    this.addBoneTubes(group, boneMat);
    
    this.scene.add(group);
    this.modelGroup = group;
    
    // Add skeleton helper for debug
    this.skeletonHelper = new THREE.SkeletonHelper(group);
    this.skeletonHelper.visible = false;
    this.scene.add(this.skeletonHelper);
  }

  private addBoneTubes(_group: THREE.Group, material: THREE.Material) {
    const tubeGeometry = new THREE.CylinderGeometry(0.015, 0.015, 1, 6);
    
    const connections = [
      ['Hips', 'Spine'],
      ['Spine', 'Neck'],
      ['LeftArm', 'LeftForeArm'],
      ['RightArm', 'RightForeArm'],
      ['LeftUpLeg', 'LeftLeg'],
      ['RightUpLeg', 'RightLeg'],
      ['LeftLeg', 'LeftFoot'],
      ['RightLeg', 'RightFoot'],
    ];
    
    connections.forEach(([parent, child]) => {
      const parentBone = this.boneMap[parent];
      const childBone = this.boneMap[child];
      if (!parentBone || !childBone) return;
      
      const tube = new THREE.Mesh(tubeGeometry, material);
      tube.name = `tube_${parent}_${child}`;
      tube.userData.isBoneTube = true;
      tube.userData.parentBone = parent;
      tube.userData.childBone = child;
      childBone.add(tube);
    });
  }

  /**
   * Apply bone rotations from pose processor
   */
  applyPose(
    boneRotations: Map<string, THREE.Quaternion>,
    rootPosition: THREE.Vector3,
    bodyRotation: number
  ) {
    if (!this.modelGroup) return;
    
    // Apply body rotation
    this.modelGroup.rotation.y = THREE.MathUtils.lerp(
      this.modelGroup.rotation.y,
      bodyRotation,
      0.35
    );
    
    // Apply root position
    if (this.rootBone) {
      const scale = this.modelGroup.scale.y || 1;
      this.rootBone.position.x += (rootPosition.x / scale - this.rootBone.position.x) * 0.12;
      this.rootBone.position.y += (rootPosition.y / scale - this.rootBone.position.y) * 0.12;
      this.rootBone.position.z += (rootPosition.z / scale - this.rootBone.position.z) * 0.12;
    }
    
    // Apply bone rotations with smoothing
    boneRotations.forEach((rotation, boneName) => {
      const bone = this.boneMap[boneName];
      if (bone) {
        // Smooth rotation
        bone.quaternion.slerp(rotation, 0.45);
      }
    });
    
    // Update bone tubes to connect properly
    this.updateBoneTubes();
  }

  private updateBoneTubes() {
    if (!this.modelGroup) return;
    
    this.modelGroup.traverse(child => {
      if (child.userData?.isBoneTube) {
        const parentBone = this.boneMap[child.userData.parentBone];
        const childBone = this.boneMap[child.userData.childBone];
        if (parentBone && childBone) {
          // Get world positions
          const parentPos = new THREE.Vector3();
          const childPos = new THREE.Vector3();
          parentBone.getWorldPosition(parentPos);
          childBone.getWorldPosition(childPos);
          
          // Position and orient tube
          const distance = parentPos.distanceTo(childPos);
          child.scale.y = distance;
          child.position.set(0, 0, 0);
        }
      }
    });
  }

  /**
   * Load custom GLB/FBX model
   */
  loadModel(url: string, filename: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const isFBX = filename.toLowerCase().includes('.fbx');
      const loader = isFBX ? new FBXLoader() : new GLTFLoader();
      
      loader.load(
        url,
        (asset) => {
          const model = isFBX ? (asset as any) : (asset as any).scene;
          
          // Remove old model
          if (this.modelGroup) {
            this.scene.remove(this.modelGroup);
          }
          
          this.modelGroup = model;
          this.boneMap = {};
          
          // Scale to standard height
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          if (size.y > 0.001) {
            const targetHeight = 1.65;
            const s = targetHeight / size.y;
            model.scale.set(s, s, s);
          }
          
          // Map bones
          const boneMapNames: Record<string, string[]> = {
            Hips: ['hips', 'pelvis', 'root'],
            Spine: ['spine', 'chest', 'spine1', 'spine2'],
            Neck: ['neck', 'head'],
            LeftArm: ['leftarm', 'l_upperarm', 'upperarm_l'],
            RightArm: ['rightarm', 'r_upperarm', 'upperarm_r'],
            LeftForeArm: ['leftforearm', 'l_forearm', 'lowerarm_l'],
            RightForeArm: ['rightforearm', 'r_forearm', 'lowerarm_r'],
            LeftUpLeg: ['leftupleg', 'l_thigh', 'thigh_l'],
            RightUpLeg: ['rightupleg', 'r_thigh', 'thigh_r'],
            LeftLeg: ['leftleg', 'l_calf', 'calf_l'],
            RightLeg: ['rightleg', 'r_calf', 'calf_r'],
            LeftFoot: ['leftfoot', 'l_foot', 'foot_l'],
            RightFoot: ['rightfoot', 'r_foot', 'foot_r'],
          };
          
          let matched = 0;
          model.traverse((child: any) => {
            if (child.isBone || child.type === 'Bone') {
              const nameLower = child.name.toLowerCase();
              for (const [key, aliases] of Object.entries(boneMapNames)) {
                if (this.boneMap[key]) continue;
                for (const alias of aliases) {
                  if (nameLower.includes(alias) || alias.includes(nameLower)) {
                    this.boneMap[key] = child;
                    matched++;
                    break;
                  }
                }
                if (this.boneMap[key]) break;
              }
            }
          });
          
          if (Object.keys(this.boneMap).length < 8) {
            // Fall back to procedural
            this.createProceduralSkeleton();
            reject(new Error(`Only matched ${Object.keys(this.boneMap).length} bones. Using procedural skeleton.`));
            return;
          }
          
          this.rootBone = this.boneMap.Hips || null;
          this.scene.add(model);
          
          // Update skeleton helper
          if (this.skeletonHelper) {
            this.scene.remove(this.skeletonHelper);
          }
          this.skeletonHelper = new THREE.SkeletonHelper(model);
          this.skeletonHelper.visible = false;
          this.scene.add(this.skeletonHelper);
          
          resolve();
        },
        undefined,
        (error) => {
          this.createProceduralSkeleton();
          reject(error);
        }
      );
    });
  }

  /**
   * Toggle skeleton helper visibility
   */
  toggleSkeletonHelper(visible: boolean) {
    if (this.skeletonHelper) {
      this.skeletonHelper.visible = visible;
    }
  }

  /**
   * Show/hide joint spheres
   */
  showJointSpheres(_visible: boolean) {
    // Implementation would toggle joint sphere visibility
  }

  /**
   * Set ground plane height
   */
  setGroundHeight(height: number) {
    if (this.groundPlane) {
      this.groundPlane.position.y = height - 0.01;
    }
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getBoneMap(): BoneMap {
    return this.boneMap;
  }

  getModelGroup(): THREE.Group | null {
    return this.modelGroup;
  }

  private animate = () => {
    this.animationId = requestAnimationFrame(this.animate);
    
    if (this.onBeforeRender) {
      this.onBeforeRender();
    }
    
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  /**
   * Clean up resources
   */
  dispose() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
    
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
