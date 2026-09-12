import { useEffect, useState } from 'react'

const SPEAKING_THRESHOLD = 0.02 // RMS threshold - tune if it's too sensitive/insensitive
const CHECK_INTERVAL_MS = 150

/**
 * Watches a MediaStream's audio track (if any) and reports whether the
 * candidate is currently speaking, based on a simple RMS volume check
 * sampled a few times a second via the Web Audio API. Runs entirely on
 * the proctor's browser - no signalling involved.
 */
export function useAudioLevel(stream: MediaStream | undefined | null): boolean {
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setSpeaking(false)
      return
    }

    let cancelled = false
    let audioCtx: AudioContext | null = null
    let intervalId: number | undefined

    try {
      audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)

      intervalId = window.setInterval(() => {
        if (cancelled) return
        analyser.getByteTimeDomainData(data)
        let sumSquares = 0
        for (let i = 0; i < data.length; i++) {
          const normalized = (data[i] - 128) / 128
          sumSquares += normalized * normalized
        }
        const rms = Math.sqrt(sumSquares / data.length)
        setSpeaking(rms > SPEAKING_THRESHOLD)
      }, CHECK_INTERVAL_MS)
    } catch {
      // Web Audio unsupported, or the stream can't be analyzed - just skip.
    }

    return () => {
      cancelled = true
      if (intervalId) window.clearInterval(intervalId)
      audioCtx?.close().catch(() => {})
    }
  }, [stream])

  return speaking
}