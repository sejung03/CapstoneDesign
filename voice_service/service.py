"""Loopback speech service for the CapstoneDesign local frontend."""

import asyncio
import io
import json
import logging
import os
from functools import lru_cache
from threading import BoundedSemaphore

import av
import numpy as np
from fastapi import FastAPI, HTTPException, Request, Response

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
stt_slot = BoundedSemaphore(1)
logger = logging.getLogger('uvicorn.error')
tts_slot = BoundedSemaphore(1)
sample_rate = 16000
max_samples = 30 * sample_rate
audio_types = {"audio/webm", "audio/ogg", "audio/mp4", "audio/wav"}


async def read_body(request, limit):
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > limit:
            raise HTTPException(413, "body_too_large")
        data.extend(chunk)
    return bytes(data)


def decode_recording(data):
    blocks = []
    samples = 0
    resampler = av.AudioResampler(format="s16", layout="mono", rate=sample_rate)
    try:
        with av.open(io.BytesIO(data)) as source:
            if not source.streams.audio:
                raise HTTPException(422, "invalid_audio")
            for frame in source.decode(audio=0):
                for block in resampler.resample(frame):
                    samples += block.samples
                    if samples > max_samples:
                        raise HTTPException(413, "recording_too_long")
                    blocks.append(block.to_ndarray().reshape(-1))
    except (av.FFmpegError, ValueError) as error:
        raise HTTPException(422, "invalid_audio") from error
    if not blocks:
        raise HTTPException(422, "invalid_audio")
    return np.concatenate(blocks).astype(np.float32) / 32768


@lru_cache(maxsize=1)
def whisper_model():
    from faster_whisper import WhisperModel

    return WhisperModel(
        os.getenv("VOICE_WHISPER_MODEL", "base"),
        device="cpu",
        compute_type="int8",
    )


def transcribe(samples, vad_parameters=None, language="ko"):
    segments, info = whisper_model().transcribe(
        samples, language=language, beam_size=3, vad_filter=True,
        vad_parameters=vad_parameters, condition_on_previous_text=False,
    )
    return " ".join(segment.text.strip() for segment in segments).strip(), info.duration_after_vad


def recognize(data, language="ko"):
    if not stt_slot.acquire(blocking=False):
        raise HTTPException(429, "stt_busy")
    try:
        samples = decode_recording(data)
        peak = float(np.max(np.abs(samples)))
        text, vad_seconds, retry_gain = "", 0.0, 1.0
        if peak >= 0.001:
            text, vad_seconds = transcribe(samples, language=language)
            if not text:
                # Keep silence filtering on, but give short or quiet answers one more chance.
                if vad_seconds == 0.0:
                    retry_gain = max(1.0, min(8.0, 0.12 / peak))
                retry_samples = samples * retry_gain if retry_gain > 1.0 else samples
                text, fallback_seconds = transcribe(
                    retry_samples, {"threshold": 0.35, "min_speech_duration_ms": 80}, language=language,
                )
                vad_seconds = max(vad_seconds, fallback_seconds)
        if not text:
            logger.warning(
                "stt_no_speech duration_ms=%d peak=%.4f vad_ms=%d retry_gain=%.1f",
                round(len(samples) * 1000 / sample_rate), peak, round(vad_seconds * 1000), retry_gain,
            )
            raise HTTPException(422, "no_speech")
        return {"text": text[:1000]}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(503, "stt_unavailable") from error
    finally:
        stt_slot.release()


async def synthesize(text, language="ko"):
    if os.name != "nt":
        raise HTTPException(503, "tts_requires_windows")

    from winrt.windows.media.speechsynthesis import SpeechSynthesizer
    from winrt.windows.storage.streams import Buffer, InputStreamOptions

    voice = next(
        (voice for voice in SpeechSynthesizer.all_voices if voice.language.lower().split("-")[0] == language),
        None,
    )
    if voice is None:
        raise HTTPException(503, "korean_voice_missing" if language == "ko" else "language_voice_missing")

    with SpeechSynthesizer() as speaker:
        speaker.voice = voice
        with await speaker.synthesize_text_to_stream_async(text) as stream:
            size = stream.size
            audio = await stream.read_async(Buffer(size), size, InputStreamOptions.NONE)
            return bytes(memoryview(audio))


def render_speech(text, language="ko"):
    if not tts_slot.acquire(blocking=False):
        raise HTTPException(429, "tts_busy")
    try:
        return asyncio.run(synthesize(text, language))
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(503, "tts_unavailable") from error
    finally:
        tts_slot.release()


def voice_language(request):
    language = request.headers.get("x-voice-language", "ko")
    if language not in {"ko", "en", "zh", "vi", "uz"}:
        raise HTTPException(400, "invalid_voice_language")
    return language


@app.post("/stt")
async def stt(request: Request):
    if request.headers.get("content-type", "").split(";")[0] not in audio_types:
        raise HTTPException(415, "unsupported_audio")
    data = await read_body(request, 4 * 1024 * 1024)
    return await asyncio.to_thread(recognize, data, voice_language(request))


@app.post("/tts")
async def tts(request: Request):
    if request.headers.get("content-type", "").split(";")[0] != "application/json":
        raise HTTPException(415, "expected_json")
    try:
        payload = json.loads(await read_body(request, 8192))
    except (ValueError, UnicodeError) as error:
        raise HTTPException(400, "invalid_json") from error
    text = payload.get("text") if isinstance(payload, dict) else None
    if not isinstance(text, str) or not 1 <= len(text.strip()) <= 1000:
        raise HTTPException(422, "invalid_text")
    wav = await asyncio.to_thread(render_speech, text.strip(), voice_language(request))
    return Response(wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})
