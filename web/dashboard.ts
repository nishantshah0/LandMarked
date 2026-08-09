import { TIER_LABEL, type Tier } from '../shared/config'
import { hex } from '../shared/palette'
import type { DashStats, LeaderRow, ServerMsg } from '../shared/types'
import { REJECT_TEXT } from '../shared/types'

const $ = (id: string): HTMLElement => document.getElementById(id)!

function setLive(on: boolean): void {
  $('live').classList.toggle('on', on)
  $('liveLabel').textContent = on ? 'live' : 'reconnecting'
}

function beat(): void {
  const el = $('live')
  el.classList.remove('beat')
  void el.offsetWidth
  el.classList.add('beat')
}

function countUp(el: HTMLElement, to: number): void {
  const from = Number(el.dataset.v ?? '0')
  el.dataset.v = String(to)
  if (from === to) {
    el.textContent = to.toLocaleString()
    return
  }
  const t0 = performance.now()
  const step = (): void => {
    const k = Math.min((performance.now() - t0) / 380, 1)
    el.textContent = Math.round(from + (to - from) * (1 - (1 - k) ** 3)).toLocaleString()
    if (k < 1) requestAnimationFrame(step)
  }
  step()
}

function render(stats: DashStats, leaders: LeaderRow[]): void {
  const city = stats.city

  $('cityPalette').innerHTML = city.palette.length
    ? city.palette.map((c) => `<i style="background:${hex(c)}"><span>${hex(c)}</span></i>`).join('')
    : '<p class="none">No photographs yet.</p>'
  $('cityReading').textContent = city.photos
    ? `${city.reading} — blended from ${city.photos} photograph${city.photos === 1 ? '' : 's'}`
    : 'Nothing seen yet.'

  countUp($('cPhotos'), stats.photos)
  countUp($('cClaims'), stats.totalClaims)
  countUp($('cActive'), stats.activeClaims)
  countUp($('cPlayers'), stats.players)
  countUp($('cPlaces'), stats.landmarks)

  $('byHour').innerHTML =
    city.byHour
      .map(
        (h) =>
          `<div class="hourrow"><span class="hl">${String(h.hour).padStart(2, '0')}:00</span>` +
          `<span class="hp">${h.palette.map((c) => `<i style="background:${hex(c)}"></i>`).join('')}</span>` +
          `<span class="hn">${h.n}</span></div>`,
      )
      .join('') || '<p class="none">Not enough yet.</p>'

  const pct = (n: number): string => `${Math.round(n * 100)}%`
  $('verify').innerHTML =
    `<div class="vrow"><span>attempts logged</span><b>${stats.attempts}</b></div>` +
    `<div class="vrow"><span>pass rate</span><b>${stats.attempts ? pct(stats.passRate) : '—'}</b></div>` +
    `<div class="vrow"><span>mean confidence</span><b>${
      stats.meanConfidence ? stats.meanConfidence + '%' : 'not checked'
    }</b></div>` +
    stats.confidenceByTier
      .filter((t) => t.n > 0)
      .map(
        (t) =>
          `<div class="vrow sub2"><span>${TIER_LABEL[t.tier as Tier]} tier · ${t.n}</span><b>${t.mean}%</b></div>`,
      )
      .join('')

  const maxRej = Math.max(...stats.rejections.map((r) => r.n), 1)
  $('rejections').innerHTML =
    stats.rejections
      .map(
        (r) =>
          `<div class="row"><span class="rl">${
            REJECT_TEXT[r.reason as keyof typeof REJECT_TEXT] ?? r.reason
          }</span><span class="rb"><i style="width:${(r.n / maxRej) * 100}%"></i></span><span class="rn">${r.n}</span></div>`,
      )
      .join('') || '<p class="none">Nothing refused yet.</p>'

  // sparkline
  const { counts, t0, bucketMs } = stats.timeline
  const W = 960
  const H = 130
  const max = Math.max(...counts, 1)
  let start = counts.findIndex((c) => c > 0)
  if (start < 0) start = counts.length - 10
  start = Math.max(0, Math.min(start - 1, counts.length - 10))
  const shown = counts.slice(start)
  const bw = W / shown.length
  $('spark').innerHTML =
    shown
      .map((c, i) => {
        const h = c === 0 ? 2 : Math.max((c / max) * (H - 22), 4)
        return `<rect x="${i * bw + bw * 0.18}" y="${H - h}" width="${bw * 0.64}" height="${h}" class="sb"/>`
      })
      .join('') + `<line x1="0" y1="${H - 1}" x2="${W}" y2="${H - 1}" class="sa"/>`
  const fmt = (ms: number): string =>
    new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  $('sparkAxis').innerHTML = `<span>${fmt(t0 + start * bucketMs)}</span><span>now</span>`

  $('leaders').innerHTML =
    leaders
      .map(
        (l) =>
          `<li><i class="dot" style="background:${l.avatarColor}"></i>${l.handle}` +
          `<span class="sub2">${l.holding} held · ${l.allTime} all-time</span><b>${l.points}</b></li>`,
      )
      .join('') || '<li class="none">No one yet.</li>'

  $('contested').innerHTML =
    stats.mostContested.map((c) => `<li>${c.name}<b>${c.n}</b></li>`).join('') ||
    '<li class="none">No claims yet.</li>'

  const e = city.extremes
  $('extremes').innerHTML =
    [
      ['most vivid', e.mostVivid],
      ['dimmest', e.dimmest],
      ['most open sky', e.openest],
    ]
      .filter(([, v]) => v)
      .map(([k, v]) => `<span class="ex"><i>${k}</i><b>${v}</b></span>`)
      .join('') || '<p class="none">Not enough photographs yet.</p>'
}

function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/ws`)
  ws.onopen = () => setLive(true)
  ws.onmessage = (ev) => {
    let m: ServerMsg
    try {
      m = JSON.parse(ev.data)
    } catch {
      return
    }
    if (m.t === 'init' || m.t === 'tick') {
      render(m.stats, m.leaders)
      beat()
    }
  }
  ws.onclose = () => {
    setLive(false)
    setTimeout(connect, 1500)
  }
}

connect()
