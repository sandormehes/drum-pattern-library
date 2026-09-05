import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const pagesRoot = path.resolve('modules/patterns/pages')
const validSymbols = new Set(['-', 'x', 'X', 'g', 'o'])
const requiredAttributes = [
  'pattern-id', 'family', 'region', 'era', 'meter', 'subdivision', 'bars',
  'tempo', 'source-type', 'confidence', 'source-refs', 'tags',
]
const validSourceTypes = new Set(['Original', 'Transcription', 'Adaptation', 'Traditional'])
const validConfidence = new Set(['High', 'Medium', 'Low'])
const requiredSections = ['Pattern', 'Character', 'Performance notes', 'Provenance', 'Related patterns']
const sourceRegister = await readFile(path.resolve('modules/research/pages/sources.adoc'), 'utf8')
const registeredSourceIds = new Set([...sourceRegister.matchAll(/^\[\[([^\]]+)\]\]$/gm)].map((match) => match[1]))

async function findAsciiDocFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? findAsciiDocFiles(entryPath) : entryPath
  }))
  return files.flat().filter((file) => file.endsWith('.adoc'))
}

let checkedPatterns = 0
const patternIds = new Map()
const patternRecords = []

for (const file of await findAsciiDocFiles(pagesRoot)) {
  const source = await readFile(file, 'utf8')
  if (!source.includes(':pattern-id:')) continue

  const attributes = Object.fromEntries(
    [...source.matchAll(/^:([a-z-]+):\s*(.+)$/gm)].map((match) => [match[1], match[2].trim()]),
  )
  for (const attribute of requiredAttributes) {
    if (!attributes[attribute]) throw new Error(`${file}: missing :${attribute}: attribute`)
  }
  if (patternIds.has(attributes['pattern-id'])) {
    throw new Error(`${file}: duplicate pattern ID ${attributes['pattern-id']} (also in ${patternIds.get(attributes['pattern-id'])})`)
  }
  patternIds.set(attributes['pattern-id'], file)
  patternRecords.push({ attributes, file, source })

  if (!validSourceTypes.has(attributes['source-type'])) {
    throw new Error(`${file}: invalid source type ${attributes['source-type']}`)
  }
  if (!validConfidence.has(attributes.confidence)) {
    throw new Error(`${file}: invalid confidence ${attributes.confidence}`)
  }
  if (attributes.meter !== '4/4' || attributes.subdivision !== '1/16') {
    throw new Error(`${file}: validator currently supports only 4/4 at 1/16 subdivision`)
  }
  const bars = Number.parseInt(attributes.bars, 10)
  if (!Number.isInteger(bars) || bars < 1) throw new Error(`${file}: :bars: must be a positive integer`)

  for (const sourceId of attributes['source-refs'].split(',').map((value) => value.trim())) {
    if (!registeredSourceIds.has(sourceId)) {
      throw new Error(`${file}: source reference ${sourceId} is not registered in modules/research/pages/sources.adoc`)
    }
  }

  for (const section of requiredSections) {
    if (!source.includes(`== ${section}\n`)) throw new Error(`${file}: missing ${section} section`)
  }
  const relatedPatterns = source.match(/== Related patterns\n([\s\S]*?)(?=\n== |\s*$)/)?.[1]
  if (!relatedPatterns?.includes('xref:')) {
    throw new Error(`${file}: Related patterns section must link to at least one pattern`)
  }

  const patternSection = source.match(/== Pattern\n([\s\S]*?)(?=\n== )/)?.[1]
  if (!patternSection) throw new Error(`${file}: missing Pattern section`)

  const trackLines = patternSection.split('\n').filter((line) => /^[A-Z][A-Z -]*\|/.test(line))
  if (!trackLines.length) throw new Error(`${file}: pattern has no tracks`)

  for (const line of trackLines) {
    const [label, ...groups] = line.split('|')
    const symbols = groups.join('').replaceAll(' ', '').split('')

    const expectedSteps = bars * 16
    if (symbols.length !== expectedSteps) {
      throw new Error(`${file}: ${label.trim()} has ${symbols.length} steps; expected ${expectedSteps} for ${bars} bar(s)`)
    }

    const invalid = symbols.filter((symbol) => !validSymbols.has(symbol))
    if (invalid.length) {
      throw new Error(`${file}: ${label.trim()} contains invalid symbols: ${[...new Set(invalid)].join(', ')}`)
    }
  }

  checkedPatterns += 1
}

for (const { attributes, file } of patternRecords) {
  const parentPattern = attributes['parent-pattern']
  if (parentPattern && !patternIds.has(parentPattern)) {
    throw new Error(`${file}: parent pattern ${parentPattern} does not match a registered pattern ID`)
  }
}

console.log(`Validated ${checkedPatterns} patterns, including metadata, source references, required review sections, and parent links.`)
