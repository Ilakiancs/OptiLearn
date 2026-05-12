/**
 * Shared audio capture utilities used by LiveTranslator (personal mode)
 * and LiveClassTeacherPanel (teacher broadcast mode).
 */

export const LIVE_AUDIO_SAMPLE_RATE = 16000

export function buildWavBuffer(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (offset, str) =>
    [...str].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  new Int16Array(buffer, 44).set(samples)
  return buffer
}

export function resampleFloat32Samples(samples, sourceRate, targetRate) {
  if (!sourceRate || sourceRate === targetRate || samples.length <= 1) return samples
  const targetLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate))
  const resampled = new Float32Array(targetLength)
  const ratio = (samples.length - 1) / Math.max(1, targetLength - 1)
  for (let i = 0; i < targetLength; i++) {
    const position = i * ratio
    const left = Math.floor(position)
    const right = Math.min(left + 1, samples.length - 1)
    const weight = position - left
    resampled[i] = samples[left] * (1 - weight) + samples[right] * weight
  }
  return resampled
}

/**
 * Start capturing PCM audio from a MediaStream.
 * Returns a capture handle with { audioCtx, source, processor, silentGain }.
 * Collected samples go into pcmChunksRef.current.
 */
export async function startAudioCapture(micStream, pcmChunksRef, sampleRateRef) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  let audioCtx
  try {
    audioCtx = new AudioContextCtor({ sampleRate: LIVE_AUDIO_SAMPLE_RATE })
  } catch (_) {
    audioCtx = new AudioContextCtor()
  }
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume()
  }
  const source = audioCtx.createMediaStreamSource(micStream)
  const processor = audioCtx.createScriptProcessor(4096, 1, 1)
  const silentGain = audioCtx.createGain()
  silentGain.gain.value = 0
  pcmChunksRef.current = []
  sampleRateRef.current = audioCtx.sampleRate

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0)
    pcmChunksRef.current.push(new Float32Array(input))
  }
  source.connect(processor)
  processor.connect(silentGain)
  silentGain.connect(audioCtx.destination)
  return { audioCtx, source, processor, silentGain }
}

export async function stopAudioCapture(capture, pcmChunksRef) {
  if (!capture) return
  try { capture.processor.onaudioprocess = null } catch (_) {}
  try { capture.source.disconnect() } catch (_) {}
  try { capture.processor.disconnect() } catch (_) {}
  try { capture.silentGain.disconnect() } catch (_) {}
  try { await capture.audioCtx.close() } catch (_) {}
  if (pcmChunksRef) pcmChunksRef.current = []
}

/**
 * Drain accumulated PCM chunks into a WAV Blob.
 * Returns null if audio is silent (below voice detection threshold).
 */
export function drainPcmToWavBlob(pcmChunksRef, sampleRateRef) {
  const pcmChunks = pcmChunksRef.current
  pcmChunksRef.current = []
  const totalSamples = pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  if (totalSamples === 0) return null

  const sourceSamples = new Float32Array(totalSamples)
  let offset = 0
  for (const chunk of pcmChunks) {
    sourceSamples.set(chunk, offset)
    offset += chunk.length
  }

  const audioSamples = resampleFloat32Samples(
    sourceSamples,
    sampleRateRef.current,
    LIVE_AUDIO_SAMPLE_RATE,
  )
  let energy = 0
  let voicedSamples = 0
  for (let i = 0; i < audioSamples.length; i++) {
    const abs = Math.abs(audioSamples[i])
    energy += abs * abs
    if (abs > 0.012) voicedSamples += 1
  }
  const rms = Math.sqrt(energy / Math.max(1, audioSamples.length))
  const voicedRatio = voicedSamples / Math.max(1, audioSamples.length)
  if (rms < 0.006 || voicedRatio < 0.015) return null

  const samples = new Int16Array(audioSamples.length)
  for (let i = 0; i < audioSamples.length; i++) {
    const value = Math.max(-1, Math.min(1, audioSamples[i]))
    samples[i] = value < 0 ? value * 32768 : value * 32767
  }
  return new Blob([buildWavBuffer(samples, LIVE_AUDIO_SAMPLE_RATE)], { type: 'audio/wav' })
}
