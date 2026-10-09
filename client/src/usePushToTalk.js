import { useState, useEffect, useRef, useCallback } from 'react';

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function tuneSdp(sdp) {
  if (!sdp) return sdp;
  return sdp.replace(
    /a=fmtp:111 ((?:(?!minptime).)*)/g,
    'a=fmtp:111 $1;minptime=10;useinbandfec=1;stereo=0;sprop-stereo=0;cbr=1'
  );
}

function getWebSocketUrl() {
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    let formatted = envUrl.trim();
    if (formatted.startsWith('http://')) {
      formatted = 'ws://' + formatted.slice(7);
    } else if (formatted.startsWith('https://')) {
      formatted = 'wss://' + formatted.slice(8);
    } else if (!formatted.startsWith('ws://') && !formatted.startsWith('wss://')) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      formatted = `${protocol}//${formatted}`;
    }
    try {
      const url = new URL(formatted);
      if (url.pathname === '' || url.pathname === '/') {
        url.pathname = '/ws';
      }
      return url.toString();
    } catch {
      return formatted;
    }
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function usePushToTalk({ remoteAudioRef }) {
  const [userId] = useState(() => 'usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6));
  const [userName, setUserName] = useState('');
  const [registered, setRegistered] = useState(false);
  const [users, setUsers] = useState([]);
  const [currentCall, setCurrentCall] = useState(null);
  const [callError, setCallError] = useState(null);
  const [voiceConnected, setVoiceConnected] = useState(false);
  const [state, setState] = useState('IDLE');

  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const pcRef = useRef(null);
  const audioContextRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const heartbeatTimerRef = useRef(null);
  const isPressingRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const setMicrophoneMuted = useCallback((muted) => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }, []);

  const initMicrophone = useCallback(async () => {
    try {
      if (streamRef.current) return streamRef.current;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          latency: 0,
          channelCount: 1,
          sampleRate: 48000,
        },
      });

      stream.getAudioTracks().forEach((t) => { t.enabled = false; });
      streamRef.current = stream;

      if (pcRef.current) {
        stream.getAudioTracks().forEach((track) => pcRef.current.addTrack(track, stream));
      }

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      }

      return stream;
    } catch (err) {
      return null;
    }
  }, []);

  const createPeerConnection = useCallback((targetUserId) => {
    if (pcRef.current) pcRef.current.close();

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;
    pendingCandidatesRef.current = [];

    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((track) => pc.addTrack(track, streamRef.current));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'RTC_SIGNAL',
          payload: { targetUserId, signal: { type: 'candidate', candidate: e.candidate } },
        }));
      }
    };

    pc.ontrack = (event) => {
      if (event.receiver) {
        if ('playoutDelayHint' in event.receiver) event.receiver.playoutDelayHint = 0;
        if ('jitterBufferTarget' in event.receiver) event.receiver.jitterBufferTarget = 0;
      }

      try {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
          audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        }
        if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();
        const source = audioContextRef.current.createMediaStreamSource(event.streams[0]);
        source.connect(audioContextRef.current.destination);
      } catch (err) {
        // Fallback
      }

      if (remoteAudioRef?.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
        remoteAudioRef.current.play().catch(() => {});
      }
    };

    pc.onconnectionstatechange = () => {
      setVoiceConnected(pc.connectionState === 'connected');
    };

    return pc;
  }, [remoteAudioRef]);

  const setupWebRtc = useCallback(async (targetUserId, isInitiator) => {
    await initMicrophone();
    const pc = createPeerConnection(targetUserId);

    if (isInitiator) {
      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        offer.sdp = tuneSdp(offer.sdp);
        await pc.setLocalDescription(offer);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'RTC_SIGNAL',
            payload: { targetUserId, signal: { type: 'offer', sdp: pc.localDescription.sdp } },
          }));
        }
      } catch (err) {
        // Ignored
      }
    }
  }, [initMicrophone, createPeerConnection]);

  useEffect(() => {
    const ws = new WebSocket(getWebSocketUrl());
    wsRef.current = ws;

    ws.onmessage = async (event) => {
      try {
        const { type, payload } = JSON.parse(event.data);

        switch (type) {
          case 'REGISTER_OK': {
            setRegistered(true);
            break;
          }
          case 'USER_LIST': {
            setUsers(payload.users || []);
            break;
          }
          case 'CALL_CONNECTED': {
            setCallError(null);
            setCurrentCall({ roomId: payload.roomId, partner: payload.partner });
            setState('IDLE');
            setupWebRtc(payload.partner.userId, payload.isInitiator);
            break;
          }
          case 'CALL_ERROR': {
            setCallError(payload.message || 'Call failed');
            setTimeout(() => setCallError(null), 4000);
            break;
          }
          case 'CALL_ENDED': {
            setCurrentCall(null);
            setState('IDLE');
            setVoiceConnected(false);
            stopHeartbeat();
            setMicrophoneMuted(true);
            if (pcRef.current) pcRef.current.close();
            if (remoteAudioRef?.current) remoteAudioRef.current.srcObject = null;
            if (payload?.reason) {
              setCallError(payload.reason);
              setTimeout(() => setCallError(null), 4000);
            }
            break;
          }
          case 'RTC_SIGNAL': {
            const signal = payload.signal;
            let pc = pcRef.current || createPeerConnection(payload.fromUserId);

            if (signal.type === 'offer') {
              await pc.setRemoteDescription(new RTCSessionDescription(signal));
              while (pendingCandidatesRef.current.length > 0) {
                await pc.addIceCandidate(pendingCandidatesRef.current.shift()).catch(() => {});
              }
              const answer = await pc.createAnswer();
              answer.sdp = tuneSdp(answer.sdp);
              await pc.setLocalDescription(answer);

              ws.send(JSON.stringify({
                type: 'RTC_SIGNAL',
                payload: { targetUserId: payload.fromUserId, signal: { type: 'answer', sdp: pc.localDescription.sdp } },
              }));
            } else if (signal.type === 'answer') {
              if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(signal));
                while (pendingCandidatesRef.current.length > 0) {
                  await pc.addIceCandidate(pendingCandidatesRef.current.shift()).catch(() => {});
                }
              }
            } else if (signal.type === 'candidate' && signal.candidate) {
              const candidate = new RTCIceCandidate(signal.candidate);
              if (pc && pc.remoteDescription) {
                await pc.addIceCandidate(candidate).catch(() => {});
              } else {
                pendingCandidatesRef.current.push(candidate);
              }
            }
            break;
          }
          case 'FLOOR_GRANTED': {
            if (!isPressingRef.current) {
              ws.send(JSON.stringify({ type: 'RELEASE_FLOOR' }));
              setMicrophoneMuted(true);
              setState('IDLE');
              return;
            }
            setState('SPEAKING');
            setMicrophoneMuted(false);

            stopHeartbeat();
            heartbeatTimerRef.current = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
            }, 800);
            break;
          }
          case 'FLOOR_DENIED': {
            setMicrophoneMuted(true);
            setState('FLOOR_BUSY');
            setTimeout(() => {
              if (stateRef.current === 'FLOOR_BUSY') setState('IDLE');
            }, 1200);
            break;
          }
          case 'FLOOR_TAKEN': {
            setState('LISTENING');
            break;
          }
          case 'FLOOR_RELEASED': {
            if (stateRef.current !== 'SPEAKING') setState('IDLE');
            break;
          }
          case 'FLOOR_LOST': {
            setMicrophoneMuted(true);
            stopHeartbeat();
            setState('IDLE');
            break;
          }
        }
      } catch (err) {
        // Ignored
      }
    };

    return () => {
      stopHeartbeat();
      if (ws.readyState === WebSocket.OPEN) ws.close();
      if (pcRef.current) pcRef.current.close();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [setupWebRtc, createPeerConnection, setMicrophoneMuted, stopHeartbeat, remoteAudioRef]);

  const registerUser = useCallback(async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setUserName(trimmed);
    await initMicrophone();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'REGISTER', payload: { userId, userName: trimmed } }));
    }
  }, [userId, initMicrophone]);

  const startCall = useCallback((targetUserId) => {
    setCallError(null);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'START_CALL', payload: { targetUserId } }));
    }
  }, []);

  const leaveCall = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'LEAVE_CALL' }));
    }
    setCurrentCall(null);
    setState('IDLE');
    setVoiceConnected(false);
    setMicrophoneMuted(true);
  }, [setMicrophoneMuted]);

  const startTalking = useCallback(() => {
    if (stateRef.current !== 'IDLE') return;
    isPressingRef.current = true;
    setState('REQUESTING_FLOOR');
    setMicrophoneMuted(false);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'ACQUIRE_FLOOR' }));
    }
  }, [setMicrophoneMuted]);

  const stopTalking = useCallback(() => {
    isPressingRef.current = false;
    stopHeartbeat();
    setMicrophoneMuted(true);

    if (stateRef.current === 'SPEAKING' || stateRef.current === 'REQUESTING_FLOOR') {
      setState('IDLE');
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'RELEASE_FLOOR' }));
      }
    }
  }, [stopHeartbeat, setMicrophoneMuted]);

  const toggleTalking = useCallback(() => {
    if (stateRef.current === 'SPEAKING') {
      stopTalking();
    } else if (stateRef.current === 'IDLE') {
      startTalking();
    }
  }, [startTalking, stopTalking]);

  return {
    userId,
    userName,
    registered,
    users,
    currentCall,
    callError,
    voiceConnected,
    state,
    registerUser,
    startCall,
    leaveCall,
    startTalking,
    stopTalking,
    toggleTalking,
  };
}
