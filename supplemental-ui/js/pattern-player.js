(() => {
  'use strict'

  let audioContext
  let activePlayer

  const getContext = () => {
    if (!audioContext) audioContext = new AudioContext()
    return audioContext
  }

  const volumeFor = (symbol) => ({ X: 0.95, x: 0.68, g: 0.28, o: 0.78 }[symbol] || 0)

  const instrumentFor = (label) => {
    const normalized = label.toLowerCase()
    if (normalized.includes('kick') || normalized.includes('bass')) return 'kick'
    if (normalized.includes('snare') || normalized.includes('rim') || normalized.includes('clap')) return 'snare'
    if (normalized.includes('hat') || normalized.includes('cymbal')) return 'hat'
    return 'perc'
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
      swing,
      tempo,
      timeout: undefined,
    }
    tempo.addEventListener('input', () => { output.value = `${tempo.value} BPM`; output.textContent = `${tempo.value} BPM` })
    swing.addEventListener('input', () => { swingOutput.value = `${swing.value}%`; swingOutput.textContent = `${swing.value}%` })
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
