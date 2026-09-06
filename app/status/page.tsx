'use client';

import { useEffect, useRef, useState } from 'react';

type ConversationTurn = {
  role: 'user' | 'assistant';
  text: string;
};

export default function StatusPage() {
  const [roomId, setRoomId] = useState('');
  const [roomTitle, setRoomTitle] = useState('');
  const [validatedRoomId, setValidatedRoomId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioDataUrl, setAudioDataUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [conversationLanguage, setConversationLanguage] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const validateRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedRoomId = roomId.trim().toUpperCase();
    if (!normalizedRoomId) {
      setError('Enter a room ID first.');
      return;
    }
    setValidating(true);
    setError(null);
    setValidatedRoomId(null);
    setTurns([]);
    setAudioDataUrl(null);
    setAudioError(null);
    setAudioBlocked(false);
    setConversationLanguage(null);
    try {
      const response = await fetch('/api/room/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: normalizedRoomId }),
      });
      const data = await response.json() as { roomId?: string; title?: string; error?: string };
      if (!response.ok || !data.roomId) throw new Error(data.error ?? 'Room not found');
      setRoomId(data.roomId);
      setRoomTitle(data.title ?? 'Rental matter');
      setValidatedRoomId(data.roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Room not found');
    } finally {
      setValidating(false);
    }
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  };

  const sendRecording = async (blob: Blob) => {
    if (!validatedRoomId) return;
    setWorking(true);
    setError(null);
    setAudioError(null);
    const form = new FormData();
    form.append('roomId', validatedRoomId);
    if (conversationLanguage) form.append('conversationLanguage', conversationLanguage);
    form.append('audio', blob, 'voice.webm');
    try {
      const response = await fetch('/api/voice/assistant', { method: 'POST', body: form });
      const data = await response.json() as {
        transcript?: string;
        response?: string;
        language?: string;
        audioDataUrl?: string | null;
        audioError?: string | null;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? 'Voice assistant failed');
      if (data.transcript) setTurns(previous => [...previous, { role: 'user', text: data.transcript! }]);
      if (data.response) setTurns(previous => [...previous, { role: 'assistant', text: data.response! }]);
      if (!conversationLanguage && data.language) setConversationLanguage(data.language);
      setAudioDataUrl(data.audioDataUrl ?? null);
      setAudioError(data.audioError ?? null);
      setAudioBlocked(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice assistant failed');
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => {
    if (!audioDataUrl || !audioRef.current) return;
    const playback = audioRef.current.play();
    playback.catch(() => setAudioBlocked(true));
  }, [audioDataUrl]);

  const startRecording = async () => {
    if (!validatedRoomId || recording || working) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice recording is not supported in this browser.');
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType: preferredMime });
      chunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: preferredMime });
        stopStream();
        void sendRecording(blob);
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      stopStream();
      setError(err instanceof Error ? err.message : 'Microphone access was denied');
    }
  };

  const stopRecording = () => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') return;
    recorderRef.current.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  return (
    <main className="shell rise status-page">
      <p className="product-kicker">Contract status</p>
      <h1 className="brand">Talk to your agreement.</h1>
      <p className="lede">Enter a room ID first. Settle will only open the voice assistant after the room is verified from SpacetimeDB.</p>

      <section className="panel stack">
        <form className="status-room-form" onSubmit={validateRoom}>
          <label>
            Room ID
            <input
              value={roomId}
              onChange={event => setRoomId(event.target.value.toUpperCase())}
              placeholder="ABC123"
              autoComplete="off"
              required
            />
          </label>
          <button type="submit" className="btn" disabled={validating} aria-busy={validating}>
            {validating ? 'Checking room…' : 'Verify room'}
          </button>
        </form>
        {validatedRoomId && <p className="provider-status">Verified room {validatedRoomId}: {roomTitle}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {validatedRoomId && (
        <section className="panel stack">
          <div className="deal-banner">
            <h2>Voice assistant</h2>
            <p className="muted">Ask for a complete activity summary or ask one specific contract question. Your transcript is shown temporarily and is not saved to the room.</p>
          </div>
          <div className="voice-transcript" aria-live="polite">
            {turns.length === 0 && <p className="muted">Start by asking: “Summarize the contract activity so far.”</p>}
            {turns.map((turn, index) => (
              <article className={`voice-turn ${turn.role}`} key={`${turn.role}-${index}`}>
                <strong>{turn.role === 'user' ? 'Transcript' : 'Settle'}</strong>
                <p>{turn.text}</p>
              </article>
            ))}
          </div>
          <div className="row">
            {!recording ? (
              <button type="button" className="btn" disabled={working} onClick={() => void startRecording()}>
                {working ? 'Processing…' : 'Start speaking'}
              </button>
            ) : (
              <button type="button" className="btn warn" onClick={stopRecording}>Stop and send</button>
            )}
            {audioDataUrl && (
              <>
                <audio ref={audioRef} controls src={audioDataUrl}>Your browser does not support audio playback.</audio>
                {audioBlocked && <button type="button" className="btn micro" onClick={() => { void audioRef.current?.play(); setAudioBlocked(false); }}>Play response</button>}
              </>
            )}
            {audioError && <p className="error">{audioError}</p>}
          </div>
        </section>
      )}
    </main>
  );
}
