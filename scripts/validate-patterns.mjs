import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const pagesRoot = path.resolve('modules/patterns/pages')
const validSymbols = new Set(['-', 'x', 'X', 'g', 'o'])

async function findAsciiDocFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? findAsciiDocFiles(entryPath) : entryPath
  }))
  return files.flat().filter((file) => file.endsWith('.adoc'))
}

let checkedPatterns = 0

for (const file of await findAsciiDocFiles(pagesRoot)) {
  const source = await readFile(file, 'utf8')
  if (!source.includes(':pattern-id:')) continue

  const patternSection = source.match(/== Pattern\n([\s\S]*?)(?=\n== )/)?.[1]
  if (!patternSection) throw new Error(`${file}: missing Pattern section`)

  const trackLines = patternSection.split('\n').filter((line) => /^[A-Z][A-Z -]*\|/.test(line))
  if (!trackLines.length) throw new Error(`${file}: pattern has no tracks`)

  for (const line of trackLines) {
    const [label, ...groups] = line.split('|')
    const symbols = groups.join('').replaceAll(' ', '').split('')

    if (symbols.length !== 16) {
      throw new Error(`${file}: ${label.trim()} has ${symbols.length} steps; expected 16`)
    }

    const invalid = symbols.filter((symbol) => !validSymbols.has(symbol))
    if (invalid.length) {
      throw new Error(`${file}: ${label.trim()} contains invalid symbols: ${[...new Set(invalid)].join(', ')}`)
    }
  }

  checkedPatterns += 1
}

console.log(`Validated ${checkedPatterns} patterns.`)
