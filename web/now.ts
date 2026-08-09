// The pulse page: presence, momentum, where to start. Live over the same
// socket as everything else; every figure here is real or absent.

import { hex } from '../shared/palette'
import type { DashStats, FeedEntry, ServerMsg } from '../shared/types'

const $ = (id: string): HTMLElement => document.getElementById(id)!

function setLive(on: boolean): void {
  $('live').classList.toggle('on', on)
  $('liveLabel').textContent = on ? 'live' : 'reconnecting'
}

function ago(ts: number): string {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  return `${Math.floor(m / 60)}h ${m % 60}m ago`
}

function fmtDist(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`
}

function renderFeed(entries: FeedEntry[]): void {
  $('feed').innerHTML =
    entries
      .slice(0, 12)
      .map(
        (e) =>
          `<li><i class="dot" style="background:${e.avatarColor}"></i>` +
          `<span class="fw"><b>${e.handle}</b> claimed ${e.landmarkName}</span>` +
          `<time>${ago(e.at)}</time></li>`,
      )
      .join('') ||
    '<li class="none">Nothing yet today — the first claim starts the story.</li>'
}

function render(stats: DashStats): void {
  const p = stats.presence
  $('presence').textContent = String(Math.max(p, 1))
  $('presenceLabel').textContent =
    p <= 1
      ? 'person looking at the neighbourhood right now — you'
      : 'people looking at the neighbourhood right now'

  $('trending').innerHTML =
    stats.trending
      .map((t, i) => {
        const tint = t.tint ? hex(t.tint) : 'var(--ink)'
        return (
          `<div class="trend"><span class="tn">${i + 1}</span>` +
          `<span class="tw"><b>${t.name}</b><em>${t.recent} claim${t.recent === 1 ? '' : 's'} lately · ${ago(t.lastAt)}</em>` +
          `<span class="theat"><i style="width:${Math.max(t.heat * 100, 4)}%;background:${tint}"></i></span></span></div>`
        )
      })
      .join('') ||
    '<p class="none">Quiet right now. The first claim of the day sets the trend — the list rebuilds live as places heat up.</p>'

  $('startHere').innerHTML =
    stats.startHere
      .map(
        (s) =>
          `<a class="start" href="/#${encodeURIComponent(s.landmarkId)}">` +
          `<img src="/brand/category/${s.category}.svg" onerror="this.src='/brand/category/default.svg'" alt="" />` +
          `<span><b>${s.name}</b><em>${fmtDist(s.distanceM)} away · ${
            s.hasWiki ? 'has a Wikipedia page' : `${s.facts} documented facts`
          } · never photographed</em></span></a>`,
      )
      .join('') || '<p class="none">Every well-documented place nearby has been photographed. That took a crowd.</p>'

  $('today').innerHTML =
    stats.today
      .map(
        (t) =>
          `<li><i class="dot" style="background:${t.avatarColor}"></i>${t.handle}` +
          `<b>${t.n} place${t.n === 1 ? '' : 's'}</b></li>`,
      )
      .join('') || '<li class="none">Nobody has claimed anything today. First name on this board owns the morning.</li>'
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
    if (m.t === 'init') {
      render(m.stats)
      renderFeed(m.feed)
    } else if (m.t === 'tick') {
      render(m.stats)
    } else if (m.t === 'claimed') {
      // a new claim lands in the feed immediately; the tick catches the rest
      const li = document.createElement('li')
      li.className = 'fresh'
      li.innerHTML =
        `<i class="dot" style="background:${m.entry.avatarColor}"></i>` +
        `<span class="fw"><b>${m.entry.handle}</b> claimed ${m.entry.landmarkName}</span><time>just now</time>`
      $('feed').prepend(li)
    }
  }
  ws.onclose = () => {
    setLive(false)
    setTimeout(connect, 1500)
  }
}

connect()
