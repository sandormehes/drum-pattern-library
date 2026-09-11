import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const kitDirectory = path.resolve('supplemental-ui/audio/drumlab-kit')
const requiredRoles = ['kick', 'snare', 'hat', 'perc']

const wavFormat = (buffer) => ({
  channels: buffer.readUInt16LE(22),
  sampleRate: buffer.readUInt32LE(24),
  bitsPerSample: buffer.readUInt16LE(34),
  audioFormat: buffer.readUInt16LE(20),
})

test('Drum Lab kit manifest references complete, compatible WAV samples', async () => {
  const manifest = JSON.parse(await readFile(path.join(kitDirectory, 'manifest.json'), 'utf8'))

  assert.equal(typeof manifest.name, 'string')
  assert.ok(manifest.name.trim(), 'kit needs a name')

  for (const role of requiredRoles) {
    const filename = manifest.samples?.[role]
    assert.equal(typeof filename, 'string', `kit needs a ${role} sample`)
    assert.match(filename, /\.wav$/i, `${role} must be a WAV file`)

    const sample = await readFile(path.join(kitDirectory, filename))
    assert.equal(sample.subarray(0, 4).toString('ascii'), 'RIFF', `${filename} is a RIFF file`)
    assert.equal(sample.subarray(8, 12).toString('ascii'), 'WAVE', `${filename} is a WAVE file`)
    assert.deepEqual(wavFormat(sample), {
      audioFormat: 1,
      channels: 1,
      sampleRate: 44100,
      bitsPerSample: 16,
    }, `${filename} is 44.1 kHz, 16-bit mono PCM`)
  }
})
