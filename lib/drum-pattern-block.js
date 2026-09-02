'use strict'

const SYMBOLS = {
  '-': { className: 'rest', glyph: '·', label: 'rest' },
  'X': { className: 'accent', glyph: '●', label: 'accented hit' },
  'x': { className: 'hit', glyph: '●', label: 'hit' },
  'g': { className: 'ghost', glyph: '○', label: 'ghost hit' },
  'o': { className: 'open', glyph: '◉', label: 'open or sustained hit' },
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function parseTrack(line) {
  const separator = line.indexOf('|')
  if (separator < 1) throw new Error(`Invalid drum-pattern track: ${line}`)

  const label = line.slice(0, separator).trim()
  const steps = line.slice(separator + 1).replaceAll(' ', '').replaceAll('|', '').split('')
  if (steps.length < 16 || steps.length % 16 !== 0) {
    throw new Error(`${label} has ${steps.length} steps; expected a whole number of 16-step bars`)
  }

  for (const symbol of steps) {
    if (!SYMBOLS[symbol]) throw new Error(`${label} contains an invalid symbol: ${symbol}`)
  }

  return { label, steps }
}

function renderPattern(lines) {
  const tracks = lines.filter((line) => line.trim()).map(parseTrack)
  if (!tracks.length) throw new Error('Drum pattern must contain at least one track')

  const stepCount = tracks[0].steps.length
  for (const track of tracks) {
    if (track.steps.length !== stepCount) {
      throw new Error(`${track.label} has ${track.steps.length} steps; expected ${stepCount}`)
    }
  }

  const beatHeadings = Array.from({ length: stepCount / 4 }, (_, index) => {
    const bar = Math.floor(index / 4) + 1
    const beat = (index % 4) + 1
    const label = stepCount > 16 ? `Bar ${bar} · ${beat}` : `Beat ${beat}`
    return `<th scope="colgroup" colspan="4">${label}</th>`
  })
    .join('')
  const stepHeadings = Array.from({ length: stepCount }, (_, index) => {
    const beatStart = index % 4 === 0 ? ' beat-start' : ''
    return `<th scope="col" class="step${beatStart}">${index + 1}</th>`
  }).join('')
  const rows = tracks.map(({ label, steps }) => {
    const cells = steps.map((symbol, index) => {
      const token = SYMBOLS[symbol]
      const beatStart = index % 4 === 0 ? ' beat-start' : ''
      return `<td class="step ${token.className}${beatStart}"><span aria-label="${token.label}">${token.glyph}</span></td>`
    }).join('')
    return `<tr><th scope="row">${escapeHtml(label)}</th>${cells}</tr>`
  }).join('')

  const lengthClass = stepCount > 16 ? ' multi-bar' : ''
  return `<div class="drum-pattern${lengthClass}" role="group" aria-label="${stepCount}-step drum pattern">
<div class="drum-pattern-scroll">
<table>
<thead><tr><th rowspan="2" scope="col">Track</th>${beatHeadings}</tr><tr>${stepHeadings}</tr></thead>
<tbody>${rows}</tbody>
</table>
</div>
<div class="drum-pattern-legend" aria-label="Pattern legend">
<span><b class="accent">●</b> Accent</span><span><b class="hit">●</b> Hit</span><span><b class="ghost">○</b> Ghost</span><span><b class="open">◉</b> Open</span><span><b class="rest">·</b> Rest</span>
</div>
</div>`
}

module.exports.register = function (registry) {
  registry.block(function () {
    this.named('drum-pattern')
    this.onContext('listing')
    this.parseContentAs('raw')
    this.process(function (parent, reader) {
      return this.createBlock(parent, 'pass', renderPattern(reader.getLines()))
    })
  })
}
