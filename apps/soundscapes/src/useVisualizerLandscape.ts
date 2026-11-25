import { useEffect, useState } from 'react'
import { readDisplay, setLandscape } from './display'

/** The visualizer's orientation (display.ts), applied only while it is open: read once, and set through here. */
export function useVisualizerLandscape(): [boolean, (landscape: boolean) => void] {
  const [landscape, setLandscapeState] = useState(false)
  useEffect(() => {
    void readDisplay().then((display) => setLandscapeState(display.landscape))
  }, [])
  return [landscape, (next) => {
    setLandscapeState(next)
    void setLandscape(next)
  }]
}
