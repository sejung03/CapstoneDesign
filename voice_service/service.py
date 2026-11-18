"""Loopback speech service for the CapstoneDesign local frontend."""

import asyncio
import io
import json
import os
from functools import lru_cache
from threading import BoundedSemaphore

import av
import numpy as np
from fastapi import FastAPI, HTTPException, Request, Response

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
stt_slot = BoundedSemaphore(1)
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


def recognize(data):
    if not stt_slot.acquire(blocking=False):
        raise HTTPException(429, "stt_busy")
    try:
        samples = decode_recording(data)
        segments, _ = whisper_model().transcribe(
            samples, language="ko", beam_size=3, vad_filter=True,
            condition_on_previous_text=False,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        if not text:
            raise HTTPException(422, "no_speech")
        return {"text": text[:1000]}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(503, "stt_unavailable") from error
    finally:
        stt_slot.release()


async def synthesize(text):
    if os.name != "nt":
        raise HTTPException(503, "tts_requires_windows")

    from winrt.windows.media.speechsynthesis import SpeechSynthesizer
    from winrt.windows.storage.streams import Buffer, InputStreamOptions

    voice = next(
        (voice for voice in SpeechSynthesizer.all_voices if voice.language == "ko-KR"),
        None,
    )
    if voice is None:
        raise HTTPException(503, "korean_voice_missing")

    with SpeechSynthesizer() as speaker:
        speaker.voice = voice
        with await speaker.synthesize_text_to_stream_async(text) as stream:
            size = stream.size
            audio = await stream.read_async(Buffer(size), size, InputStreamOptions.NONE)
            return bytes(memoryview(audio))


def render_speech(text):
    if not tts_slot.acquire(blocking=False):
        raise HTTPException(429, "tts_busy")
    try:
        return asyncio.run(synthesize(text))
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(503, "tts_unavailable") from error
    finally:
        tts_slot.release()


@app.post("/stt")
async def stt(request: Request):
    if request.headers.get("content-type", "").split(";")[0] not in audio_types:
        raise HTTPException(415, "unsupported_audio")
    data = await read_body(request, 4 * 1024 * 1024)
    return await asyncio.to_thread(recognize, data)


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
    wav = await asyncio.to_thread(render_speech, text.strip())
    return Response(wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})
