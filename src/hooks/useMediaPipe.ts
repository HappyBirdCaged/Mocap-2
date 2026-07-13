import { useState, useCallback, useRef, useEffect } from 'react';
import { Pose } from '@mediapipe/pose';
import type { Results } from '@mediapipe/pose';
import { PoseProcessor } from '@/lib/PoseProcessor';
import type { ProcessingConfig, DebugInfo, FootContactState } from '@/types';

interface MediaPipeState {
  isInitialized: boolean;
  isProcessing: boolean;
  status: string;
}

interface ProcessedPose {
  boneRotations: Map<string, import('three').Quaternion>;
  rootPosition: import('three').Vector3;
  bodyRotation: number;
  debugInfo: DebugInfo;
  footContact: FootContactState;
  landmarks: any[];
  worldLandmarks: any[];
}

interface MediaPipeActions {
  initialize: () => Promise<void>;
  startProcessing: (videoElement: HTMLVideoElement) => void;
  stopProcessing: () => void;
  setConfig: (config: Partial<ProcessingConfig>) => void;
}

export function useMediaPipe(
  onPoseProcessed?: (pose: ProcessedPose) => void
): [MediaPipeState, MediaPipeActions, ProcessedPose | null] {
  const [state, setState] = useState<MediaPipeState>({
    isInitialized: false,
    isProcessing: false,
    status: 'Not initialized',
  });

  const [lastPose, setLastPose] = useState<ProcessedPose | null>(null);

  const poseRef = useRef<Pose | null>(null);
  const processorRef = useRef<PoseProcessor | null>(null);
  const processingRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastProcessedRef = useRef(0);
  const animationFrameRef = useRef(0);

  const initialize = useCallback(async () => {
    try {
      setState(s => ({ ...s, status: 'Loading MediaPipe...' }));

      const pose = new Pose({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
      });

      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        smoothSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      await new Promise<void>((resolve) => {
        pose.onResults((results) => {
          if (results.poseLandmarks) {
            resolve();
          }
        });
        // Send a dummy image to initialize
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = 'black';
          ctx.fillRect(0, 0, 1, 1);
          pose.send({ image: canvas }).catch(() => {});
        }
        // Timeout fallback
        setTimeout(resolve, 2000);
      });

      poseRef.current = pose;
      processorRef.current = new PoseProcessor();

      setState({
        isInitialized: true,
        isProcessing: false,
        status: 'Ready',
      });
    } catch (err: any) {
      setState({
        isInitialized: false,
        isProcessing: false,
        status: `Error: ${err.message}`,
      });
    }
  }, []);

  const processFrame = useCallback(async () => {
    if (!processingRef.current || !poseRef.current || !videoRef.current) return;

    const now = performance.now();
    const minInterval = 33; // ~30 FPS max

    if (now - lastProcessedRef.current >= minInterval) {
      if (videoRef.current.readyState >= 2) {
        try {
          await poseRef.current.send({ image: videoRef.current });
        } catch (e) {
          // Silently handle frame drops
        }
      }
      lastProcessedRef.current = now;
    }

    animationFrameRef.current = requestAnimationFrame(processFrame);
  }, []);

  const startProcessing = useCallback((videoElement: HTMLVideoElement) => {
    if (!poseRef.current || !processorRef.current) return;

    videoRef.current = videoElement;
    processingRef.current = true;

    // Set up results handler
    poseRef.current.onResults((results: Results) => {
      if (!results.poseWorldLandmarks || !results.poseLandmarks) return;

      const processor = processorRef.current!;
      // Cast landmarks to expected type
      const landmarks = results.poseLandmarks as any[];
      const worldLandmarks = results.poseWorldLandmarks as any[];
      const processed = processor.process(landmarks, worldLandmarks);

      const pose: ProcessedPose = {
        boneRotations: processed.boneRotations,
        rootPosition: processed.rootPosition,
        bodyRotation: processed.bodyRotation,
        debugInfo: processed.debugInfo,
        footContact: processed.footContact,
        landmarks: results.poseLandmarks,
        worldLandmarks: results.poseWorldLandmarks,
      };

      setLastPose(pose);
      onPoseProcessed?.(pose);
    });

    // Start frame loop
    processFrame();

    setState(s => ({ ...s, isProcessing: true, status: 'Processing' }));
  }, [processFrame, onPoseProcessed]);

  const stopProcessing = useCallback(() => {
    processingRef.current = false;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    processorRef.current?.reset();
    setState(s => ({ ...s, isProcessing: false, status: 'Stopped' }));
  }, []);

  const setConfig = useCallback((config: Partial<ProcessingConfig>) => {
    processorRef.current?.setConfig(config);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      processingRef.current = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      poseRef.current?.close();
    };
  }, []);

  return [
    state,
    { initialize, startProcessing, stopProcessing, setConfig },
    lastPose,
  ];
}
