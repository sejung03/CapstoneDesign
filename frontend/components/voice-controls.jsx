import {emergencyDialogOpenedEvent} from '../emergency.mjs';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createRecorder, grantManagedVoice, speechText, managedVoice, stopAfterSpeechPause, synthesizeSpeech, transcribeRecording} from '../voice-client.mjs';
import {matchSpokenOption, rememberSpokenAnswer} from '../voice-answer.mjs';
import {requestsEmergencyHelp} from '../emergency-contact.mjs';
import {phrase,languageTags} from '../i18n.mjs';
import {intakeLabel} from '../intake-data.mjs';
import {directCareSearch} from '../care-context.mjs';

const recordingLimit = 25000;
const entryReviewTime = 2000;
const choiceReviewTime = 1000;
const dictationReviewTime = 3500;
const voiceCaptureEvent = 'capstone:voice-capture';

function readOnDevice(text, volume, onDone, locale) {
  const speech = window.speechSynthesis;
  const voice = speech?.getVoices().find(item=>item.localService && item.lang.toLowerCase().split(/[-_]/u)[0]===languageTags[locale].toLowerCase().split('-')[0]);
  if (!voice || typeof SpeechSynthesisUtterance !== 'function') return null;
  const utterance = new SpeechSynthesisUtterance(speechText(text,locale));
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.volume = volume;
  utterance.onend=onDone;
  utterance.onerror=onDone;
  speech.speak(utterance);
  return ()=>{utterance.onend=null;utterance.onerror=null;speech.cancel();};
}

export function AutoVoice({text, volume, locale='ko', prompt=false, onDone, turn}) {
  const done=useRef(onDone);
  useLayoutEffect(()=>{done.current=onDone;},[onDone]);
  const player=useRef(null),level=useRef(volume),cancel=useRef(null);
  const muted=volume===0;
  useEffect(()=>{
    level.current=volume;
    if(player.current) player.current.volume=volume;
  },[volume]);
  useEffect(()=>{
    const emergencyIsOpen=()=>!!document.querySelector('#emergency-dialog[open]');
    if(!text||emergencyIsOpen()) return;
    const audio=player.current;
    const controller=new AbortController();
    let completed=false;
    const complete=()=>{
      if(controller.signal.aborted||completed||emergencyIsOpen())return;
      completed=true;
      done.current?.();
    };
    if(muted){queueMicrotask(complete);return ()=>controller.abort();}
    audio.addEventListener('ended',complete,{signal:controller.signal,once:true});
    const stop=()=>{
      controller.abort();
      audio.pause();
      cancel.current?.();
      cancel.current=null;
    };
    document.addEventListener(voiceCaptureEvent,stop,{once:true});
    document.addEventListener(emergencyDialogOpenedEvent,stop,{once:true});
    let url='';
    const fallback=()=>{
      if(controller.signal.aborted||completed||cancel.current||emergencyIsOpen())return;
      audio.pause();
      cancel.current=readOnDevice(text,level.current,complete,locale);
      if(!cancel.current)complete();
    };
    audio.addEventListener('error',fallback,{signal:controller.signal,once:true});
    if(prompt){
      audio.volume=level.current;
      void audio.play().catch(fallback);
    } else if(managedVoice){
      fallback();
    } else {
      void synthesizeSpeech(text,controller.signal,locale).then(wav=>{
        if(controller.signal.aborted||emergencyIsOpen()) return;
        url=URL.createObjectURL(wav);
        audio.src=url;
        audio.volume=level.current;
        return audio.play();
      }).catch(fallback);
    }
    return ()=>{
      document.removeEventListener(voiceCaptureEvent,stop);
      document.removeEventListener(emergencyDialogOpenedEvent,stop);
      stop();
      if(url)URL.revokeObjectURL(url);
    };
  },[text,muted,prompt,turn,locale]);
  return <div className="assistant-voice" hidden><audio ref={player} src={prompt?'/voice/first-question-ko.wav':undefined} preload={prompt?'auto':'none'} aria-hidden="true" /></div>;
}

export function FirstVoicePrompt({locale='ko',canStartVoice,onVoiceSubmit,onVoiceEdit,onSkip,onEmergency,brand,answerRef,ready,conversation,permitted,entryGrant,voiceBlocked,externalChoice,externalBusy,externalError,onExternalConsent,onExternalCancel}) {
  const firstQuestion=phrase(locale,"Where does it hurt?");
  return <main id="voice-entry" tabIndex={-1} className="voice-entry" aria-labelledby="voice-entry-heading">
    <div className="first-voice-prompt">
      <span className="voice-entry-mark" aria-hidden="true"><span className="voice-entry-halo" /><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></span>
      <p className="voice-entry-brand">{brand}</p>
      <h1 id="voice-entry-heading">{firstQuestion}</h1>
      <p>{phrase(locale,ready?'Consent confirmed. You can answer by voice.':'Tell us what is bothering you most.')}</p>
      <div className="voice-entry-actions">
        <VoiceInput locale={locale} entry={true} question={null} conversation={conversation} permitted={permitted} entryGrant={entryGrant}
          buttonRef={answerRef} disabled={voiceBlocked} onBeforeStart={canStartVoice} onEntrySubmit={onVoiceSubmit} onEntryEdit={onVoiceEdit}
          onEntryEmergency={onEmergency} />
        {externalChoice&&<div className="voice-entry-consent" role="group" aria-label={phrase(locale,"External speech recognition consent")}>
          <p>{phrase(locale,"Your microphone recording is sent to OpenAI for transcription.")}</p>
          {externalError&&<p role="alert">{phrase(locale,"Could not confirm consent. Try again or type instead.")}</p>}
          <button type="button" className="secondary-button" disabled={externalBusy} onClick={onExternalConsent}>{phrase(locale,"Agree")}</button>
          <button type="button" className="text-button" disabled={externalBusy} onClick={onExternalCancel}>{phrase(locale,"Close")}</button>
        </div>}
        <button type="button" className="secondary-button" onClick={onSkip}>{phrase(locale,"Skip and type instead")}</button>
      </div>
    </div>
  </main>;
}

function releaseMic(session) {
  clearTimeout(session.recordingTimer);
  session.stopMonitoring?.();
  session.stream?.getTracks().forEach(track => track.stop());
}

function dispose(session) {
  session.controller.abort();
  clearTimeout(session.sendTimer);
  if (session.recorder?.state === 'recording') session.recorder.stop();
  releaseMic(session);
}

export function VoiceInput({locale='ko',question, conversation, permitted, disabled, buttonRef, entryGrant=false, entry=false, onBeforeStart, onEntrySubmit, onEntryEdit, onEntryEmergency, autoListen=false, autoQuestion=null}) {
  const [phase, setPhase] = useState('idle');
  const [status, setStatus] = useState('');
  const [entryText,setEntryText]=useState('');
  const active = useRef(null), lastAutoQuestion=useRef(null);
  const granted = useRef(false);
  const [consent,setConsent]=useState(false),[saving,setSaving]=useState(false);

  useEffect(()=>{if(!permitted){granted.current=false;setConsent(false);}},[permitted]);
  useLayoutEffect(()=>{if(entryGrant&&permitted)granted.current=true;},[entryGrant,permitted]);

  async function allowExternalVoice(){
    if(!permitted||saving) return;
    setSaving(true);
    try {
      if(!await grantManagedVoice()) throw new Error('grant_failed');
      granted.current=true;
      setConsent(false);
      await startRecording(true);
    } catch {
      setStatus(phrase(locale,"Voice recognition is unavailable. Please type instead."));
    } finally {
      setSaving(false);
    }
  }

  useLayoutEffect(() => {
    setPhase('idle');
    setStatus('');
    setEntryText('');
    return () => {
      const session = active.current;
      active.current = null;
      if (session) dispose(session);
    };
  }, [question, conversation, permitted, disabled, autoListen, locale]);

  useEffect(()=>{
    if(!autoListen||!autoQuestion||question!==autoQuestion||lastAutoQuestion.current===autoQuestion||!permitted||disabled)return;
    const timer=setTimeout(()=>{
      if(document.hidden||document.querySelector('dialog[open]')||active.current)return;
      const input=document.getElementById('composer-input');
      if(!input||input.value.trim())return;
      lastAutoQuestion.current=autoQuestion;
      void startRecording(false,true);
    },250);
    return ()=>clearTimeout(timer);
  },[question,autoQuestion,autoListen,permitted,disabled]);

  function finish(session, message = '') {
    if (!session || active.current !== session) return;
    active.current = null;
    dispose(session);
    setPhase('idle');
    setStatus(message);
    setEntryText('');
  }

  function stopRecording(session) {
    if (active.current === session && session.recorder?.state === 'recording') session.recorder.stop();
  }

  function sendEntry(session,text){
    if(active.current!==session||document.hidden||!text)return;
    finish(session);
    onEntrySubmit?.(text);
  }

  async function startRecording(justGranted=false,automatic=false) {
    if(!justGranted&&onBeforeStart&&!onBeforeStart())return;
    const input = document.getElementById('composer-input');
    if (!permitted) {
      input?.click();
      return;
    }
    if (document.hidden || disabled || (!entry&&!input) || active.current) return;
    if (managedVoice && !granted.current) { setConsent(true);return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus(phrase(locale,"This browser cannot record audio. Please type instead."));
      return;
    }

    const session = {controller: new AbortController(), draft: input?.value||''};
    const signal = session.controller.signal;
    active.current = session;
    setStatus('');
    setPhase('permission');

    const pauseReadout = event => {
      if (event.target.matches?.('.assistant-voice audio')) event.target.pause();
    };
    document.dispatchEvent(new Event(voiceCaptureEvent));
    document.querySelectorAll('.assistant-voice audio').forEach(player => player.pause());
    document.addEventListener('play', pauseReadout, {capture: true, signal});
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) finish(session);
    }, {signal});
    const dialogWatcher=typeof MutationObserver==='function'?new MutationObserver(()=>{
      if(document.querySelector('dialog[open]'))finish(session);
    }):null;
    dialogWatcher?.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
    signal.addEventListener('abort',()=>dialogWatcher?.disconnect(),{once:true});
    input?.form?.addEventListener('submit', () => finish(session), {capture: true, signal});
    input?.addEventListener('input', event => {
      if (event.isTrusted) finish(session);
    }, {signal});

    try {
      session.stream = await navigator.mediaDevices.getUserMedia({audio: true});
      if (active.current !== session) {
        releaseMic(session);
        return;
      }
      const recorder = createRecorder(session.stream);
      session.recorder = recorder;
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => finish(session, phrase(locale,"Recording failed. Please try again."));
      recorder.onstop = async () => {
        releaseMic(session);
        if (active.current !== session) return;
        setPhase('transcribing');
        try {
          const text = (await transcribeRecording(
            new Blob(chunks, {type: recorder.mimeType || chunks[0]?.type}),
            signal, locale,
          )).trim();
          if (active.current !== session) return;
          if (!entry&&(!input.isConnected || input.readOnly || input.value !== session.draft)) {
            finish(session);
            return;
          }
          if (!text) {
            finish(session, phrase(locale,"No speech detected. Please record again."));
            return;
          }

          if(entry){
            if(requestsEmergencyHelp(text)){
              finish(session);
              onEntryEmergency?.();
              return;
            }
            const preview=text.slice(0,1000);
            setEntryText(preview);
            setPhase('review');
            setStatus(phrase(locale,"Starting the questionnaire with this answer shortly."));
            session.sendTimer=setTimeout(()=>sendEntry(session,preview),entryReviewTime);
            return;
          }

          const options = question?.options || [];
          const option = options.length ? matchSpokenOption(text, options, locale) : null;
          const search=!!directCareSearch(text);
          if(automatic&&!search&&!requestsEmergencyHelp(text)){
            if(!option){
              finish(session,`“${text.slice(0,80)}” · `+phrase(locale,'No answer selected. Try again or choose an option on screen.'));
              return;
            }
            setPhase('review');
            setStatus(phrase(locale,'I’ll select “{0}”.',[intakeLabel(option.label,locale)]));
            session.sendTimer=setTimeout(()=>{
              if(active.current!==session)return;
              const form=input.form,canSend=input.isConnected&&!input.readOnly&&
                input.value===session.draft&&!!form&&!document.hidden&&!document.querySelector('dialog[open]');
              finish(session);
              if(!canSend)return;
              input.value=text;
              rememberSpokenAnswer(input,text,question,locale);
              input.dispatchEvent(new Event('input',{bubbles:true}));
              form.requestSubmit();
            },choiceReviewTime);
            return;
          }

          const value = session.draft ? [session.draft, text].join(' ') : text;
          input.value = input.maxLength >= 0 ? value.slice(0, input.maxLength) : value;
          if (!session.draft && input.value === text) rememberSpokenAnswer(input, text, question, locale);
          input.dispatchEvent(new Event('input', {bubbles: true}));
          if (requestsEmergencyHelp(text)) {
            finish(session);
            const emergency = document.getElementById('emergency-open');
            if (emergency?.getAttribute('aria-expanded') === 'false') emergency.click();
            return;
          }
          if (options.length && !option && !search) {
            finish(session, phrase(locale,'Choose an option on screen.'));
            return;
          }
          if (session.draft || input.value !== text || !input.form) {
            finish(session, phrase(locale,"Review your text before sending."));
            return;
          }

          setPhase('review');
          setStatus(option
            ? phrase(locale,'I’ll select “{0}”.',[intakeLabel(option.label,locale)])
            : phrase(locale,"Sending the transcription shortly."));
          session.sendTimer = setTimeout(() => {
            if (active.current !== session) return;
            const form = input.form, canSend = input.isConnected && !input.readOnly &&
              input.value === text && !document.hidden;
            finish(session);
            if (canSend) form?.requestSubmit();
          }, option?choiceReviewTime:dictationReviewTime);
        } catch (error) {
          if (error.message==='voice_consent_required') {
            granted.current=false;setConsent(true);finish(session);
          } else if (['no_speech', 'invalid_audio', 'empty_body'].includes(error.message)) {
            finish(session, phrase(locale,"No speech detected. Please record again."));
          } else if (['voice_service_unavailable', 'invalid_voice_port', 'stt_unavailable'].includes(error.message)) {
            finish(session, phrase(locale,"Cannot reach voice recognition. Type instead or try again later."));
          } else {
            finish(session, phrase(locale,"Could not transcribe the recording. Try again or type instead."));
          }
        }
      };

      recorder.start();
      session.recordingTimer = setTimeout(() => stopRecording(session), recordingLimit);
      session.stopMonitoring = stopAfterSpeechPause(session.stream, () => stopRecording(session));
      setPhase('recording');
    } catch {
      finish(session, phrase(locale,"Microphone unavailable. Check your browser permissions."));
    }
  }

  const recording = phase === 'recording';
  const review = phase === 'review';
  const busy = phase === 'permission' || phase === 'transcribing';
  const label = phrase(locale,recording ? 'Finish recording' : review ? 'Cancel automatic send' : entry ? 'Answer by voice' : 'Voice input');
  const message = recording ? phrase(locale,'Listening…') : phase === 'permission' ? phrase(locale,'Checking microphone permission…') :
    phase === 'transcribing' ? phrase(locale,'Transcribing…') : status;

  return <>
    {!(entry&&review)&&<button ref={buttonRef} id={entry?'voice-entry-record':undefined} type="button" className={entry?"primary-button voice-entry-record":"icon-button composer-voice-button"} aria-label={label} title={label}
      aria-pressed={recording} disabled={disabled || busy}
      onClick={() => recording ? stopRecording(active.current) : review
        ? finish(active.current, phrase(locale,"Automatic send cancelled.")) : void startRecording()}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {recording ? <rect x="7" y="7" width="10" height="10" rx="2" /> :
          review ? <path d="m6 6 12 12M18 6 6 18" /> : <>
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3" />
          </>}
      </svg>
      {entry&&label}
    </button>}
    {entry&&review&&<div className="voice-entry-preview"><p>{entryText}</p><button type="button" className="secondary-button" onClick={()=>{finish(active.current);onEntryEdit?.(entryText);}}>{phrase(locale,"Edit transcript")}</button></div>}
    <span className={entry?"voice-entry-status":"composer-voice-status"} role="status">{message}</span>
    {consent&&<div className="voice-external-consent">
      <p>{phrase(locale,"Your microphone recording is sent to OpenAI for transcription.")} {phrase(locale,"If you prefer, you can type instead.")}</p>
      <button type="button" className="secondary-button" onClick={allowExternalVoice} disabled={saving}>{phrase(locale,"Agree")}</button>
      <button type="button" className="text-button" disabled={saving} onClick={()=>setConsent(false)}>{phrase(locale,"Type instead")}</button>
    </div>}
  </>;
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
    if (managedVoice) {
      if (!readOnDevice(text,0.7,undefined,'ko'))setStatus('이 기기의 한국어 읽기를 사용할 수 없어요.');
      return;
    }
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
