(() => {
  'use strict'

  let audioContext
  let activePlayer

  const getContext = () => {
    if (!audioContext) audioContext = new AudioContext()
    return audioContext
  }

  const volumeFor = (symbol) => ({ X: 0.95, x: 0.68, g: 0.28, o: 0.78 }[symbol] || 0)

  const midiVelocityFor = (symbol) => Math.max(1, Math.round(volumeFor(symbol) * 120))

  const instrumentFor = (label) => {
    const normalized = label.toLowerCase()
    if (normalized.includes('kick') || normalized.includes('bass')) return 'kick'
    if (normalized.includes('snare') || normalized.includes('rim') || normalized.includes('clap')) return 'snare'
    if (normalized.includes('hat') || normalized.includes('cymbal')) return 'hat'
    return 'perc'
  }

  const midiNoteFor = (label, symbol) => {
    const normalized = label.toLowerCase()
    if (normalized.includes('kick') || normalized.includes('bass')) return 36
    if (normalized.includes('rim')) return 37
    if (normalized.includes('snare') || normalized.includes('clap')) return 38
    if (normalized.includes('hat') || normalized.includes('cymbal')) return symbol === 'o' ? 46 : 42
    return 60
  }

  const noise = (context) => {
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1
    return buffer
  }

  const tone = (context, time, frequency, duration, gainValue, type = 'sine') => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, time)
    gain.gain.setValueAtTime(gainValue, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(time)
    oscillator.stop(time + duration)
  }

  const noiseHit = (context, time, duration, gainValue, cutoff) => {
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = noise(context)
    filter.type = 'highpass'
    filter.frequency.value = cutoff
    gain.gain.setValueAtTime(gainValue, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration)
    source.connect(filter).connect(gain).connect(context.destination)
    source.start(time)
    source.stop(time + duration)
  }

  const playHit = (context, kind, symbol, time, sample) => {
    const level = volumeFor(symbol)
    if (!level) return
    if (sample) {
      const source = context.createBufferSource()
      const gain = context.createGain()
      source.buffer = sample
      gain.gain.setValueAtTime(level, time)
      source.connect(gain).connect(context.destination)
      source.start(time)
      return
    }
    if (kind === 'kick') {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(145, time)
      oscillator.frequency.exponentialRampToValueAtTime(45, time + 0.14)
      gain.gain.setValueAtTime(level, time)
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(time)
      oscillator.stop(time + 0.21)
    } else if (kind === 'snare') {
      noiseHit(context, time, 0.12, level * 0.42, 1200)
      tone(context, time, 190, 0.075, level * 0.18, 'triangle')
    } else if (kind === 'hat') {
      noiseHit(context, time, symbol === 'o' ? 0.24 : 0.045, level * 0.18, 6500)
    } else {
      tone(context, time, 380, symbol === 'o' ? 0.18 : 0.075, level * 0.3, 'triangle')
    }
  }

  const setActiveStep = (player, step) => {
    player.cells.forEach((cell) => cell.classList.toggle('is-playing', Number(cell.dataset.step) === step))
  }

  const stop = (player) => {
    if (!player) return
    window.clearTimeout(player.timeout)
    player.playing = false
    player.button.textContent = 'Play pattern'
    player.button.setAttribute('aria-pressed', 'false')
    player.cells.forEach((cell) => cell.classList.remove('is-playing'))
    if (activePlayer === player) activePlayer = undefined
  }

  const variableLength = (value) => {
    const bytes = [value & 0x7f]
    while ((value >>= 7)) bytes.unshift((value & 0x7f) | 0x80)
    return bytes
  }

  const midiFile = (player) => {
    const ticksPerBeat = 96
    const ticksPerStep = ticksPerBeat / 4
    const tempo = Math.round(60000000 / Number(player.tempo.value))
    const events = [{ tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, tempo >> 16, (tempo >> 8) & 0xff, tempo & 0xff] }]
    player.data.tracks.forEach(({ label, steps }) => {
      steps.forEach((symbol, step) => {
        if (!volumeFor(symbol)) return
        const swingOffset = step % 2 ? ticksPerStep * Number(player.swing.value) / 100 : 0
        const tick = Math.round(step * ticksPerStep + swingOffset)
        const note = midiNoteFor(label, symbol)
        events.push({ tick, order: 2, bytes: [0x99, note, midiVelocityFor(symbol)] })
        events.push({ tick: tick + 8, order: 1, bytes: [0x89, note, 0] })
      })
    })
    events.sort((left, right) => left.tick - right.tick || left.order - right.order)
    let previousTick = 0
    const track = []
    events.forEach(({ tick, bytes }) => {
      track.push(...variableLength(tick - previousTick), ...bytes)
      previousTick = tick
    })
    track.push(...variableLength(player.data.stepCount * ticksPerStep - previousTick), 0xff, 0x2f, 0x00)
    return new Uint8Array([
      0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x00, ticksPerBeat,
      0x4d, 0x54, 0x72, 0x6b, (track.length >>> 24) & 0xff, (track.length >>> 16) & 0xff, (track.length >>> 8) & 0xff, track.length & 0xff,
      ...track,
    ])
  }

  const gridText = (data) => data.tracks.map(({ label, steps }) => `${label.padEnd(6)} | ${steps.join('').match(/.{1,4}/g).join(' ')}`).join('\n')

  const setStatus = (player, message) => {
    player.status.value = message
    player.status.textContent = message
  }

  const scriptRoot = () => {
    const script = document.querySelector('script[src*="pattern-player"]')
    return script ? new URL('../', script.src) : new URL('./', window.location.href)
  }

  const loadDrumLabKit = async (player) => {
    if (player.kit) return player.kit
    const manifestUrl = new URL('audio/drumlab-kit/manifest.json', scriptRoot())
    try {
      const response = await fetch(manifestUrl)
      if (!response.ok) throw new Error('The Drum Lab kit is not installed')
      const manifest = await response.json()
      if (!Object.keys(manifest.samples || {}).length) throw new Error('The Drum Lab kit has no samples')
      const context = getContext()
      const samples = await Promise.all(Object.entries(manifest.samples || {}).map(async ([name, value]) => {
        const files = Array.isArray(value) ? value : [value]
        if (!files.length || files.some((file) => typeof file !== 'string')) throw new Error(`Invalid ${name} sample group`)
        const buffers = await Promise.all(files.map(async (file) => {
          const audio = await fetch(new URL(file, manifestUrl)).then((item) => {
            if (!item.ok) throw new Error(`Could not load ${file}`)
            return item.arrayBuffer()
          })
          return context.decodeAudioData(audio)
        }))
        return [name, buffers]
      }))
      player.kit = Object.fromEntries(samples)
      player.trackMap = Object.fromEntries(Object.entries(manifest.tracks || {}).map(([label, group]) => [label.toLowerCase(), group]))
      return player.kit
    } catch (error) {
      player.kitSelect.value = 'synth'
      setStatus(player, `Drum Lab kit unavailable — using built-in synthesis`)
      return undefined
    }
  }

  const audible = (player, track) => {
    if (player.muted.has(track)) return false
    return !player.soloed.size || player.soloed.has(track)
  }

  const sampleFor = (player, label, step = 0) => {
    const group = player.trackMap?.[label.toLowerCase()] || instrumentFor(label)
    const samples = player.kit?.[group]
    return samples?.[step % samples.length]
  }

  const playClick = (context, time, accent) => tone(context, time, accent ? 1480 : 980, 0.035, accent ? 0.18 : 0.11, 'square')

  const wavFile = (buffer) => {
    const samples = buffer.getChannelData(0)
    const bytes = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(bytes)
    const put = (offset, text) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)))
    put(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); put(8, 'WAVE'); put(12, 'fmt ')
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
    view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
    put(36, 'data'); view.setUint32(40, samples.length * 2, true)
    samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true))
    return new Blob([bytes], { type: 'audio/wav' })
  }

  const downloadStem = async (player, track) => {
    if (!window.OfflineAudioContext) {
      setStatus(player, 'Stem export is not supported by this browser')
      return
    }
    const tempo = Number(player.tempo.value)
    const secondsPerStep = 60 / tempo / 4
    const duration = player.data.stepCount * secondsPerStep + 1
    const offline = new OfflineAudioContext(1, Math.ceil(duration * 44100), 44100)
    const { label, steps } = player.data.tracks[track]
    steps.forEach((symbol, step) => {
      const swingOffset = step % 2 ? secondsPerStep * Number(player.swing.value) / 100 : 0
      playHit(offline, instrumentFor(label), symbol, step * secondsPerStep + swingOffset, sampleFor(player, label, step))
    })
    const rendered = await offline.startRendering()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(wavFile(rendered))
    link.download = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-stem.wav`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0)
    setStatus(player, `${label} stem download started`)
  }

  const copyGrid = async (player) => {
    const text = gridText(player.data)
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        document.body.append(textarea)
        textarea.select()
        document.execCommand('copy')
        textarea.remove()
      }
      setStatus(player, 'Grid copied')
    } catch {
      setStatus(player, 'Copy failed — select the grid from this page instead')
    }
  }

  const exportMidi = (player) => {
    const blob = new Blob([midiFile(player)], { type: 'audio/midi' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${document.title.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toLowerCase()}.mid`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0)
    setStatus(player, 'MIDI download started')
  }

  const playLoop = (player) => {
    if (!player.playing) return
    const context = getContext()
    const secondsPerStep = 60 / Number(player.tempo.value) / 4
    const start = context.currentTime + 0.04
    const loopSteps = Number(player.loop.value)
    for (let step = 0; step < loopSteps; step += 1) {
      const swingOffset = step % 2 ? secondsPerStep * Number(player.swing.value) / 100 : 0
      const time = start + step * secondsPerStep + swingOffset
      player.data.tracks.forEach(({ label, steps }, track) => {
        if (audible(player, track)) playHit(context, instrumentFor(label), steps[step], time, sampleFor(player, label, step))
      })
      if (player.metronome.checked && step % 4 === 0) playClick(context, time, step === 0)
      window.setTimeout(() => setActiveStep(player, step), Math.max(0, (time - context.currentTime) * 1000))
    }
    player.timeout = window.setTimeout(() => playLoop(player), loopSteps * secondsPerStep * 1000)
  }

  const makePlayer = (element) => {
    const button = element.querySelector('.drum-pattern-play')
    const tempo = element.querySelector('.drum-pattern-tempo input')
    const output = element.querySelector('.drum-pattern-tempo output')
    const swing = element.querySelector('.drum-pattern-swing input')
    const swingOutput = element.querySelector('.drum-pattern-swing output')
    const player = {
      button,
      cells: [...element.querySelectorAll('td[data-step]')],
      data: JSON.parse(atob(element.dataset.pattern)),
      element,
      kit: undefined,
      kitSelect: element.querySelector('.drum-pattern-kit select'),
      loop: element.querySelector('.drum-pattern-loop select'),
      metronome: element.querySelector('.drum-pattern-click input'),
      muted: new Set(),
      playing: false,
      soloed: new Set(),
      status: element.querySelector('.drum-pattern-status'),
      trackMap: {},
      swing,
      tempo,
      timeout: undefined,
    }
    tempo.addEventListener('input', () => { output.value = `${tempo.value} BPM`; output.textContent = `${tempo.value} BPM` })
    swing.addEventListener('input', () => { swingOutput.value = `${swing.value}%`; swingOutput.textContent = `${swing.value}%` })
    element.querySelector('.drum-pattern-midi').addEventListener('click', () => exportMidi(player))
    element.querySelector('.drum-pattern-copy').addEventListener('click', () => copyGrid(player))
    element.querySelector('.drum-pattern-print').addEventListener('click', () => window.print())
    player.kitSelect.addEventListener('change', async () => {
      if (player.kitSelect.value === 'drum-lab') await loadDrumLabKit(player)
      else setStatus(player, 'Using built-in synthesis')
    })
    element.querySelectorAll('[data-track-mute]').forEach((control) => control.addEventListener('change', () => {
      const track = Number(control.dataset.trackMute)
      control.checked ? player.muted.add(track) : player.muted.delete(track)
    }))
    element.querySelectorAll('[data-track-solo]').forEach((control) => control.addEventListener('change', () => {
      const track = Number(control.dataset.trackSolo)
      control.checked ? player.soloed.add(track) : player.soloed.delete(track)
    }))
    element.querySelectorAll('[data-track-stem]').forEach((button) => button.addEventListener('click', () => downloadStem(player, Number(button.dataset.trackStem))))
    button.addEventListener('click', async () => {
      if (player.playing) return stop(player)
      if (activePlayer) stop(activePlayer)
      const context = getContext()
      if (context.state === 'suspended') await context.resume()
      if (player.kitSelect.value === 'drum-lab') await loadDrumLabKit(player)
      player.playing = true
      activePlayer = player
      button.textContent = 'Stop playback'
      button.setAttribute('aria-pressed', 'true')
      playLoop(player)
    })
  }

  window.addEventListener('DOMContentLoaded', () => document.querySelectorAll('.drum-pattern[data-pattern]').forEach(makePlayer))
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(activePlayer) })
})()
