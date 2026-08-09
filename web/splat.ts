// The 3D viewer: a place rebuilt out of the photographs people took claiming it.
//
// Spark (World Labs, MIT) renders Gaussian splats inside a normal three.js
// scene. The model is served from our own /splats/ directory, so this page
// depends on no third-party viewer, iframe or CDN — which is the same rule the
// rest of the app follows.

import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { ArchiveResponse } from '../shared/types'

const $ = (id: string): HTMLElement => document.getElementById(id)!

function status(text: string, spinning = true): void {
  const box = $('sStatus')
  box.removeAttribute('hidden')
  box.classList.toggle('done', !spinning)
  $('sStatusText').textContent = text
}

function hideStatus(): void {
  $('sStatus').setAttribute('hidden', '')
}

async function main(): Promise<void> {
  const id = new URLSearchParams(location.search).get('id')
  if (!id) {
    status('No place given.', false)
    return
  }

  let data: ArchiveResponse
  try {
    data = (await (await fetch(`/api/landmark/${encodeURIComponent(id)}`)).json()) as ArchiveResponse
  } catch {
    status('Could not load this place.', false)
    return
  }

  const l = data.landmark
  $('sName').textContent = l.name
  $('sSub').textContent = l.splatPhotos
    ? `rebuilt from ${l.splatPhotos} photographs`
    : 'rebuilt from its archive'

  if (l.splatState !== 'ready' || !l.splatUrl) {
    status('No 3D model for this place yet.', false)
    return
  }

  // antialias off: WebGL MSAA does nothing for splats and costs a lot.
  const canvas = $('stage') as HTMLCanvasElement
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#0e0f12')
  scene.add(new SparkRenderer({ renderer }))

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000)
  camera.position.set(0, 0, 3)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.rotateSpeed = 0.6

  status('Loading the model…')
  const mesh = new SplatMesh({
    url: l.splatUrl,
    onLoad: () => {
      // Splat captures come out of photogrammetry in an arbitrary pose; this
      // one flip is the usual correction for a scene reconstructed upside-down.
      mesh.rotation.x = Math.PI
      frameToContent()
      hideStatus()
    },
    onProgress: (e: ProgressEvent) => {
      if (e.lengthComputable && e.total > 0) {
        status(`Loading the model… ${Math.round((e.loaded / e.total) * 100)}%`)
      }
    },
  })
  scene.add(mesh)

  /** Point the camera at whatever actually got loaded, whatever scale it is. */
  function frameToContent(): void {
    const box = new THREE.Box3().setFromObject(mesh)
    if (box.isEmpty()) return
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    const radius = Math.max(size.x, size.y, size.z) || 1
    controls.target.copy(centre)
    camera.position.set(centre.x, centre.y, centre.z + radius * 1.6)
    camera.near = radius / 100
    camera.far = radius * 100
    camera.updateProjectionMatrix()
    controls.update()
  }

  // A model that never arrives should say so rather than spin forever.
  setTimeout(() => {
    if (!$('sStatus').hasAttribute('hidden')) {
      status('This model is taking unusually long — it may be very large.', false)
    }
  }, 45_000)

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
  })

  renderer.setAnimationLoop(() => {
    controls.update()
    renderer.render(scene, camera)
  })
}

void main().catch((e: Error) => status(e.message, false))
