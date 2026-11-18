import {useEffect, useRef, useState} from 'react';
import {createRecorder, synthesizeSpeech, transcribeRecording} from '../voice-client.mjs';
import {rememberSpokenAnswer} from '../voice-answer.mjs';
import {requestsEmergencyHelp} from '../emergency-contact.mjs';

const recordingLimit = 25000;

export function VoiceInput({question}) {
  const [phase, setPhase] = useState('idle');
  const [status, setStatus] = useState('');
  const active = useRef(null);

  useEffect(() => () => {
    const session = active.current;
    active.current = null;
    if (session) {
      session.controller.abort();
      clearTimeout(session.timer);
      session.stream?.getTracks().forEach(track => track.stop());
    }
  }, []);

  function stopRecording(session) {
    if (session?.recorder?.state === 'recording') session.recorder.stop();
  }

  async function startRecording() {
    if (active.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus('이 브라우저에서는 녹음할 수 없어요.');
      return;
    }

    const session = {controller: new AbortController()};
    active.current = session;
    setStatus('');
    setPhase('permission');
    let started = false;
    function finish() {
      clearTimeout(session.timer);
      session.stream?.getTracks().forEach(track => track.stop());
      if (active.current !== session) return;
      active.current = null;
      setPhase('idle');
    }

    try {
      session.stream = await navigator.mediaDevices.getUserMedia({audio: true});
      if (active.current !== session) return;
      const recorder = createRecorder(session.stream);
      session.recorder = recorder;
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        if (active.current !== session) return;
        setStatus('녹음 중 문제가 발생했어요.');
        finish();
      };
      recorder.onstop = async () => {
        clearTimeout(session.timer);
        session.stream.getTracks().forEach(track => track.stop());
        if (active.current !== session) return;
        setPhase('transcribing');
        try {
          const text = await transcribeRecording(
            new Blob(chunks, {type: recorder.mimeType || chunks[0]?.type}),
            session.controller.signal,
          );
          if (active.current !== session) return;
          const input = document.getElementById('composer-input');
          if (input && !input.readOnly) {
            input.value = text;
            rememberSpokenAnswer(input, text, question);
            input.dispatchEvent(new Event('input', {bubbles: true}));
            input.focus();
          }
          if (requestsEmergencyHelp(text)) {
            const emergency = document.getElementById('emergency-open');
            if (emergency?.getAttribute('aria-expanded') === 'false') emergency.click();
          }
          setStatus('받아쓴 문장을 확인하고 전송해 주세요.');
        } catch (error) {
          if (active.current !== session) return;
          setStatus(['no_speech', 'invalid_audio', 'empty_body'].includes(error.message)
            ? '음성을 확인하지 못했어요. 다시 녹음해 주세요.'
            : '음성 인식을 완료하지 못했어요. 음성 서버를 확인하거나 직접 입력해 주세요.');
        } finally {
          finish();
        }
      };
      recorder.start();
      session.timer = setTimeout(() => stopRecording(session), recordingLimit);
      setPhase('recording');
      started = true;
    } catch {
      if (active.current === session) setStatus('마이크를 사용할 수 없어요. 사이트 권한을 확인해 주세요.');
    } finally {
      if (!started) finish();
    }
  }

  return <div className="composer-voice">
    <button type="button" className="text-button" aria-pressed={phase === 'recording'}
      disabled={phase === 'permission' || phase === 'transcribing'}
      onClick={() => phase === 'recording' ? stopRecording(active.current) : void startRecording()}>
      {phase === 'recording' ? '녹음 끝내기' : '음성 입력'}
    </button>
    <span role="status">{phase === 'transcribing' ? '음성을 받아쓰는 중…' : status}</span>
  </div>;
}

export function SpeakButton({text}) {
  const active = useRef(null);
  const [audio, setAudio] = useState('');
  const [status, setStatus] = useState('');
  const audioUrl = useRef('');
  const player = useRef(null);
  useEffect(() => { if (audio) void player.current?.play().catch(() => {}); }, [audio]);
  useEffect(() => () => {
    active.current?.abort();
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
  }, []);

  async function loadSpeech() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setStatus('음성 준비 중…');
    try {
      const wav = await synthesizeSpeech(text, controller.signal);
      if (controller.signal.aborted) return;
      audioUrl.current = URL.createObjectURL(wav);
      setAudio(audioUrl.current);
      setStatus('');
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus(error.message === 'korean_voice_missing'
          ? 'Windows 한국어 음성을 설치해 주세요.'
          : '음성을 준비하지 못했어요. 화면에서 답변을 확인해 주세요.');
      }
    } finally {
      active.current = null;
    }
  }

  return <div className="assistant-voice">
    {audio ? <audio ref={player} src={audio} controls aria-label="답변 음성" />
      : <button className="text-button" type="button" onClick={loadSpeech}>음성으로 듣기</button>}
    <span role="status">{status}</span>
  </div>;
}
