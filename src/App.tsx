import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import { usePeerConnection } from '@/hooks/usePeerConnection';
import { useMediaPipe } from '@/hooks/useMediaPipe';
import { ThreeScene } from '@/lib/ThreeScene';
import type { ProcessingConfig } from '@/types';
import {
  Monitor,
  Smartphone,
  Link2,
  Unlink,
  Settings,
  Activity,
  Footprints,
  RotateCcw,
  Upload,
  Globe,
  Zap,
  Eye,
  EyeOff,
  Bug,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { DebugInfo } from '@/types';

type AppMode = 'setup' | 'display' | 'camera';

function App() {
  const [mode, setMode] = useState<AppMode>('setup');
  const [showSettings, setShowSettings] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [cameraCode, setCameraCode] = useState('');
  const [modelUrl, setModelUrl] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [config, setConfig] = useState<ProcessingConfig>({
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
  });

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const threeSceneRef = useRef<ThreeScene | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const debugPoseRef = useRef<any>(null);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-99), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // Three.js scene setup
  useEffect(() => {
    if (mode === 'display' && canvasContainerRef.current && !threeSceneRef.current) {
      try {
        const scene = new ThreeScene(canvasContainerRef.current);
        threeSceneRef.current = scene;
        addLog('Three.js scene initialized');
      } catch (err: any) {
        addLog(`Scene error: ${err.message}`);
      }
    }

    return () => {
      if (mode !== 'display') {
        threeSceneRef.current?.dispose();
        threeSceneRef.current = null;
      }
    };
  }, [mode, addLog]);

  // Handle pose updates
  const handlePoseProcessed = useCallback((pose: any) => {
    debugPoseRef.current = pose;
    
    if (threeSceneRef.current) {
      threeSceneRef.current.applyPose(
        pose.boneRotations,
        pose.rootPosition,
        pose.bodyRotation
      );
    }
  }, []);

  // Peer connection
  const [peerState, peerActions] = usePeerConnection((stream) => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
      remoteVideoRef.current.play();
      addLog('Stream received from camera');
    }
    
    // Start MediaPipe processing on the stream
    if (mediaPipeState.isInitialized) {
      mediaPipeActions.startProcessing(remoteVideoRef.current!);
    } else {
      mediaPipeActions.initialize().then(() => {
        if (remoteVideoRef.current) {
          mediaPipeActions.startProcessing(remoteVideoRef.current);
        }
      });
    }
  });

  // MediaPipe
  const [mediaPipeState, mediaPipeActions, lastPose] = useMediaPipe(handlePoseProcessed);

  // Console override for logs
  useEffect(() => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args) => {
      originalLog(...args);
      addLog(args.join(' '));
    };
    console.warn = (...args) => {
      originalWarn(...args);
      addLog(`WARN: ${args.join(' ')}`);
    };
    console.error = (...args) => {
      originalError(...args);
      addLog(`ERROR: ${args.join(' ')}`);
    };

    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, [addLog]);

  // Mode handlers
  const handleStartDisplay = () => {
    setMode('display');
    peerActions.startAsDisplay();
    addLog('Display mode started');
  };

  const handleStartCamera = () => {
    setMode('camera');
    peerActions.startAsCamera();
    addLog('Camera mode started');
  };

  const handleConnectCamera = async () => {
    if (cameraCode.length === 5) {
      await peerActions.connectToDisplay(cameraCode);
      addLog(`Connecting to display: ${cameraCode}`);
    }
  };

  const handleReset = () => {
    peerActions.disconnect();
    mediaPipeActions.stopProcessing();
    threeSceneRef.current?.dispose();
    threeSceneRef.current = null;
    setMode('setup');
    setLogs([]);
    addLog('Reset complete');
  };

  const handleModelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const url = URL.createObjectURL(file);
    threeSceneRef.current?.loadModel(url, file.name)
      .then(() => addLog(`Model loaded: ${file.name}`))
      .catch(err => addLog(`Model load failed: ${err.message}`));
  };

  const handleModelUrlLoad = () => {
    if (!modelUrl) return;
    const name = modelUrl.split('/').pop() || 'model';
    threeSceneRef.current?.loadModel(modelUrl, name)
      .then(() => addLog(`Model loaded from URL: ${name}`))
      .catch(err => addLog(`Model load failed: ${err.message}`));
  };

  const handleConfigChange = (key: keyof ProcessingConfig, value: any) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    mediaPipeActions.setConfig(newConfig);
  };

  const toggleSkeleton = () => {
    setShowSkeleton(!showSkeleton);
    threeSceneRef.current?.toggleSkeletonHelper(!showSkeleton);
  };

  // Debug info
  const debugInfo: DebugInfo = lastPose?.debugInfo || {
    fps: 0,
    filterLatency: 0,
    ikIterations: 0,
    activeConstraints: 0,
    footContact: { left: false, right: false, leftConfidence: 0, rightConfidence: 0, leftHeight: 0, rightHeight: 0 },
    jointConfidences: {},
    bodyRotation: 0,
    rootHeight: 0,
  };

  // Render setup screen
  if (mode === 'setup') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full bg-slate-900/90 border-slate-800">
          <CardHeader className="text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Zap className="w-6 h-6 text-teal-400" />
              <CardTitle className="text-2xl font-bold text-white tracking-wider">
                SKEL-Mirror Pro
              </CardTitle>
            </div>
            <p className="text-slate-400 text-sm">
              Biomechanical motion capture with real-time constraints
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-4">
              <Button
                onClick={handleStartDisplay}
                className="h-auto py-6 bg-teal-600 hover:bg-teal-500 text-white flex flex-col items-center gap-2"
              >
                <Monitor className="w-8 h-8" />
                <div>
                  <div className="font-semibold text-lg">Display Screen</div>
                  <div className="text-xs text-teal-100/70">
                    PC/Laptop - Load 3D models, process tracking
                  </div>
                </div>
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-slate-800" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-slate-900 px-2 text-slate-600">or</span>
                </div>
              </div>

              <Button
                onClick={handleStartCamera}
                variant="outline"
                className="h-auto py-6 border-slate-700 hover:bg-slate-800 text-slate-300 flex flex-col items-center gap-2"
              >
                <Smartphone className="w-8 h-8" />
                <div>
                  <div className="font-semibold text-lg">Phone Camera</div>
                  <div className="text-xs text-slate-500">
                    Stream camera to display for processing
                  </div>
                </div>
              </Button>
            </div>

            <div className="text-center text-xs text-slate-600">
              <p>Features: One Euro Filter, Kalman prediction, FABRIK IK,</p>
              <p>SKEL constraints, foot contact detection</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render camera mode
  if (mode === 'camera') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <Card className="max-w-md w-full bg-slate-900/90 border-slate-800">
          <CardHeader className="text-center">
            <div className="flex items-center justify-center gap-2">
              <Smartphone className="w-5 h-5 text-teal-400" />
              <CardTitle className="text-white">Camera Streamer</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {peerState.status !== 'connected' ? (
              <div className="space-y-3">
                <Label className="text-slate-400 text-xs uppercase tracking-wider">
                  Enter Code from Display
                </Label>
                <input
                  type="text"
                  value={cameraCode}
                  onChange={(e) => setCameraCode(e.target.value.toUpperCase().slice(0, 5))}
                  placeholder="ABCDE"
                  maxLength={5}
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-lg text-center font-mono text-2xl tracking-widest text-teal-400 focus:outline-none focus:border-teal-500"
                />
                <Button
                  onClick={handleConnectCamera}
                  disabled={cameraCode.length !== 5}
                  className="w-full bg-teal-600 hover:bg-teal-500"
                >
                  <Link2 className="w-4 h-4 mr-2" />
                  Connect & Stream
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative bg-black rounded-lg overflow-hidden aspect-[9/16] max-h-[60vh] mx-auto">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                    style={{ transform: 'scaleX(-1)' }}
                  />
                  <div className="absolute bottom-2 left-2 bg-black/70 text-xs px-2 py-1 rounded text-teal-300">
                    Live
                  </div>
                </div>
                <Button
                  onClick={handleReset}
                  variant="destructive"
                  className="w-full"
                >
                  <Unlink className="w-4 h-4 mr-2" />
                  Disconnect
                </Button>
              </div>
            )}

            <Badge
              variant={peerState.status === 'connected' ? 'default' : 'secondary'}
              className="w-full justify-center"
            >
              {peerState.status === 'connected' ? 'Connected' : peerState.status}
            </Badge>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render display mode
  return (
    <div className="h-screen flex flex-col bg-slate-950 overflow-hidden">
      {/* Header */}
      <header className="bg-slate-900/95 border-b border-slate-800 p-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-teal-400" />
          <span className="text-lg font-bold tracking-wider text-teal-400">
            SKEL-Mirror
          </span>
          <Badge variant="outline" className="text-[10px] border-teal-800 text-teal-300 bg-teal-950/50 hidden sm:inline-flex">
            biomech mocap pro
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSkeleton}
            className="text-slate-400 hover:text-teal-400"
          >
            {showSkeleton ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDebug(!showDebug)}
            className="text-slate-400 hover:text-teal-400"
          >
            <Bug className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
            className="text-slate-400 hover:text-teal-400"
          >
            <Settings className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="text-slate-400 hover:text-red-400"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* 3D Canvas */}
        <div
          ref={canvasContainerRef}
          className="flex-1 relative"
        />

        {/* Hidden video for MediaPipe */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          muted
          className="hidden"
        />

        {/* PiP Canvas */}
        {peerState.stream && (
          <div className="absolute bottom-4 right-4 w-40 h-28 bg-black rounded-xl overflow-hidden border border-slate-800 shadow-xl">
            <canvas
              ref={pipCanvasRef}
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
            <div className="absolute bottom-1 left-1 bg-black/70 text-[8px] px-1.5 py-0.5 rounded text-slate-400">
              Camera Feed
            </div>
          </div>
        )}

        {/* Dashboard Panel */}
        <div className="absolute top-4 left-4 w-80 max-h-[calc(100vh-80px)] overflow-y-auto">
          <Card className="bg-slate-900/90 border-slate-800 backdrop-blur-sm">
            <CardContent className="p-4 space-y-4">
              {/* Connection Code */}
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/50">
                <Label className="text-[10px] uppercase text-slate-500 tracking-wider">
                  Connection Code
                </Label>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-2xl font-mono font-bold text-teal-400">
                    {peerState.connectionCode || '---'}
                  </span>
                  <span className="text-[10px] text-slate-500">enter on phone</span>
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between">
                <Badge
                  variant={peerState.status === 'connected' ? 'default' : 'secondary'}
                  className={
                    peerState.status === 'connected'
                      ? 'bg-green-900/50 text-green-400 border-green-800'
                      : 'bg-slate-800 text-slate-400'
                  }
                >
                  {peerState.status === 'connected' ? (
                    <Activity className="w-3 h-3 mr-1" />
                  ) : null}
                  {peerState.status}
                </Badge>
                <span className="text-xs text-slate-500 font-mono">
                  {debugInfo.fps} FPS
                </span>
              </div>

              {/* Foot Contact */}
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/50">
                <div className="flex items-center gap-2 mb-2">
                  <Footprints className="w-4 h-4 text-teal-400" />
                  <span className="text-xs font-medium text-slate-300">Foot Contact</span>
                </div>
                <div className="flex gap-3">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        debugInfo.footContact.left
                          ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]'
                          : 'bg-slate-700'
                      }`}
                    />
                    <span className="text-xs text-slate-400">L</span>
                    <span className="text-[10px] text-slate-600 font-mono">
                      {(debugInfo.footContact.leftConfidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        debugInfo.footContact.right
                          ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]'
                          : 'bg-slate-700'
                      }`}
                    />
                    <span className="text-xs text-slate-400">R</span>
                    <span className="text-[10px] text-slate-600 font-mono">
                      {(debugInfo.footContact.rightConfidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Body Rotation */}
              <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/50">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-300">Body Rotation</span>
                  <span className="text-xs font-mono text-teal-400">
                    {(debugInfo.bodyRotation * 180 / Math.PI).toFixed(1)}°
                  </span>
                </div>
                <div className="mt-2 h-1 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-teal-500 rounded-full transition-all"
                    style={{
                      width: `${Math.min(Math.abs(debugInfo.bodyRotation * 180 / Math.PI) / 90 * 100, 100)}%`,
                      marginLeft: debugInfo.bodyRotation < 0 ? 'auto' : '0',
                      marginRight: debugInfo.bodyRotation > 0 ? 'auto' : '0',
                    }}
                  />
                </div>
              </div>

              {/* Model Upload */}
              <div className="space-y-2">
                <Label className="text-xs text-slate-400">Custom Avatar</Label>
                <label className="flex flex-col items-center justify-center w-full h-16 border-2 border-dashed border-slate-800 hover:border-teal-600 bg-slate-950/60 rounded-xl cursor-pointer transition p-2">
                  <Upload className="w-4 h-4 text-slate-500 mb-1" />
                  <span className="text-[10px] text-slate-500">Drop GLB/GLTF/FBX</span>
                  <input
                    type="file"
                    accept=".glb,.gltf,.fbx"
                    className="hidden"
                    onChange={handleModelUpload}
                  />
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={modelUrl}
                    onChange={(e) => setModelUrl(e.target.value)}
                    placeholder="GLB/FBX URL..."
                    className="flex-1 p-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 focus:outline-none focus:border-teal-500"
                  />
                  <Button size="sm" variant="secondary" onClick={handleModelUrlLoad}>
                    <Globe className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              {/* Active Rig Info */}
              <div className="text-[11px] text-slate-500 border-t border-slate-800/60 pt-3">
                <div>
                  <span className="text-slate-400">Active:</span> SKEL biomech rig
                </div>
                <div>Constraints: {debugInfo.activeConstraints} joints</div>
                <div>Latency: {debugInfo.filterLatency.toFixed(1)}ms</div>
              </div>
            </CardContent>
          </Card>

          {/* Settings Panel */}
          {showSettings && (
            <Card className="mt-2 bg-slate-900/90 border-slate-800 backdrop-blur-sm">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm text-white flex items-center gap-2">
                  <Settings className="w-4 h-4 text-teal-400" />
                  Processing Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-4">
                <ScrollArea className="h-64">
                  <div className="space-y-4 pr-3">
                    {/* One Euro Filter */}
                    <div className="space-y-2">
                      <Label className="text-xs text-teal-400">One Euro Filter</Label>
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span>Min Cutoff</span>
                          <span>{config.minCutoff.toFixed(2)}</span>
                        </div>
                        <Slider
                          value={[config.minCutoff]}
                          onValueChange={([v]) => handleConfigChange('minCutoff', v)}
                          min={0.1}
                          max={5}
                          step={0.1}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span>Beta (speed coeff)</span>
                          <span>{config.beta.toFixed(3)}</span>
                        </div>
                        <Slider
                          value={[config.beta]}
                          onValueChange={([v]) => handleConfigChange('beta', v)}
                          min={0}
                          max={0.1}
                          step={0.001}
                          className="mt-1"
                        />
                      </div>
                    </div>

                    <Separator className="bg-slate-800" />

                    {/* Kalman Filter */}
                    <div className="space-y-2">
                      <Label className="text-xs text-teal-400">Kalman Filter</Label>
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span>Process Noise</span>
                          <span>{config.kalmanProcessNoise.toFixed(3)}</span>
                        </div>
                        <Slider
                          value={[config.kalmanProcessNoise]}
                          onValueChange={([v]) => handleConfigChange('kalmanProcessNoise', v)}
                          min={0.001}
                          max={0.1}
                          step={0.001}
                          className="mt-1"
                        />
                      </div>
                    </div>

                    <Separator className="bg-slate-800" />

                    {/* Constraints */}
                    <div className="space-y-2">
                      <Label className="text-xs text-teal-400">Constraints</Label>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Enforce biomech limits</span>
                        <Switch
                          checked={config.enforceConstraints}
                          onCheckedChange={(v) => handleConfigChange('enforceConstraints', v)}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Confidence weighting</span>
                        <Switch
                          checked={config.confidenceWeighting}
                          onCheckedChange={(v) => handleConfigChange('confidenceWeighting', v)}
                        />
                      </div>
                    </div>

                    <Separator className="bg-slate-800" />

                    {/* Foot Contact */}
                    <div className="space-y-2">
                      <Label className="text-xs text-teal-400">Foot Contact</Label>
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span>Threshold</span>
                          <span>{config.footContactThreshold.toFixed(2)}m</span>
                        </div>
                        <Slider
                          value={[config.footContactThreshold]}
                          onValueChange={([v]) => handleConfigChange('footContactThreshold', v)}
                          min={0.01}
                          max={0.2}
                          step={0.01}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Debug Panel */}
        {showDebug && (
          <div className="absolute bottom-4 left-4 w-96 max-h-60">
            <Card className="bg-slate-900/95 border-slate-800 backdrop-blur-sm">
              <CardHeader className="p-3 pb-2">
                <CardTitle className="text-xs text-teal-400 flex items-center gap-2">
                  <Bug className="w-3 h-3" />
                  Diagnostic Console
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <ScrollArea className="h-40">
                  <div className="font-mono text-[9px] text-slate-400 space-y-0.5">
                    {logs.slice(-50).map((log, i) => (
                      <div key={i} className="break-all">{log}</div>
                    ))}
                    {logs.length === 0 && (
                      <div className="text-slate-600">Waiting for logs...</div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
