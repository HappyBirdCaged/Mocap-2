import { useState, useCallback, useRef, useEffect } from 'react';
import Peer from 'peerjs';

interface PeerState {
  peer: Peer | null;
  peerId: string;
  connectionCode: string;
  status: 'offline' | 'connecting' | 'connected' | 'error';
  stream: MediaStream | null;
  error: string | null;
}

interface PeerActions {
  startAsDisplay: () => void;
  startAsCamera: () => void;
  connectToDisplay: (code: string) => Promise<void>;
  disconnect: () => void;
}

export function usePeerConnection(
  onStreamReceived?: (stream: MediaStream) => void
): [PeerState, PeerActions] {
  const [state, setState] = useState<PeerState>({
    peer: null,
    peerId: '',
    connectionCode: '',
    status: 'offline',
    stream: null,
    error: null,
  });

  const activeCallRef = useRef<any>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<Peer | null>(null);

  const generateCode = () => Math.random().toString(36).substring(2, 7).toUpperCase();

  const startAsDisplay = useCallback(() => {
    const code = generateCode();
    const fullId = `SKEL-MOCAP-${code}`;
    
    const peer = new Peer(fullId, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    });

    peerRef.current = peer;

    peer.on('open', () => {
      setState(s => ({ 
        ...s, 
        peer, 
        peerId: fullId, 
        connectionCode: code,
        status: 'connecting' 
      }));
    });

    peer.on('call', (call) => {
      call.answer();
      activeCallRef.current = call;

      call.on('stream', (remoteStream) => {
        setState(s => ({ ...s, stream: remoteStream, status: 'connected' }));
        onStreamReceived?.(remoteStream);
      });

      call.on('close', () => {
        setState(s => ({ ...s, stream: null, status: 'connecting' }));
      });

      call.on('error', (err) => {
        setState(s => ({ ...s, error: err.message, status: 'error' }));
      });
    });

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Retry with new code
        startAsDisplay();
      } else {
        setState(s => ({ ...s, error: err.message, status: 'error' }));
      }
    });
  }, [onStreamReceived]);

  const startAsCamera = useCallback(() => {
    const peer = new Peer({
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    });

    peerRef.current = peer;

    peer.on('open', () => {
      setState(s => ({ ...s, peer, status: 'connecting' }));
    });

    peer.on('error', (err) => {
      setState(s => ({ ...s, error: err.message, status: 'error' }));
    });
  }, []);

  const connectToDisplay = useCallback(async (code: string) => {
    if (!peerRef.current) return;

    try {
      const constraints = {
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;

      const targetId = `SKEL-MOCAP-${code.toUpperCase()}`;
      const call = peerRef.current.call(targetId, stream);
      activeCallRef.current = call;

      call.on('stream', (remoteStream) => {
        setState(s => ({ ...s, stream: remoteStream, status: 'connected' }));
        onStreamReceived?.(remoteStream);
      });

      call.on('close', () => {
        setState(s => ({ ...s, stream: null, status: 'connecting' }));
      });

      call.on('error', (err) => {
        setState(s => ({ ...s, error: err.message, status: 'error' }));
      });

      setState(s => ({ ...s, stream, status: 'connected' }));
    } catch (err: any) {
      setState(s => ({ 
        ...s, 
        error: err.message || 'Camera access failed',
        status: 'error' 
      }));
    }
  }, [onStreamReceived]);

  const disconnect = useCallback(() => {
    if (activeCallRef.current) {
      activeCallRef.current.close();
      activeCallRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }

    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }

    setState({
      peer: null,
      peerId: '',
      connectionCode: '',
      status: 'offline',
      stream: null,
      error: null,
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return [state, { startAsDisplay, startAsCamera, connectToDisplay, disconnect }];
}
