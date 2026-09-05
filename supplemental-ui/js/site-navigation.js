(() => {
  'use strict'

  let catalogPromise

  const metadata = (document, label) => [...document.querySelectorAll('table tr')].find((row) => row.cells[0]?.textContent.trim() === label)?.cells[1]?.textContent.trim() || ''
  const definition = (document, label) => [...document.querySelectorAll('dt')].find((term) => term.textContent.trim() === label)?.nextElementSibling?.textContent.trim() || ''

  const loadCatalog = () => {
    if (catalogPromise) return catalogPromise
    const indexUrl = new URL(document.body.dataset.patternIndex, window.location.href)
    catalogPromise = fetch(indexUrl)
      .then((response) => response.ok ? response.text() : Promise.reject(new Error('Pattern index unavailable')))
      .then((html) => {
        const index = new DOMParser().parseFromString(html, 'text/html')
        const links = [...index.querySelectorAll('a.xref.page')]
        return Promise.all(links.map(async (link) => {
          const url = new URL(link.getAttribute('href'), indexUrl)
          const response = await fetch(url)
          if (!response.ok) return null
          const page = new DOMParser().parseFromString(await response.text(), 'text/html')
          const id = metadata(page, 'Pattern ID')
          if (!id) return null
          const meter = metadata(page, 'Meter / grid')
          return {
            bars: meter.match(/(\d+) bar/)?.[1] || '',
            family: metadata(page, 'Family'),
            id,
            region: metadata(page, 'Region'),
            sourceType: definition(page, 'Type'),
            tags: metadata(page, 'Tags'),
            tempo: metadata(page, 'Tempo'),
            title: link.textContent.trim(),
            url: url.href,
          }
        }))
      })
      .then((records) => records.filter(Boolean))
    return catalogPromise
  }

  const displaySearch = (results, records) => {
    results.replaceChildren()
    records.slice(0, 8).forEach((record) => {
      const item = document.createElement('li')
      const link = document.createElement('a')
      link.href = record.url
      link.textContent = `${record.title} · ${record.id}`
      item.append(link)
      results.append(item)
    })
    results.hidden = !records.length
  }

  const setUpSearch = () => {
    const form = document.querySelector('[data-site-search]')
    if (!form) return
    const input = form.querySelector('input')
    const results = form.querySelector('.search-results')
    input.addEventListener('input', async () => {
      const query = input.value.trim().toLowerCase()
      if (query.length < 2) return displaySearch(results, [])
      try {
        const records = await loadCatalog()
        displaySearch(results, records.filter((record) => `${record.title} ${record.id} ${record.family} ${record.tags}`.toLowerCase().includes(query)))
      } catch { displaySearch(results, []) }
    })
    input.addEventListener('blur', () => window.setTimeout(() => { results.hidden = true }, 150))
  }

  const markNavigationAncestors = () => {
    let item = document.querySelector('.nav-tree a[aria-current="page"]')?.closest('li')
    while (item) {
      item.classList.add('has-current')
      item = item.parentElement?.closest('li')
    }
  }

  const setUpBrowser = async () => {
    const browser = document.querySelector('[data-pattern-browser]')
    if (!browser) return
    const status = browser.querySelector('[data-filter-status]')
    try {
      const records = await loadCatalog()
      const family = browser.querySelector('[data-filter-family]')
      const region = browser.querySelector('[data-filter-region]')
      const sourceType = browser.querySelector('[data-filter-source-type]')
      const bars = browser.querySelector('[data-filter-bars]')
      const tempo = browser.querySelector('[data-filter-tempo]')
      const tag = browser.querySelector('[data-filter-tag]')
      const query = browser.querySelector('[data-filter-query]')
      const results = browser.querySelector('.pattern-filter-results')
      ;[...new Set(records.map((record) => record.family))].sort().forEach((name) => family.add(new Option(name, name)))
      ;[...new Set(records.map((record) => record.region))].sort().forEach((name) => region.add(new Option(name, name)))
      ;[...new Set(records.map((record) => record.sourceType))].sort().forEach((name) => sourceType.add(new Option(name, name)))
      ;[...new Set(records.flatMap((record) => record.tags.split(',').map((name) => name.trim())).filter(Boolean))].sort().forEach((name) => tag.add(new Option(name, name)))
      const render = () => {
        const filtered = records.filter((record) => {
          const firstTempo = Number(record.tempo.match(/\d+/)?.[0])
          const matchesTempo = !tempo.value || (tempo.value === 'slow' && firstTempo < 110) || (tempo.value === 'mid' && firstTempo >= 110 && firstTempo < 150) || (tempo.value === 'fast' && firstTempo >= 150)
          return (!family.value || record.family === family.value) &&
            (!region.value || record.region === region.value) &&
            (!sourceType.value || record.sourceType === sourceType.value) &&
            (!bars.value || record.bars === bars.value) &&
            (!tag.value || record.tags.split(',').map((name) => name.trim()).includes(tag.value)) &&
            matchesTempo && `${record.title} ${record.id} ${record.tags}`.toLowerCase().includes(query.value.toLowerCase())
        })
        results.replaceChildren()
        filtered.forEach((record) => {
          const item = document.createElement('li')
          const link = document.createElement('a')
          link.href = record.url
          link.textContent = record.title
          const details = document.createElement('small')
          details.textContent = `${record.id} · ${record.family} · ${record.tempo} · ${record.sourceType}`
          link.append(details)
          item.append(link)
          results.append(item)
        })
        status.textContent = `${filtered.length} pattern${filtered.length === 1 ? '' : 's'}`
      }
      ;[family, region, sourceType, bars, tempo, tag, query].forEach((control) => control.addEventListener('input', render))
      render()
    } catch { status.textContent = 'The pattern browser is unavailable offline.' }
  }

  markNavigationAncestors()
  setUpSearch()
  setUpBrowser()
})()
