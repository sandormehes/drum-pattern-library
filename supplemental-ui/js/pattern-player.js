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

  const playHit = (context, kind, symbol, time) => {
    const level = volumeFor(symbol)
    if (!level) return
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
    for (let step = 0; step < player.data.stepCount; step += 1) {
      const swingOffset = step % 2 ? secondsPerStep * Number(player.swing.value) / 100 : 0
      const time = start + step * secondsPerStep + swingOffset
      player.data.tracks.forEach(({ label, steps }) => playHit(context, instrumentFor(label), steps[step], time))
      window.setTimeout(() => setActiveStep(player, step), Math.max(0, (time - context.currentTime) * 1000))
    }
    player.timeout = window.setTimeout(() => playLoop(player), player.data.stepCount * secondsPerStep * 1000)
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
      playing: false,
      status: element.querySelector('.drum-pattern-status'),
      swing,
      tempo,
      timeout: undefined,
    }
    tempo.addEventListener('input', () => { output.value = `${tempo.value} BPM`; output.textContent = `${tempo.value} BPM` })
    swing.addEventListener('input', () => { swingOutput.value = `${swing.value}%`; swingOutput.textContent = `${swing.value}%` })
    element.querySelector('.drum-pattern-midi').addEventListener('click', () => exportMidi(player))
    element.querySelector('.drum-pattern-copy').addEventListener('click', () => copyGrid(player))
    element.querySelector('.drum-pattern-print').addEventListener('click', () => window.print())
    button.addEventListener('click', async () => {
      if (player.playing) return stop(player)
      if (activePlayer) stop(activePlayer)
      const context = getContext()
      if (context.state === 'suspended') await context.resume()
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
